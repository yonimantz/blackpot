import base64
import io
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np

# Keep in sync with frontend `MAX_COMPOSITOR_LAYERS` in nodeTypes.ts
MAX_COMPOSITOR_LAYERS = 24

# Keep in sync with frontend `MAX_VIGNETTE_LAYERS` in nodeTypes.ts
MAX_VIGNETTE_LAYERS = 4

_GREY_BG = (154, 154, 160, 255)

def _decode_image(data: str) -> Image.Image:
    """Decode a base64 data URL or raw base64 string into a PIL Image."""
    if ',' in data:
        data = data.split(',', 1)[1]
    img_bytes = base64.b64decode(data)
    return Image.open(io.BytesIO(img_bytes))


def _encode_image(img: Image.Image, fmt: str = 'PNG') -> str:
    """Encode a PIL Image to a base64 data URL."""
    buf = io.BytesIO()
    if fmt.upper() == 'JPG':
        fmt = 'JPEG'
    if img.mode == 'RGBA' and fmt.upper() == 'JPEG':
        img = img.convert('RGB')
    img.save(buf, format=fmt.upper())
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    mime = 'image/png' if fmt.upper() == 'PNG' else f'image/{fmt.lower()}'
    return f'data:{mime};base64,{b64}'


def execute_tool_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'editor':
        return _execute_editor(data, inputs)
    if node_type == 'compositor':
        return _execute_compositor(data, inputs)
    if node_type == 'vignette':
        return _execute_vignette(data, inputs)

    img_data = inputs.get('image') or data.get('image')
    if not img_data:
        raise ValueError(f"{node_type}: no image input")

    img = _decode_image(img_data)

    if node_type == 'resize':
        w = int(inputs.get('width', data.get('width', 512)))
        h = int(inputs.get('height', data.get('height', 512)))
        keep_aspect = data.get('keepAspect', True)
        if keep_aspect:
            img.thumbnail((w, h), Image.LANCZOS)
        else:
            img = img.resize((w, h), Image.LANCZOS)

    elif node_type == 'crop':
        x = int(inputs.get('x', data.get('x', 0)))
        y = int(inputs.get('y', data.get('y', 0)))
        w = int(inputs.get('width', data.get('width', 256)))
        h = int(inputs.get('height', data.get('height', 256)))
        img = img.crop((x, y, x + w, y + h))

    elif node_type == 'setAlpha':
        alpha = float(inputs.get('alpha', data.get('alpha', 1.0)))
        img = img.convert('RGBA')
        arr = np.array(img)
        arr[:, :, 3] = (arr[:, :, 3] * alpha).astype(np.uint8)
        img = Image.fromarray(arr, 'RGBA')

    elif node_type == 'blur':
        radius = float(inputs.get('radius', data.get('radius', 2)))
        img = img.filter(ImageFilter.GaussianBlur(radius=radius))

    elif node_type == 'rotate':
        angle = float(inputs.get('angle', data.get('angle', 0)))
        flip_h = data.get('flipH', False)
        flip_v = data.get('flipV', False)
        if angle != 0:
            img = img.rotate(angle, expand=True, resample=Image.BICUBIC)
        if flip_h:
            img = img.transpose(Image.FLIP_LEFT_RIGHT)
        if flip_v:
            img = img.transpose(Image.FLIP_TOP_BOTTOM)

    return {'image': _encode_image(img)}


def _execute_editor(data: dict, inputs: dict) -> dict:
    bg_data = inputs.get('bgLayer')
    if not bg_data:
        raise ValueError("Editor: no BG Layer connected")

    canvas = _decode_image(bg_data).convert('RGBA')
    layers_cfg = data.get('layers', {})
    layer_count = int(data.get('layerCount', 0))

    for i in range(1, layer_count + 1):
        layer_key = f'layer{i}'
        layer_data = inputs.get(layer_key)
        if not layer_data:
            continue

        layer_img = _decode_image(layer_data).convert('RGBA')
        cfg = layers_cfg.get(layer_key, {})

        lw = int(cfg.get('width', 0))
        lh = int(cfg.get('height', 0))
        if lw > 0 and lh > 0:
            layer_img = layer_img.resize((lw, lh), Image.LANCZOS)
        elif lw > 0:
            ratio = lw / layer_img.width
            layer_img = layer_img.resize((lw, int(layer_img.height * ratio)), Image.LANCZOS)
        elif lh > 0:
            ratio = lh / layer_img.height
            layer_img = layer_img.resize((int(layer_img.width * ratio), lh), Image.LANCZOS)

        if cfg.get('flipH', False):
            layer_img = layer_img.transpose(Image.FLIP_LEFT_RIGHT)

        rotation = float(cfg.get('rotation', 0))
        if rotation != 0:
            layer_img = layer_img.rotate(-rotation, expand=True, resample=Image.BICUBIC)

        cx = int(cfg.get('x', 0))
        cy = int(cfg.get('y', 0))
        paste_x = cx - layer_img.width // 2
        paste_y = cy - layer_img.height // 2

        temp = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
        temp.paste(layer_img, (paste_x, paste_y), layer_img)
        canvas = Image.alpha_composite(canvas, temp)

    return {'image': _encode_image(canvas)}


