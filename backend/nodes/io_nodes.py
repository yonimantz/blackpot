import base64
import io
import os
import re
import shutil
from PIL import Image

from paths import EXPORT_DIR, MODELS_DIR, UPLOAD_DIR

_MODEL_ASSET_RE = re.compile(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.glb$'
)


def resolve_model_path(asset_id: str) -> str | None:
    """Return the on-disk path for a generated GLB, or None if the id is unsafe
    or the file is missing. ``asset_id`` must be a bare ``{uuid}.glb``."""
    safe = os.path.basename((asset_id or '').strip())
    if not _MODEL_ASSET_RE.match(safe):
        return None
    path = os.path.normpath(os.path.join(MODELS_DIR, safe))
    if os.path.commonpath((MODELS_DIR, path)) != MODELS_DIR:
        return None
    if not os.path.isfile(path):
        return None
    return path


def _load_asset_data_url(file_id: str) -> str | None:
    """Read an externalized upload (`uploads/{id}.{ext}`) and return it as a
    base64 data URL so the rest of the engine keeps receiving the same format
    it always has."""
    safe = os.path.basename(file_id or '')
    if not safe or not os.path.isdir(UPLOAD_DIR):
        return None
    for fn in os.listdir(UPLOAD_DIR):
        if fn.split('.', 1)[0] == safe:
            path = os.path.join(UPLOAD_DIR, fn)
            with open(path, 'rb') as f:
                raw = f.read()
            ext = fn.rsplit('.', 1)[-1].lower() if '.' in fn else 'png'
            mime = 'image/jpeg' if ext in ('jpg', 'jpeg') else f'image/{ext}'
            b64 = base64.b64encode(raw).decode('ascii')
            return f'data:{mime};base64,{b64}'
    return None


def _decode_image(data: str) -> Image.Image:
    if ',' in data:
        data = data.split(',', 1)[1]
    img_bytes = base64.b64decode(data)
    return Image.open(io.BytesIO(img_bytes))


def _encode_image(img: Image.Image, fmt: str = 'PNG') -> str:
    buf = io.BytesIO()
    if fmt.upper() == 'JPG':
        fmt = 'JPEG'
    if img.mode == 'RGBA' and fmt.upper() == 'JPEG':
        img = img.convert('RGB')
    img.save(buf, format=fmt.upper())
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    mime = 'image/png' if fmt.upper() == 'PNG' else f'image/{fmt.lower()}'
    return f'data:{mime};base64,{b64}'


def execute_io_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'importImage':
        file_data = data.get('fileData', '')
        if not file_data:
            asset_id = data.get('fileAssetId') or data.get('fileId')
            if asset_id:
                file_data = _load_asset_data_url(asset_id)
        if not file_data:
            raise ValueError("importImage: no file data provided")
        return {'image': file_data}

    elif node_type == 'exportImage':
        # Export is now an explicit, user-triggered action (the Export button in
        # the inspector calls `export_images` via /api/export). During a normal
        # workflow run the node is a passthrough no-op so nothing is written to
        # disk automatically.
        return {}

    elif node_type == 'export3d':
        return {}

    elif node_type == 'import3d':
        asset_id = (data.get('modelAssetId') or '').strip()
        path = resolve_model_path(asset_id)
        if not path:
            raise ValueError('Import 3D: no model file imported.')
        return {
            'model': {
                'assetId': asset_id,
                'url': f'/api/model/{asset_id}',
                'format': 'glb',
                'sizeBytes': os.path.getsize(path),
            }
        }

    elif node_type == 'preview3d':
        # Viewer-only node: hand the mesh descriptor straight through so it can
        # sit inline ahead of Export 3D. The `image` output is a browser-side
        # snapshot of the WebGL view — there's no 3D renderer on the backend,
        # so the frontend bakes it into `_preview3dSnapshot` before every run
        # (see getRunWorkflowPayload in workflowStore.ts).
        model = inputs.get('model')
        if model is None and len(inputs) == 1:
            model = next(iter(inputs.values()))
        result: dict = {}
        if model is not None:
            result['model'] = model
        snapshot = data.get('_preview3dSnapshot')
        if snapshot:
            result['image'] = snapshot
        return result

    elif node_type == 'preview':
        img_data = inputs.get('image')
        if not img_data and len(inputs) == 1:
            img_data = next(iter(inputs.values()))
        if not img_data:
            return {'image': ''}
        return {'image': img_data}

    return {}


