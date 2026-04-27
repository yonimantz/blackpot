import asyncio
import json
import os
import base64
import uuid
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

import auth_firebase
import database as db
from engine import run_workflow, run_workflow_streaming, request_cancel
from persistence import get_persistence
from request_context import RunContext, reset_run_context, set_run_context

load_dotenv()

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


def _persistence_owner(user: dict | None) -> str:
    if user and user.get('uid'):
        return user['uid']
    return db.LEGACY_OWNER_SENTINEL


def _user_gemini_key(store, user: dict | None) -> str | None:
    if not user or not user.get('uid'):
        return None
    return store.get_user_gemini_key(user['uid'])


def _user_openai_key(store, user: dict | None) -> str | None:
    if not user or not user.get('uid'):
        return None
    return store.get_user_openai_key(user['uid'])


async def require_user(authorization: str | None = Header(None)) -> dict | None:
    if not auth_firebase.auth_enabled():
        return None
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Not authenticated')
    token = authorization[7:].strip()
    try:
        return await asyncio.to_thread(auth_firebase.verify_id_token, token)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except Exception:
        raise HTTPException(status_code=401, detail='Invalid or expired session') from None


@app.on_event('startup')
def on_startup():
    db.init_db()
    _fb_data = os.getenv('DATA_BACKEND', '').strip().lower() == 'firestore'
    if _fb_data and not auth_firebase.auth_enabled():
        raise RuntimeError(
            'DATA_BACKEND=firestore requires FIREBASE_PROJECT_ID (Firebase Auth must be enabled).',
        )
    if auth_firebase.auth_enabled() or _fb_data:
        auth_firebase.ensure_firebase_initialized()


# ---------------------------------------------------------------------------
# Workflow execution
# ---------------------------------------------------------------------------

class WorkflowPayload(BaseModel):
    nodes: list[dict]
    edges: list[dict]
    workflow_id: Optional[str] = None


def _run_context_for_user(user: dict | None) -> RunContext:
    store = get_persistence()
    owner_uid = user['uid'] if user else None
    gkey = _user_gemini_key(store, user)
    okey = _user_openai_key(store, user)
    return RunContext(owner_uid=owner_uid, gemini_user_key=gkey, openai_user_key=okey)


@app.post('/api/run')
async def api_run_workflow(
    payload: WorkflowPayload,
    user: dict | None = Depends(require_user),
):
    tok = set_run_context(_run_context_for_user(user))
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
async def api_run_workflow_stream(
    payload: WorkflowPayload,
    user: dict | None = Depends(require_user),
):
    queue: asyncio.Queue = asyncio.Queue()

    async def progress_callback(event_type: str, data: dict):
        await queue.put((event_type, data))

    async def generate():
        tok = set_run_context(_run_context_for_user(user))
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
async def api_cancel_workflow(user: dict | None = Depends(require_user)):
    request_cancel()
    return {'status': 'cancelled'}


@app.post('/api/upload')
async def api_upload_file(
    file: UploadFile = File(...),
    user: dict | None = Depends(require_user),
):
    contents = await file.read()
    file_id = str(uuid.uuid4())
    ext = file.filename.split('.')[-1] if file.filename else 'png'
    owner = _persistence_owner(user)
    sub = owner if owner != db.LEGACY_OWNER_SENTINEL else ''
    dest_dir = os.path.join(UPLOAD_DIR, sub) if sub else UPLOAD_DIR
    os.makedirs(dest_dir, exist_ok=True)
    path = os.path.join(dest_dir, f'{file_id}.{ext}')
    with open(path, 'wb') as f:
        f.write(contents)

    b64 = base64.b64encode(contents).decode('ascii')
    mime = file.content_type or 'image/png'
    data_url = f'data:{mime};base64,{b64}'
    return {'fileId': file_id, 'dataUrl': data_url}


@app.get('/api/health')
async def health():
    return {'status': 'ok'}


