import asyncio
import json
import os
import base64
import uuid
from typing import Optional

# Use the OS native trust store (Windows cert store, macOS Keychain, etc.) for
# Python's HTTPS so corporate TLS-intercepting proxies don't break outbound
# requests (e.g. AI model APIs). Must run before any module that creates an
# SSLContext.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

import database as db
from engine import run_workflow, run_workflow_streaming, request_cancel
from nodes.io_nodes import export_images
from nodes.tool_nodes import run_remove_bg_raw
from persistence import get_persistence
from request_context import RunContext, reset_run_context, set_run_context

app = FastAPI(title="Blackpot API")

_cors = os.getenv('CORS_ORIGINS', '*').strip()
_origins = [o.strip() for o in _cors.split(',') if o.strip()] if _cors != '*' else ['*']

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=['*'],
    allow_headers=['*'],
)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)


_LOCAL_USER_ID = '__local__'
_PERSISTENCE_OWNER = db.LEGACY_OWNER_SENTINEL


@app.on_event('startup')
def on_startup():
    db.init_db()
    # Reclaim space from image blobs that the client migrates out of the graph.
    try:
        db.vacuum_if_bloated()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Workflow execution
# ---------------------------------------------------------------------------

class WorkflowPayload(BaseModel):
    nodes: list[dict]
    edges: list[dict]
    workflow_id: Optional[str] = None


class RemoveBgToolPayload(BaseModel):
    imageDataUrl: str
    model: str = 'isnet-general-use'
    alphaMatting: bool = False
    fgThreshold: int = 240
    bgThreshold: int = 10
    erodeSize: int = 10


def _run_context_for_user() -> RunContext:
    store = get_persistence()
    return RunContext(
        owner_uid=None,
        gemini_user_key=store.get_user_gemini_key(_LOCAL_USER_ID),
        openai_user_key=store.get_user_openai_key(_LOCAL_USER_ID),
        fal_user_key=store.get_user_fal_key(_LOCAL_USER_ID),
    )


@app.post('/api/run')
async def api_run_workflow(payload: WorkflowPayload):
    tok = set_run_context(_run_context_for_user())
    try:
        results = await run_workflow(payload.model_dump())
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={'detail': f'Workflow engine error: {e}'},
        )
    finally:
        reset_run_context(tok)
    return results


@app.post('/api/run/stream')
async def api_run_workflow_stream(payload: WorkflowPayload):
    queue: asyncio.Queue = asyncio.Queue()

    async def progress_callback(event_type: str, data: dict):
        await queue.put((event_type, data))

    async def generate():
        tok = set_run_context(_run_context_for_user())
        task = asyncio.create_task(
            run_workflow_streaming(payload.model_dump(), progress_callback)
        )
        try:
            while not task.done():
                try:
                    event_type, data = await asyncio.wait_for(queue.get(), timeout=0.1)
                    yield f'event: {event_type}\ndata: {json.dumps(data)}\n\n'
                except asyncio.TimeoutError:
                    continue

            while not queue.empty():
                event_type, data = queue.get_nowait()
                yield f'event: {event_type}\ndata: {json.dumps(data)}\n\n'

            results = task.result()
            summary = {
                nid: r
                for nid, r in results.items()
                if isinstance(r, dict)
                and ('error' in r or 'skipped' in r or nid == '_cancelled')
            }
            yield f'event: done\ndata: {json.dumps(summary)}\n\n'
        except Exception as e:
            yield f'event: error\ndata: {json.dumps({"detail": str(e)})}\n\n'
        finally:
            reset_run_context(tok)

    return StreamingResponse(generate(), media_type='text/event-stream')


@app.post('/api/run/cancel')
async def api_cancel_workflow():
    request_cancel()
    return {'status': 'cancelled'}


class ExportImageItem(BaseModel):
    image: str
    fileName: str = 'output'
    format: str = 'png'


class ExportImagesPayload(BaseModel):
    items: list[ExportImageItem]
    exportPath: str = ''


@app.post('/api/export')
async def api_export_images(payload: ExportImagesPayload):
    if not payload.items:
        raise HTTPException(status_code=400, detail='No images to export')
    try:
        result = export_images(
            [item.model_dump() for item in payload.items],
            payload.exportPath,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f'export failed: {e}')
    return result


@app.post('/api/upload')
async def api_upload_file(file: UploadFile = File(...)):
    contents = await file.read()
    file_id = str(uuid.uuid4())
    ext = file.filename.split('.')[-1] if file.filename else 'png'
    path = os.path.join(UPLOAD_DIR, f'{file_id}.{ext}')
    with open(path, 'wb') as f:
        f.write(contents)

    b64 = base64.b64encode(contents).decode('ascii')
    mime = file.content_type or 'image/png'
    data_url = f'data:{mime};base64,{b64}'
    return {'fileId': file_id, 'dataUrl': data_url}


def _find_upload_path(file_id: str) -> str | None:
    """Locate an uploaded file by id (the on-disk name is `{id}.{ext}`)."""
    safe = os.path.basename(file_id or '')
    if not safe:
        return None
    try:
        for fn in os.listdir(UPLOAD_DIR):
            if fn.split('.', 1)[0] == safe:
                return os.path.join(UPLOAD_DIR, fn)
    except FileNotFoundError:
        return None
    return None