_ALLOWED_EXPORT_FORMATS = ('png', 'jpg', 'jpeg', 'webp')


def _sanitize_filename(name: str) -> str:
    """Keep only the base name (no directory parts / extension) so the user
    can type freely without escaping the export folder."""
    base = os.path.basename((name or '').strip())
    base = os.path.splitext(base)[0]
    # Drop characters that are illegal on Windows file systems.
    cleaned = ''.join(c for c in base if c not in '\\/:*?"<>|').strip()
    return cleaned or 'output'


def export_images(items: list, export_path: str = '') -> dict:
    """Write one file per item to `export_path` (a folder) or the default
    exports directory. Each item is `{ image, fileName, format }`.

    Returns `{ 'saved': [paths], 'errors': [messages] }`.
    """
    folder = (export_path or '').strip()
    if folder:
        # Treat a value that looks like a file (has an image extension) as a
        # folder by stripping the trailing file component.
        if os.path.splitext(folder)[1].lower().lstrip('.') in _ALLOWED_EXPORT_FORMATS:
            folder = os.path.dirname(folder) or EXPORT_DIR
    else:
        folder = EXPORT_DIR
    os.makedirs(folder, exist_ok=True)

    saved: list[str] = []
    errors: list[str] = []
    used_names: set[str] = set()

    for idx, item in enumerate(items or []):
        label = f'Image {idx + 1}'
        try:
            img_data = (item or {}).get('image')
            if not img_data:
                errors.append(f'{label}: no image connected')
                continue

            img = _decode_image(img_data)
            fmt = str((item or {}).get('format') or 'png').lower()
            if fmt not in _ALLOWED_EXPORT_FORMATS:
                fmt = 'png'
            file_ext = 'jpg' if fmt in ('jpg', 'jpeg') else fmt
            pil_format = 'JPEG' if file_ext == 'jpg' else file_ext.upper()

            fname = _sanitize_filename(str((item or {}).get('fileName') or 'output'))
            # Avoid silently overwriting another item exported in the same call.
            candidate = f'{fname}.{file_ext}'
            n = 2
            while candidate.lower() in used_names:
                candidate = f'{fname}_{n}.{file_ext}'
                n += 1
            used_names.add(candidate.lower())

            if img.mode == 'RGBA' and file_ext == 'jpg':
                img = img.convert('RGB')

            out_path = os.path.join(folder, candidate)
            img.save(out_path, format=pil_format)
            saved.append(out_path)
        except Exception as e:  # noqa: BLE001 — report per-item, keep going
            errors.append(f'{label}: {e}')

    return {'saved': saved, 'errors': errors}


def export_models(items: list, export_path: str = '') -> dict:
    """Copy generated GLBs from ``MODELS_DIR`` to ``export_path`` or the default
    exports folder. Each item is ``{ assetId, fileName }``.

    Returns ``{ 'saved': [paths], 'errors': [messages] }``.
    """
    folder = (export_path or '').strip()
    if folder:
        if os.path.splitext(folder)[1].lower().lstrip('.') == 'glb':
            folder = os.path.dirname(folder) or EXPORT_DIR
    else:
        folder = EXPORT_DIR
    os.makedirs(folder, exist_ok=True)

    saved: list[str] = []
    errors: list[str] = []
    used_names: set[str] = set()

    for idx, item in enumerate(items or []):
        label = f'Model {idx + 1}'
        try:
            asset_id = str((item or {}).get('assetId') or '').strip()
            src = resolve_model_path(asset_id)
            if not src:
                errors.append(f'{label}: no 3D model connected or file missing')
                continue

            fname = _sanitize_filename(str((item or {}).get('fileName') or 'model'))
            candidate = f'{fname}.glb'
            n = 2
            while candidate.lower() in used_names:
                candidate = f'{fname}_{n}.glb'
                n += 1
            used_names.add(candidate.lower())

            out_path = os.path.join(folder, candidate)
            shutil.copy2(src, out_path)
            saved.append(out_path)
        except Exception as e:  # noqa: BLE001 — report per-item, keep going
            errors.append(f'{label}: {e}')

    return {'saved': saved, 'errors': errors}