@app.get('/api/session')
async def api_session(user: dict | None = Depends(require_user)):
    """Verify the bearer token and invite allowlist; used by the SPA right after Firebase sign-in."""
    return {'uid': user['uid'], 'email': user.get('email')}


# ---------------------------------------------------------------------------
# User settings (Gemini API key)
# ---------------------------------------------------------------------------

class GeminiKeyPayload(BaseModel):
    apiKey: str


@app.get('/api/user/gemini-key')
async def api_gemini_key_status(user: dict | None = Depends(require_user)):
    if not user:
        return {
            'hasKey': bool(os.getenv('GEMINI_API_KEY', '').strip()),
            'managedByEnv': True,
        }
    store = get_persistence()
    k = store.get_user_gemini_key(user['uid'])
    return {'hasKey': bool(k and k.strip()), 'managedByEnv': False}


@app.put('/api/user/gemini-key')
async def api_set_gemini_key(
    payload: GeminiKeyPayload,
    user: dict | None = Depends(require_user),
):
    if not user:
        raise HTTPException(
            status_code=400,
            detail='Sign in is required to save a personal API key.',
        )
    key = (payload.apiKey or '').strip()
    if not key:
        raise HTTPException(status_code=400, detail='apiKey is required')
    store = get_persistence()
    store.set_user_gemini_key(user['uid'], key)
    return {'ok': True}


@app.delete('/api/user/gemini-key')
async def api_clear_gemini_key(user: dict | None = Depends(require_user)):
    if not user:
        raise HTTPException(status_code=400, detail='Sign in required')
    store = get_persistence()
    store.clear_user_gemini_key(user['uid'])
    return {'ok': True}


# ---------------------------------------------------------------------------
# User settings (OpenAI API key)
# ---------------------------------------------------------------------------


class OpenAIKeyPayload(BaseModel):
    apiKey: str


@app.get('/api/user/openai-key')
async def api_openai_key_status(user: dict | None = Depends(require_user)):
    if not user:
        return {
            'hasKey': bool(os.getenv('OPENAI_API_KEY', '').strip()),
            'managedByEnv': True,
        }
    store = get_persistence()
    k = store.get_user_openai_key(user['uid'])
    return {'hasKey': bool(k and k.strip()), 'managedByEnv': False}


@app.put('/api/user/openai-key')
async def api_set_openai_key(
    payload: OpenAIKeyPayload,
    user: dict | None = Depends(require_user),
):
    if not user:
        raise HTTPException(
            status_code=400,
            detail='Sign in is required to save a personal API key.',
        )
    key = (payload.apiKey or '').strip()
    if not key:
        raise HTTPException(status_code=400, detail='apiKey is required')
    store = get_persistence()
    store.set_user_openai_key(user['uid'], key)
    return {'ok': True}


@app.delete('/api/user/openai-key')
async def api_clear_openai_key(user: dict | None = Depends(require_user)):
    if not user:
        raise HTTPException(status_code=400, detail='Sign in required')
    store = get_persistence()
    store.clear_user_openai_key(user['uid'])
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
async def api_list_workflows(user: dict | None = Depends(require_user)):
    store = get_persistence()
    return store.list_workflows(_persistence_owner(user))


@app.post('/api/workflows')
async def api_create_workflow(
    payload: WorkflowCreatePayload,
    user: dict | None = Depends(require_user),
):
    store = get_persistence()
    return store.create_workflow(
        _persistence_owner(user),
        payload.name or 'Untitled Workflow',
        icon_id=payload.icon_id,
        description=payload.description,
        icon_color=payload.icon_color,
    )


@app.get('/api/workflows/{wf_id}')
async def api_get_workflow(wf_id: str, user: dict | None = Depends(require_user)):
    store = get_persistence()
    wf = store.get_workflow(_persistence_owner(user), wf_id)
    if not wf:
        return JSONResponse(status_code=404, content={'detail': 'Workflow not found'})
    return wf