def _vignette_norm_dist_circle(h: int, w: int) -> np.ndarray:
    """Distance from center in [0, 1], ~1 at corners (aspect-aware)."""
    ys = np.arange(h, dtype=np.float64)
    xs = np.arange(w, dtype=np.float64)
    xx, yy = np.meshgrid(xs, ys)
    cx = (w - 1) * 0.5
    cy = (h - 1) * 0.5
    half_w = max(w * 0.5, 1e-6)
    half_h = max(h * 0.5, 1e-6)
    dx = (xx - cx) / half_w
    dy = (yy - cy) / half_h
    d = np.sqrt(dx * dx + dy * dy) / math.sqrt(2.0)
    return np.clip(d, 0.0, 1.0)


def _vignette_norm_dist_square(h: int, w: int) -> np.ndarray:
    ys = np.arange(h, dtype=np.float64)
    xs = np.arange(w, dtype=np.float64)
    xx, yy = np.meshgrid(xs, ys)
    cx = (w - 1) * 0.5
    cy = (h - 1) * 0.5
    half_w = max(w * 0.5, 1e-6)
    half_h = max(h * 0.5, 1e-6)
    d = np.maximum(np.abs(xx - cx) / half_w, np.abs(yy - cy) / half_h)
    return np.clip(d, 0.0, 1.0)


def _execute_vignette(data: dict, inputs: dict) -> dict:
    img_data = inputs.get('image') or data.get('image')
    if not img_data:
        raise ValueError('vignette: no image input')

    raw_layers = data.get('vignetteLayers', [])
    if not isinstance(raw_layers, list) or len(raw_layers) == 0:
        return {'image': _encode_image(_decode_image(img_data).convert('RGBA'))}

    img = _decode_image(img_data).convert('RGBA')
    arr = np.asarray(img, dtype=np.float64)
    h, w = arr.shape[0], arr.shape[1]

    d_circle = _vignette_norm_dist_circle(h, w)
    d_square = _vignette_norm_dist_square(h, w)

    layers = raw_layers[:MAX_VIGNETTE_LAYERS]
    for layer in layers:
        if not isinstance(layer, dict):
            continue
        shape = str(layer.get('shape', 'circle')).lower()
        d = d_square if shape == 'square' else d_circle

        size = float(np.clip(float(layer.get('size', 0.5)), 0.0, 1.0))
        feather = float(np.clip(float(layer.get('feather', 0.5)), 0.0, 1.0))
        opacity = float(np.clip(float(layer.get('opacity', 0.5)), 0.0, 1.0))
        cr, cg, cb, _ = _parse_compositor_color(layer.get('color'))
        blend_mode = str(layer.get('blendMode', 'normal')).lower()

        clear_r = (1.0 - size) * 0.92
        denom = max(1e-6, 1.0 - clear_r)
        raw = np.clip((d - clear_r) / denom, 0.0, 1.0)
        power = 1.0 / (0.25 + feather * 3.5)
        m = np.power(raw, power)
        am = m * opacity

        br = arr[:, :, 0]
        bg_ = arr[:, :, 1]
        bb = arr[:, :, 2]

        if blend_mode == 'multiply':
            mr = (br / 255.0) * (cr / 255.0) * 255.0
            mg = (bg_ / 255.0) * (cg / 255.0) * 255.0
            mb = (bb / 255.0) * (cb / 255.0) * 255.0
            arr[:, :, 0] = br * (1.0 - am) + mr * am
            arr[:, :, 1] = bg_ * (1.0 - am) + mg * am
            arr[:, :, 2] = bb * (1.0 - am) + mb * am
        elif blend_mode == 'screen':
            sr = 255.0 - (255.0 - br) * (255.0 - cr) / 255.0
            sg = 255.0 - (255.0 - bg_) * (255.0 - cg) / 255.0
            sb = 255.0 - (255.0 - bb) * (255.0 - cb) / 255.0
            arr[:, :, 0] = br * (1.0 - am) + sr * am
            arr[:, :, 1] = bg_ * (1.0 - am) + sg * am
            arr[:, :, 2] = bb * (1.0 - am) + sb * am
        else:
            arr[:, :, 0] = br * (1.0 - am) + cr * am
            arr[:, :, 1] = bg_ * (1.0 - am) + cg * am
            arr[:, :, 2] = bb * (1.0 - am) + cb * am

    out = np.clip(arr, 0.0, 255.0).astype(np.uint8)
    return {'image': _encode_image(Image.fromarray(out, 'RGBA'))}


