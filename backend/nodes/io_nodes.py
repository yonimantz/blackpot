import base64
import io
import os
from PIL import Image

EXPORT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'exports')
os.makedirs(EXPORT_DIR, exist_ok=True)


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
            raise ValueError("importImage: no file data provided")
        return {'image': file_data}

    elif node_type == 'exportImage':
        img_data = inputs.get('image')
        if not img_data:
            raise ValueError("exportImage: no image input")

        img = _decode_image(img_data)
        fmt = data.get('format', 'png').lower()
        fname = data.get('fileName', 'output')
        ext = fmt if fmt != 'jpg' else 'jpeg'

        export_path = data.get('exportPath', '').strip()
        if export_path:
            out_dir = os.path.dirname(export_path)
            if out_dir:
                os.makedirs(out_dir, exist_ok=True)
            out_path = export_path
            path_ext = os.path.splitext(export_path)[1].lstrip('.').lower()
            if path_ext in ('png', 'jpg', 'jpeg', 'webp'):
                fmt = path_ext if path_ext != 'jpeg' else 'jpg'
                ext = path_ext if path_ext != 'jpg' else 'jpeg'
        else:
            out_path = os.path.join(EXPORT_DIR, f'{fname}.{fmt}')

        if img.mode == 'RGBA' and fmt in ('jpg', 'jpeg'):
            img = img.convert('RGB')

        img.save(out_path, format=ext.upper())
        return {'saved': out_path, 'image': _encode_image(img, fmt)}

    elif node_type == 'preview':
        img_data = inputs.get('image')
        if not img_data:
            return {'image': ''}
        return {'image': img_data}

    return {}
