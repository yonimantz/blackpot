import asyncio
import json
import ntpath
import os
import base64
import re
import sys
import threading
import uuid
import webbrowser
from contextlib import asynccontextmanager
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

from paths import APP_NAME, BACKEND_DIR, ENV_FILE, FRONTEND_DIST, MODELS_DIR, UPLOAD_DIR

# A .env beside the code only exists in a dev checkout and takes precedence; an
# installed copy reads the one in the user's data directory. load_dotenv never
# overwrites an already-set variable, so the first file found wins.
load_dotenv(os.path.join(BACKEND_DIR, '.env'))
load_dotenv(ENV_FILE)

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

import database as db
from engine import run_workflow, run_workflow_streaming, request_cancel
from nodes.io_nodes import export_images, export_models, resolve_model_path
from nodes.tool_nodes import DEFAULT_REMOVE_BG_MODEL, run_remove_bg_raw
from persistence import get_persistence
from request_context import RunContext, reset_run_context, set_run_context
from version import __version__ as APP_VERSION

# Upload ids starting with this belong to node previews rather than to images the
# user imported, which is what makes them safe to garbage-collect. Must stay in
# sync with PREVIEW_ASSET_KEY_PREFIX in frontend/src/utils/previewAssets.ts.
PREVIEW_UPLOAD_PREFIX = 'pv-'


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    # Reclaim space from image blobs that the client migrates out of the graph.
    try:
        db.vacuum_if_bloated()
    except Exception:
        pass
    # Preview assets are keyed by workflow + node, so deleting either leaves an
    # unreferenced file behind. Nothing is mid-edit at startup, so this is the
    # safe moment to collect them.
    try:
        db.sweep_orphaned_uploads(UPLOAD_DIR, PREVIEW_UPLOAD_PREFIX)
    except Exception:
        pass
    yield


app = FastAPI(title="SpotOn API", lifespan=lifespan)

_cors = os.getenv('CORS_ORIGINS', '*').strip()
_origins = [o.strip() for o in _cors.split(',') if o.strip()] if _cors != '*' else ['*']

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=['*'],
    allow_headers=['*'],
)


_LOCAL_USER_ID = '__local__'
_PERSISTENCE_OWNER = db.LEGACY_OWNER_SENTINEL


# ---------------------------------------------------------------------------
# Workflow execution
# ---------------------------------------------------------------------------

class WorkflowPayload(BaseModel):
    nodes: list[dict]
    edges: list[dict]
    workflow_id: Optional[str] = None
    # Node id -> output handle -> value. Lets the caller pre-seed outputs for
    # nodes that won't actually run (e.g. a group run referencing an outside
    # node's cached result) so downstream nodes still receive real inputs.
    pre_outputs: dict[str, dict] = {}


class RemoveBgToolPayload(BaseModel):
    imageDataUrl: str
    model: str = DEFAULT_REMOVE_BG_MODEL
    operatingResolution: str = '1024x1024'
    refineForeground: bool = True