def _parse_compositor_color(s):
    raw = (s or '#6366f1').strip()
    if raw.startswith('#'):
        raw = raw[1:]
    if len(raw) == 3:
        raw = ''.join(c * 2 for c in raw)
    if len(raw) >= 6:
        try:
            return (
                int(raw[0:2], 16),
                int(raw[2:4], 16),
                int(raw[4:6], 16),
                255,
            )
        except ValueError:
            pass
    return (99, 102, 241, 255)


def _compositor_truetype_font(size: int):
    px = max(8, min(int(size), 256))
    candidates = [
        os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', 'arial.ttf'),
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            try:
                return ImageFont.truetype(path, px)
            except OSError:
                continue
    return ImageFont.load_default()


def _execute_compositor(data: dict, inputs: dict) -> dict:
    w = max(1, min(8192, int(data.get('width', 512))))
    h = max(1, min(8192, int(data.get('height', 512))))

    bg_data = inputs.get('background')
    if bg_data:
        canvas = _decode_image(bg_data).convert('RGBA').resize((w, h), Image.LANCZOS)
    else:
        canvas = Image.new('RGBA', (w, h), _GREY_BG)

    raw_layers = data.get('layers', [])
    if not isinstance(raw_layers, list):
        raw_layers = []
    layers = raw_layers[:MAX_COMPOSITOR_LAYERS]

    draw = ImageDraw.Draw(canvas)

    for layer in layers:
        if not isinstance(layer, dict):
            continue
        kind = str(layer.get('kind', '')).lower()
        fill = _parse_compositor_color(layer.get('color'))

        try:
            if kind == 'line':
                x1 = float(layer.get('x1', 0))
                y1 = float(layer.get('y1', 0))
                x2 = float(layer.get('x2', w))
                y2 = float(layer.get('y2', h))
                sw = max(1, int(layer.get('strokeWidth', 2)))
                draw.line([(x1, y1), (x2, y2)], fill=fill, width=sw)

            elif kind == 'circle':
                cx = float(layer.get('cx', w / 2))
                cy = float(layer.get('cy', h / 2))
                r = max(1.0, float(layer.get('r', 40)))
                bbox = (cx - r, cy - r, cx + r, cy + r)
                draw.ellipse(bbox, fill=fill)

            elif kind == 'square':
                x = float(layer.get('x', 0))
                y = float(layer.get('y', 0))
                rw = max(1.0, float(layer.get('w', 80)))
                rh = max(1.0, float(layer.get('h', 80)))
                rot = float(layer.get('rotation', 0))
                cx = x + rw / 2
                cy = y + rh / 2
                if abs(rot) < 1e-6:
                    draw.rectangle([x, y, x + rw, y + rh], fill=fill)
                else:
                    rad = math.radians(rot)
                    hw, hh = rw / 2, rh / 2
                    poly = []
                    for lx, ly in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)):
                        wx = cx + lx * math.cos(rad) + ly * math.sin(rad)
                        wy = cy - lx * math.sin(rad) + ly * math.cos(rad)
                        poly.append((wx, wy))
                    draw.polygon(poly, fill=fill)

            elif kind == 'triangle':
                pts = [
                    (float(layer.get('x1', w / 2)), float(layer.get('y1', h / 4))),
                    (float(layer.get('x2', w / 4)), float(layer.get('y2', 3 * h / 4))),
                    (float(layer.get('x3', 3 * w / 4)), float(layer.get('y3', 3 * h / 4))),
                ]
                draw.polygon(pts, fill=fill)

            elif kind == 'text':
                tx = float(layer.get('x', 8))
                ty = float(layer.get('y', 24))
                txt = str(layer.get('text', 'Text'))
                fs = max(8, min(256, int(layer.get('fontSize', 16))))
                rot = float(layer.get('rotation', 0))
                font = _compositor_truetype_font(fs)
                if abs(rot) < 1e-6:
                    try:
                        draw.text((tx, ty), txt, font=font, fill=fill, anchor='lt')
                    except TypeError:
                        draw.text((tx, ty), txt, font=font, fill=fill)
                else:
                    tmp = Image.new('RGBA', (1, 1), (0, 0, 0, 0))
                    td = ImageDraw.Draw(tmp)
                    try:
                        bbox = td.textbbox((0, 0), txt, font=font, anchor='lt')
                        tw = max(2, int(bbox[2] - bbox[0]) + 6)
                        th = max(2, int(bbox[3] - bbox[1]) + 6)
                    except (TypeError, AttributeError, ValueError):
                        tw = max(2, int(fs * max(1, len(txt)) * 0.55) + 6)
                        th = fs + 6
                    tmp2 = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
                    td2 = ImageDraw.Draw(tmp2)
                    try:
                        td2.text((3, 3), txt, font=font, fill=fill, anchor='lt')
                    except TypeError:
                        td2.text((3, 3), txt, font=font, fill=fill)
                    tmp2 = tmp2.rotate(-rot, expand=True, resample=Image.BICUBIC)
                    canvas.alpha_composite(tmp2, (int(tx), int(ty)))
        except (TypeError, ValueError):
            continue

    return {'image': _encode_image(canvas)}