@app.get('/api/upload/{file_id}')
async def api_get_upload_file(file_id: str):
    path = _find_upload_path(file_id)
    if not path or not os.path.exists(path):
        return JSONResponse(status_code=404, content={'detail': 'Upload not found'})
    ext = path.rsplit('.', 1)[-1].lower() if '.' in path else 'png'
    mime = 'image/png'
    if ext in ('jpg', 'jpeg'):
        mime = 'image/jpeg'
    elif ext == 'webp':
        mime = 'image/webp'
    elif ext == 'gif':
        mime = 'image/gif'
    with open(path, 'rb') as f:
        raw = f.read()
    return Response(content=raw, media_type=mime, headers={'Cache-Control': 'max-age=31536000'})


@app.post('/api/tools/remove-bg')
async def api_tool_remove_bg(payload: RemoveBgToolPayload):
    image_data = (payload.imageDataUrl or '').strip()
    if not image_data:
        raise HTTPException(status_code=400, detail='imageDataUrl is required')
    try:
        return run_remove_bg_raw(
            image_data,
            {
                'model': payload.model,
                'alphaMatting': payload.alphaMatting,
                'fgThreshold': payload.fgThreshold,
                'bgThreshold': payload.bgThreshold,
                'erodeSize': payload.erodeSize,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'remove-bg failed: {e}')


@app.get('/api/health')
async def health():
    return {'status': 'ok'}


# ---------------------------------------------------------------------------
# User settings (Gemini API key)
# ---------------------------------------------------------------------------

class GeminiKeyPayload(BaseModel):
    apiKey: str


@app.get('/api/user/gemini-key')
async def api_gemini_key_status():
    store = get_persistence()
    k = store.get_user_gemini_key(_LOCAL_USER_ID)
    return {'hasKey': bool(k and k.strip()), 'managedByEnv': False}


@app.put('/api/user/gemini-key')
async def api_set_gemini_key(payload: GeminiKeyPayload):
    key = (payload.apiKey or '').strip()
    if not key:
        raise HTTPException(status_code=400, detail='apiKey is required')
    store = get_persistence()
    store.set_user_gemini_key(_LOCAL_USER_ID, key)
    return {'ok': True}


@app.delete('/api/user/gemini-key')
async def api_clear_gemini_key():
    store = get_persistence()
    store.clear_user_gemini_key(_LOCAL_USER_ID)
    return {'ok': True}


# ---------------------------------------------------------------------------
# User settings (OpenAI API key)
# ---------------------------------------------------------------------------


class OpenAIKeyPayload(BaseModel):
    apiKey: str


@app.get('/api/user/openai-key')
async def api_openai_key_status():
    store = get_persistence()
    k = store.get_user_openai_key(_LOCAL_USER_ID)
    return {'hasKey': bool(k and k.strip()), 'managedByEnv': False}


@app.put('/api/user/openai-key')
async def api_set_openai_key(payload: OpenAIKeyPayload):
    key = (payload.apiKey or '').strip()
    if not key:
        raise HTTPException(status_code=400, detail='apiKey is required')
    store = get_persistence()
    store.set_user_openai_key(_LOCAL_USER_ID, key)
    return {'ok': True}


@app.delete('/api/user/openai-key')
async def api_clear_openai_key():
    store = get_persistence()
    store.clear_user_openai_key(_LOCAL_USER_ID)
    return {'ok': True}


# ---------------------------------------------------------------------------
# User settings (fal.ai API key)
# ---------------------------------------------------------------------------


class FalKeyPayload(BaseModel):
    apiKey: str


@app.get('/api/user/fal-key')
async def api_fal_key_status():
    store = get_persistence()
    k = store.get_user_fal_key(_LOCAL_USER_ID)
    return {'hasKey': bool(k and k.strip()), 'managedByEnv': False}


@app.put('/api/user/fal-key')
async def api_set_fal_key(payload: FalKeyPayload):
    key = (payload.apiKey or '').strip()
    if not key:
        raise HTTPException(status_code=400, detail='apiKey is required')
    store = get_persistence()
    store.set_user_fal_key(_LOCAL_USER_ID, key)
    return {'ok': True}


@app.delete('/api/user/fal-key')
async def api_clear_fal_key():
    store = get_persistence()
    store.clear_user_fal_key(_LOCAL_USER_ID)
    return {'ok': True}


# ---------------------------------------------------------------------------
# Workflow CRUD
# ---------------------------------------------------------------------------

class WorkflowCreatePayload(BaseModel):
    name: Optional[str] = 'Untitled Workflow'
    icon_id: Optional[str] = None
    icon_color: Optional[str] = None
    description: Optional[str] = None


class WorkflowUpdatePayload(BaseModel):
    name: Optional[str] = None
    data: Optional[dict] = None
    icon_id: Optional[str] = None
    icon_color: Optional[str] = None
    description: Optional[str] = None


@app.get('/api/workflows')
async def api_list_workflows():
    store = get_persistence()
    return store.list_workflows(_PERSISTENCE_OWNER)


@app.post('/api/workflows')
async def api_create_workflow(payload: WorkflowCreatePayload):
    store = get_persistence()
    return store.create_workflow(
        _PERSISTENCE_OWNER,
        payload.name or 'Untitled Workflow',
        icon_id=payload.icon_id,
        description=payload.description,
        icon_color=payload.icon_color,
    )


@app.get('/api/workflows/{wf_id}')
async def api_get_workflow(wf_id: str):
    store = get_persistence()
    wf = store.get_workflow(_PERSISTENCE_OWNER, wf_id)
    if not wf:
        return JSONResponse(status_code=404, content={'detail': 'Workflow not found'})
    return wf


@app.put('/api/workflows/{wf_id}')
async def api_update_workflow(wf_id: str, payload: WorkflowUpdatePayload):
    store = get_persistence()
    icon_color_arg: str | None | object = db.ICON_COLOR_UNSET
    if 'icon_color' in payload.model_fields_set:
        icon_color_arg = payload.icon_color

    result = store.update_workflow(
        _PERSISTENCE_OWNER,
        wf_id,
        name=payload.name,
        data=payload.data,
        icon_id=payload.icon_id,
        description=payload.description,
        icon_color=icon_color_arg,
    )
    if not result:
        return JSONResponse(status_code=404, content={'detail': 'Workflow not found'})
    return result


@app.delete('/api/workflows/{wf_id}')
async def api_delete_workflow(wf_id: str):
    store = get_persistence()
    if not store.delete_workflow(_PERSISTENCE_OWNER, wf_id):
        return JSONResponse(status_code=404, content={'detail': 'Workflow not found'})
    return {'status': 'deleted'}


# ---------------------------------------------------------------------------
# Collection (generated images)
# ---------------------------------------------------------------------------

class CollectionFolderCreateBody(BaseModel):
    name: str


class CollectionFolderRenameBody(BaseModel):
    name: str


class CollectionMoveBody(BaseModel):
    ids: list[str]
    folder_id: Optional[str] = None


@app.get('/api/collection')
async def api_list_collection(
    folder_id: Optional[str] = Query(None, description='Omit or empty = ALL (unfiled); UUID = that folder'),
):
    store = get_persistence()
    fid = (folder_id or '').strip() or None
    if fid:
        if not store.get_collection_folder(_PERSISTENCE_OWNER, fid):
            return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    return store.list_collection(_PERSISTENCE_OWNER, fid)


@app.get('/api/collection/folders')
async def api_list_collection_folders():
    store = get_persistence()
    return store.list_collection_folders(_PERSISTENCE_OWNER)


@app.post('/api/collection/folders')
async def api_create_collection_folder(body: CollectionFolderCreateBody):
    store = get_persistence()
    return store.create_collection_folder(_PERSISTENCE_OWNER, body.name)


@app.patch('/api/collection/folders/{folder_id}')
async def api_rename_collection_folder(folder_id: str, body: CollectionFolderRenameBody):
    store = get_persistence()
    result = store.rename_collection_folder(_PERSISTENCE_OWNER, folder_id, body.name)
    if not result:
        return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    return result


@app.delete('/api/collection/folders/{folder_id}')
async def api_delete_collection_folder(
    folder_id: str,
    mode: str = Query('unlink', description='unlink | delete_items'),
):
    if mode not in ('unlink', 'delete_items'):
        return JSONResponse(
            status_code=400,
            content={'detail': "mode must be 'unlink' or 'delete_items'"},
        )
    store = get_persistence()
    if mode == 'unlink':
        ok = store.delete_collection_folder_unlink(_PERSISTENCE_OWNER, folder_id)
    else:
        ok = store.delete_collection_folder_and_items(_PERSISTENCE_OWNER, folder_id)
    if not ok:
        return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    return {'status': 'deleted'}


@app.patch('/api/collection/move')
async def api_collection_move(body: CollectionMoveBody):
    store = get_persistence()
    if not body.ids:
        return JSONResponse(status_code=400, content={'detail': 'ids required'})
    target = body.folder_id
    if target is not None:
        target = target.strip() or None
    if target and not store.get_collection_folder(_PERSISTENCE_OWNER, target):
        return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    ok = store.set_collection_items_folder(_PERSISTENCE_OWNER, body.ids, target)
    if not ok:
        return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    return {'status': 'ok'}


@app.delete('/api/collection/{img_id}')
async def api_delete_collection_item(img_id: str):
    store = get_persistence()
    if not store.delete_collection_item(_PERSISTENCE_OWNER, img_id):
        return JSONResponse(status_code=404, content={'detail': 'Image not found'})
    return {'status': 'deleted'}


@app.get('/api/collection/{img_id}/file')
async def api_get_collection_file(img_id: str):
    store = get_persistence()
    blob = store.get_collection_bytes(_PERSISTENCE_OWNER, img_id)
    if not blob:
        return JSONResponse(status_code=404, content={'detail': 'Image file not found'})
    raw, mime = blob
    return Response(content=raw, media_type=mime)


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('main:app', host='0.0.0.0', port=8000, reload=True)