def _run_context_for_user() -> RunContext:
    store = get_persistence()
    return RunContext(
        owner_uid=None,
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


class ExportModelItem(BaseModel):
    assetId: str
    fileName: str = 'model'


class ExportModelsPayload(BaseModel):
    items: list[ExportModelItem]
    exportPath: str = ''


@app.post('/api/export-3d')
async def api_export_models(payload: ExportModelsPayload):
    if not payload.items:
        raise HTTPException(status_code=400, detail='No models to export')
    try:
        result = export_models(
            [item.model_dump() for item in payload.items],
            payload.exportPath,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f'export failed: {e}')
    return result


@app.get('/api/model/{asset_id}')
async def api_get_model_file(asset_id: str):
    path = resolve_model_path(asset_id)
    if not path:
        return JSONResponse(status_code=404, content={'detail': 'Model not found'})
    return FileResponse(
        path,
        media_type='model/gltf-binary',
        headers={'Cache-Control': 'max-age=31536000'},
    )


# Keep in sync with MAX_IMPORT_SIZE_BYTES in frontend/src/utils/model3dImport.ts.
_MAX_MODEL_IMPORT_BYTES = 100 * 1024 * 1024


@app.post('/api/model')
async def api_upload_model(file: UploadFile = File(...)):
    """Store an imported mesh as a fresh GLB in MODELS_DIR (Import 3D node).

    OBJ/FBX are converted to GLB in the browser before this is called (see
    model3dImport.ts), so this endpoint only ever accepts and serves GLB —
    same as every generated mesh — and the rest of the pipeline
    (`resolve_model_path`, `/api/model/{id}`, Export 3D) needs no format
    awareness of its own.
    """
    ext = file.filename.rsplit('.', 1)[-1].lower() if file.filename and '.' in file.filename else ''
    if ext != 'glb':
        raise HTTPException(
            status_code=400,
            detail='Only .glb files are accepted here — convert OBJ/FBX to GLB first.',
        )
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail='Uploaded model is empty.')
    if len(contents) > _MAX_MODEL_IMPORT_BYTES:
        raise HTTPException(status_code=400, detail='Model file is too large (limit 100 MB).')
    asset_id = f'{uuid.uuid4()}.glb'
    path = os.path.join(MODELS_DIR, asset_id)
    with open(path, 'wb') as f:
        f.write(contents)
    return {'assetId': asset_id, 'sizeBytes': len(contents)}


_UPLOAD_KEY_UNSAFE = re.compile(r'[^A-Za-z0-9_-]')


def _safe_upload_key(key: str) -> str:
    """Reduce a caller-supplied upload key to a filename-safe stem."""
    return _UPLOAD_KEY_UNSAFE.sub('', key or '')[:120]


@app.post('/api/upload')
async def api_upload_file(file: UploadFile = File(...), key: str = Form('')):
    """Store bytes in the file store and return the id they can be served by.

    Without a `key` each upload gets a fresh uuid, which is what imported images
    want — every import is its own asset. Preview assets pass a `key` derived
    from the workflow and node that own them so a re-run overwrites the previous
    file instead of orphaning it, keeping `uploads/` bounded by node count.
    """
    contents = await file.read()
    ext = (file.filename.split('.')[-1] if file.filename else 'png') or 'png'
    stem = _safe_upload_key(key)
    if stem:
        # Drop any previous file for this key first, so a changed extension
        # can't leave two candidates behind for `_find_upload_path` to pick from.
        for stale in _find_upload_paths(stem):
            try:
                os.remove(stale)
            except OSError:
                pass
    else:
        stem = str(uuid.uuid4())
    path = os.path.join(UPLOAD_DIR, f'{stem}.{ext}')
    with open(path, 'wb') as f:
        f.write(contents)

    # Keyed uploads are preview assets, read back by URL — echoing the bytes
    # back as base64 would double the cost of every single one.
    if key:
        return {'fileId': stem}
    b64 = base64.b64encode(contents).decode('ascii')
    mime = file.content_type or 'image/png'
    data_url = f'data:{mime};base64,{b64}'
    return {'fileId': stem, 'dataUrl': data_url}


def _find_upload_paths(file_id: str) -> list[str]:
    """Every uploaded file matching an id (the on-disk name is `{id}.{ext}`)."""
    safe = os.path.basename(file_id or '')
    if not safe:
        return []
    try:
        return [
            os.path.join(UPLOAD_DIR, fn)
            for fn in os.listdir(UPLOAD_DIR)
            if fn.split('.', 1)[0] == safe
        ]
    except FileNotFoundError:
        return []


def _find_upload_path(file_id: str) -> str | None:
    """Locate an uploaded file by id (the on-disk name is `{id}.{ext}`)."""
    found = _find_upload_paths(file_id)
    return found[0] if found else None


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