@app.put('/api/workflows/{wf_id}')
async def api_update_workflow(
    wf_id: str,
    payload: WorkflowUpdatePayload,
    user: dict | None = Depends(require_user),
):
    store = get_persistence()
    icon_color_arg: str | None | object = db.ICON_COLOR_UNSET
    if 'icon_color' in payload.model_fields_set:
        icon_color_arg = payload.icon_color

    result = store.update_workflow(
        _persistence_owner(user),
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
async def api_delete_workflow(wf_id: str, user: dict | None = Depends(require_user)):
    store = get_persistence()
    if not store.delete_workflow(_persistence_owner(user), wf_id):
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
    user: dict | None = Depends(require_user),
):
    store = get_persistence()
    owner = _persistence_owner(user)
    fid = (folder_id or '').strip() or None
    if fid:
        if not store.get_collection_folder(owner, fid):
            return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    return store.list_collection(owner, fid)


@app.get('/api/collection/folders')
async def api_list_collection_folders(user: dict | None = Depends(require_user)):
    store = get_persistence()
    return store.list_collection_folders(_persistence_owner(user))


@app.post('/api/collection/folders')
async def api_create_collection_folder(
    body: CollectionFolderCreateBody,
    user: dict | None = Depends(require_user),
):
    store = get_persistence()
    return store.create_collection_folder(_persistence_owner(user), body.name)


@app.patch('/api/collection/folders/{folder_id}')
async def api_rename_collection_folder(
    folder_id: str,
    body: CollectionFolderRenameBody,
    user: dict | None = Depends(require_user),
):
    store = get_persistence()
    result = store.rename_collection_folder(_persistence_owner(user), folder_id, body.name)
    if not result:
        return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    return result


@app.delete('/api/collection/folders/{folder_id}')
async def api_delete_collection_folder(
    folder_id: str,
    mode: str = Query('unlink', description='unlink | delete_items'),
    user: dict | None = Depends(require_user),
):
    if mode not in ('unlink', 'delete_items'):
        return JSONResponse(
            status_code=400,
            content={'detail': "mode must be 'unlink' or 'delete_items'"},
        )
    store = get_persistence()
    owner = _persistence_owner(user)
    if mode == 'unlink':
        ok = store.delete_collection_folder_unlink(owner, folder_id)
    else:
        ok = store.delete_collection_folder_and_items(owner, folder_id)
    if not ok:
        return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    return {'status': 'deleted'}


@app.patch('/api/collection/move')
async def api_collection_move(
    body: CollectionMoveBody,
    user: dict | None = Depends(require_user),
):
    store = get_persistence()
    owner = _persistence_owner(user)
    if not body.ids:
        return JSONResponse(status_code=400, content={'detail': 'ids required'})
    target = body.folder_id
    if target is not None:
        target = target.strip() or None
    if target and not store.get_collection_folder(owner, target):
        return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    ok = store.set_collection_items_folder(owner, body.ids, target)
    if not ok:
        return JSONResponse(status_code=404, content={'detail': 'Folder not found'})
    return {'status': 'ok'}


@app.delete('/api/collection/{img_id}')
async def api_delete_collection_item(img_id: str, user: dict | None = Depends(require_user)):
    store = get_persistence()
    if not store.delete_collection_item(_persistence_owner(user), img_id):
        return JSONResponse(status_code=404, content={'detail': 'Image not found'})
    return {'status': 'deleted'}


@app.get('/api/collection/{img_id}/file')
async def api_get_collection_file(img_id: str, user: dict | None = Depends(require_user)):
    store = get_persistence()
    blob = store.get_collection_bytes(_persistence_owner(user), img_id)
    if not blob:
        return JSONResponse(status_code=404, content={'detail': 'Image file not found'})
    raw, mime = blob
    return Response(content=raw, media_type=mime)


if __name__ == '__main__':
    import uvicorn

    uvicorn.run('main:app', host='0.0.0.0', port=8000, reload=True)
