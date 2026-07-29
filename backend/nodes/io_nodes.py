import base64
import io
import os
from PIL import Image

from paths import EXPORT_DIR, UPLOAD_DIR


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