def _tool_image_to_data_url(image_data: str) -> str:
    """Accept a data URL or an `/api/upload/{id}` path and return bytes fal can upload.

    The editor modal often sees only the file-store URL (imports and saved
    previews). A workflow run never has this problem because `importImage`
    reloads the file from disk before `removeBg` runs.
    """
    raw = (image_data or '').strip()
    if not raw:
        raise HTTPException(status_code=400, detail='imageDataUrl is required')
    if raw.startswith('data:'):
        return raw
    marker = '/upload/'
    idx = raw.find(marker)
    if idx != -1:
        file_id = raw[idx + len(marker):].split('?', 1)[0].split('/', 1)[0]
        path = _find_upload_path(file_id)
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=400, detail='Upload image not found')
        with open(path, 'rb') as f:
            contents = f.read()
        ext = path.rsplit('.', 1)[-1].lower() if '.' in path else 'png'
        mime = 'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext}'
        return f'data:{mime};base64,' + base64.b64encode(contents).decode('ascii')
    return raw


@app.post('/api/tools/remove-bg')
async def api_tool_remove_bg(payload: RemoveBgToolPayload):
    image_data = _tool_image_to_data_url(payload.imageDataUrl)
    # Background removal now goes to fal, so the preview needs the same key
    # resolution a workflow run gets.
    tok = set_run_context(_run_context_for_user())
    try:
        return await run_remove_bg_raw(
            image_data,
            {
                'model': payload.model,
                'operatingResolution': payload.operatingResolution,
                'refineForeground': payload.refineForeground,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'remove-bg failed: {e}')
    finally:
        reset_run_context(tok)


@app.get('/api/health')
async def health():
    # The app name lets a second launch recognize an already-running SpotOn
    # rather than mistaking any listener on the port for one. `version` is
    # additive — older launcher code only ever read `app`.
    return {'status': 'ok', 'app': APP_NAME, 'version': APP_VERSION}


# ---------------------------------------------------------------------------
# User settings (fal.ai API key)
# ---------------------------------------------------------------------------


class FalKeyPayload(BaseModel):
    apiKey: str


@app.get('/api/user/fal-key')
async def api_fal_key_status():
    store = get_persistence()
    stored = (store.get_user_fal_key(_LOCAL_USER_ID) or '').strip()
    # FAL_KEY is a real fallback at execution time, so a user with only the env
    # var set does have a working key and should not be told to enter one.
    from_env = (os.getenv('FAL_KEY') or '').strip()
    return {
        'hasKey': bool(stored or from_env),
        'managedByEnv': bool(not stored and from_env),
    }


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


@app.get('/api/collection/{img_id}/thumb')
async def api_get_collection_thumb(img_id: str):
    """The item's picture for the grid. For an image that is the file itself;
    for a mesh it's the render stored alongside the GLB."""
    store = get_persistence()
    blob = store.get_collection_thumb_bytes(_PERSISTENCE_OWNER, img_id)
    if not blob:
        return JSONResponse(status_code=404, content={'detail': 'Thumbnail not found'})
    raw, mime = blob
    return Response(content=raw, media_type=mime)


# ---------------------------------------------------------------------------
# Frontend
#
# A packaged build serves the UI from this same server, so the installed app is
# one process on one port. Registered last so it cannot shadow an API route.
# ---------------------------------------------------------------------------

if FRONTEND_DIST:
    _INDEX_HTML = os.path.join(FRONTEND_DIST, 'index.html')

    def _static_file(rel_path: str) -> str | None:
        """Resolve a request path inside the dist folder, or None if it escapes
        the folder or names something that is not a file."""
        if os.path.isabs(rel_path) or ntpath.isabs(rel_path):
            return None
        candidate = os.path.normpath(os.path.join(FRONTEND_DIST, rel_path))
        if os.path.commonpath((FRONTEND_DIST, candidate)) != FRONTEND_DIST:
            return None
        return candidate if os.path.isfile(candidate) else None

    @app.get('/{asset_path:path}')
    async def serve_frontend(asset_path: str):
        if asset_path.startswith('api/'):
            raise HTTPException(status_code=404, detail='Not Found')
        found = _static_file(asset_path) if asset_path else None
        if found:
            return FileResponse(found)
        # Unknown paths are client-side routes; let the SPA router handle them.
        return FileResponse(_INDEX_HTML)


# ---------------------------------------------------------------------------
# Launcher
# ---------------------------------------------------------------------------

HOST = '127.0.0.1'
DEFAULT_PORT = 8000
_PORT_SEARCH_RANGE = 12


def _is_listening(port: int) -> bool:
    """Whether something accepts connections on *port*.

    A successful bind is not proof the port is free: Windows lets a second
    socket bind the same port when SO_REUSEADDR is set (uvicorn sets it), and
    traffic then goes to whichever bound last. Connecting is the reliable test.
    """
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((HOST, port)) == 0


def _is_spoton(port: int) -> bool:
    import json as _json
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(f'http://{HOST}:{port}/api/health', timeout=1) as resp:
            return _json.loads(resp.read()).get('app') == APP_NAME
    except (urllib.error.URLError, OSError, ValueError):
        return False


def _choose_port(preferred: int) -> tuple[int, bool]:
    """Return the port to use and whether SpotOn is already serving there."""
    for port in range(preferred, preferred + _PORT_SEARCH_RANGE):
        if not _is_listening(port):
            return port, False
        if _is_spoton(port):
            return port, True
    raise SystemExit(
        f'No free port found between {preferred} and {preferred + _PORT_SEARCH_RANGE - 1}.'
    )


def _open_browser_when_ready(url: str, port: int) -> None:
    """Wait for the server to accept connections, then open the browser, so the
    user never sees a connection-refused page."""
    import time

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if _is_listening(port):
            webbrowser.open(url)
            return
        time.sleep(0.2)


def _create_single_instance_mutex() -> None:
    """Create a named Win32 mutex so the installer's `AppMutex` setting (see
    packaging/spoton.iss) can tell a running copy apart from one that merely
    left locked files behind, and offer to close it before an upgrade.

    Intentionally never closed: Windows releases a process's mutex handles
    automatically on exit, including a crash, which is what a lock meant to
    signal "still running" needs. The name must match spoton.iss exactly.
    """
    if sys.platform != 'win32':
        return
    import ctypes

    try:
        ctypes.windll.kernel32.CreateMutexW(None, False, 'SpotOn.SingleInstance')
    except OSError:
        pass


def main() -> None:
    import uvicorn

    frozen = getattr(sys, 'frozen', False)
    desktop = frozen or '--desktop' in sys.argv
    preferred = int(os.getenv('SPOTON_PORT') or DEFAULT_PORT)

    port, already_running = _choose_port(preferred)
    url = f'http://{HOST}:{port}'

    if already_running:
        # Keep console output ASCII: a packaged build may run under a code page
        # that cannot encode typographic characters.
        print(f'{APP_NAME} is already running at {url} - opening it instead.')
        webbrowser.open(url)
        return

    if desktop:
        if not FRONTEND_DIST:
            raise SystemExit(
                'No built frontend found. Run "npm run build" in frontend/ first.'
            )
        _create_single_instance_mutex()
        threading.Thread(
            target=_open_browser_when_ready, args=(url, port), daemon=True
        ).start()
        # This window is the only way to stop the server, so say so plainly.
        # Flush explicitly: stdout is block-buffered whenever it is not a
        # terminal, which would hold the banner back until the process exits.
        banner = (
            '=' * 52,
            f' {APP_NAME} is running at {url}',
            ' Opening your browser...',
            '',
            ' Keep this window open while you work.',
            ' Closing it shuts SpotOn down.',
            '=' * 52,
        )
        print('\n'.join(banner), flush=True)

    uvicorn.run(
        app if desktop else 'main:app',
        host=HOST,
        port=port,
        reload=not desktop,
        log_level='warning' if desktop else 'info',
    )


if __name__ == '__main__':
    main()
