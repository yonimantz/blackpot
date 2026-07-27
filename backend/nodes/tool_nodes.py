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

# Keep in sync with frontend `MAX_STACK_IMAGES` in nodeTypes.ts
MAX_STACK_IMAGES = 12

# Keep in sync with frontend `MAX_DIVIDER_OUTPUTS` in nodeTypes.ts
MAX_DIVIDER_OUTPUTS = 16

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
    if node_type == 'getChannel':
        return _execute_get_channel(inputs)
    if node_type == 'setMask':
        return _execute_set_mask(data, inputs)
    if node_type == 'simpleCombine':
        return _execute_simple_combine(data, inputs)
    if node_type == 'removeBg':
        return _execute_remove_bg(data, inputs)
    if node_type == 'keyColor':
        return _execute_key_color(data, inputs)
    if node_type == 'stackImages':
        return _execute_stack_images(data, inputs)
    if node_type == 'divider':
        return _execute_divider(data, inputs)

    img_data = inputs.get('image') or data.get('image')
    if not img_data:
        raise ValueError(f"{node_type}: no image input")

    img = _decode_image(img_data)

    if node_type == 'resize':
        # The frontend keeps width/height in proportion when the user toggles
        # the aspect-lock button, so we always apply a literal resize here.
        w = max(1, int(inputs.get('width', data.get('width', 512))))
        h = max(1, int(inputs.get('height', data.get('height', 512))))
        img = img.resize((w, h), Image.LANCZOS)

    elif node_type == 'crop':
        x = int(inputs.get('x', data.get('x', 0)))
        y = int(inputs.get('y', data.get('y', 0)))
        w = int(inputs.get('width', data.get('width', 256)))
        h = int(inputs.get('height', data.get('height', 256)))
        img = img.crop((x, y, x + w, y + h))

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

    bg_img = _decode_image(bg_data).convert('RGBA')
    bg_hidden = bool(data.get('bgHidden', False))
    if bg_hidden:
        canvas = Image.new('RGBA', bg_img.size, (0, 0, 0, 0))
    else:
        canvas = bg_img.copy()

    layers_cfg = data.get('layers', {})
    layer_count = int(data.get('layerCount', 0))

    for i in range(1, layer_count + 1):
        layer_key = f'layer{i}'
        layer_data = inputs.get(layer_key)
        if not layer_data:
            continue

        layer_img = _decode_image(layer_data).convert('RGBA')
        cfg = layers_cfg.get(layer_key, {})
        if cfg.get('hidden'):
            continue

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


def _execute_get_channel(inputs: dict) -> dict:
    """Split image into 4 grayscale images: alpha, red, green, blue.

    Each output is a fully-opaque RGBA image where R=G=B equals that channel's
    intensity (0-255). Useful for visualising or feeding masks downstream.
    """
    img_data = inputs.get('image')
    if not img_data:
        raise ValueError('getChannel: no image input')

    img = _decode_image(img_data).convert('RGBA')
    arr = np.asarray(img, dtype=np.uint8)
    h, w = arr.shape[0], arr.shape[1]

    def _to_grey_rgba(channel: np.ndarray) -> str:
        out = np.empty((h, w, 4), dtype=np.uint8)
        out[:, :, 0] = channel
        out[:, :, 1] = channel
        out[:, :, 2] = channel
        out[:, :, 3] = 255
        return _encode_image(Image.fromarray(out, 'RGBA'))

    return {
        'red': _to_grey_rgba(arr[:, :, 0]),
        'green': _to_grey_rgba(arr[:, :, 1]),
        'blue': _to_grey_rgba(arr[:, :, 2]),
        'alpha': _to_grey_rgba(arr[:, :, 3]),
    }


def _execute_set_mask(data: dict, inputs: dict) -> dict:
    """Apply a grayscale mask to an image's alpha channel.

    White (255) in the mask = fully visible, black (0) = fully transparent.
    The `invert` option flips this. Mask is auto-resized to the image size.
    """
    img_data = inputs.get('image')
    mask_data = inputs.get('mask')
    if not img_data:
        raise ValueError('setMask: no image input')
    if not mask_data:
        raise ValueError('setMask: no mask input')

    img = _decode_image(img_data).convert('RGBA')
    mask_img = _decode_image(mask_data).convert('L')

    if mask_img.size != img.size:
        mask_img = mask_img.resize(img.size, Image.LANCZOS)

    mask_arr = np.asarray(mask_img, dtype=np.uint16)
    if data.get('invert', False):
        mask_arr = 255 - mask_arr

    arr = np.asarray(img, dtype=np.uint8).copy()
    # Multiply existing alpha by mask intensity so transparent pixels stay transparent.
    new_alpha = (arr[:, :, 3].astype(np.uint16) * mask_arr // 255).astype(np.uint8)
    arr[:, :, 3] = new_alpha

    return {'image': _encode_image(Image.fromarray(arr, 'RGBA'))}


def _execute_simple_combine(data: dict, inputs: dict) -> dict:
    """Composite image1 over image2 using a global opacity multiplier.

    Image 2 is the base; image 1 is overlaid on top with the given opacity
    (0-1). If image1 is smaller/larger, it is resized to match image2.
    """
    overlay_data = inputs.get('image1')
    base_data = inputs.get('image2')
    if not overlay_data and not base_data:
        raise ValueError('simpleCombine: no image inputs')
    if not base_data:
        # No base — just return the overlay so the workflow still produces output.
        return {'image': _encode_image(_decode_image(overlay_data).convert('RGBA'))}
    if not overlay_data:
        return {'image': _encode_image(_decode_image(base_data).convert('RGBA'))}

    base = _decode_image(base_data).convert('RGBA')
    overlay = _decode_image(overlay_data).convert('RGBA')

    if overlay.size != base.size:
        overlay = overlay.resize(base.size, Image.LANCZOS)

    opacity = float(np.clip(float(data.get('opacity', 1.0)), 0.0, 1.0))
    if opacity < 1.0:
        ov_arr = np.asarray(overlay, dtype=np.uint8).copy()
        ov_arr[:, :, 3] = (ov_arr[:, :, 3].astype(np.float32) * opacity).astype(np.uint8)
        overlay = Image.fromarray(ov_arr, 'RGBA')

    out = Image.alpha_composite(base, overlay)
    return {'image': _encode_image(out)}


def _hex_to_rgb(hex_str: str) -> tuple[float, float, float]:
    s = (hex_str or '#00ff00').strip()
    if s.startswith('#'):
        s = s[1:]
    if len(s) == 3:
        s = ''.join(c * 2 for c in s)
    if len(s) < 6:
        return (0.0, 255.0, 0.0)
    try:
        return (
            float(int(s[0:2], 16)),
            float(int(s[2:4], 16)),
            float(int(s[4:6], 16)),
        )
    except ValueError:
        return (0.0, 255.0, 0.0)


_REMBG_SESSION_CACHE: dict[str, object] = {}


def _safe_int(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _safe_float(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _parse_remove_bg_fill(fill_raw) -> tuple[int, int, int, int] | None:
    s = str(fill_raw or '').strip().lower()
    if not s or s == 'transparent':
        return None
    if s.startswith('#'):
        s = s[1:]
    if len(s) == 3:
        s = ''.join(ch * 2 for ch in s)
    if len(s) != 6:
        return None
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)
    except ValueError:
        return None


def _mask_binary_threshold(mask: Image.Image, threshold: int) -> Image.Image:
    if threshold <= 0:
        return mask
    arr = np.asarray(mask, dtype=np.uint8)
    out = np.where(arr >= np.uint8(threshold), np.uint8(255), np.uint8(0))
    return Image.fromarray(out, mode='L')


def _mask_erode(mask: Image.Image, amount: int) -> Image.Image:
    if amount <= 0:
        return mask
    size = max(3, amount * 2 + 1)
    if size % 2 == 0:
        size += 1
    return mask.filter(ImageFilter.MinFilter(size=size))


def _mask_dilate(mask: Image.Image, amount: int) -> Image.Image:
    if amount <= 0:
        return mask
    size = max(3, amount * 2 + 1)
    if size % 2 == 0:
        size += 1
    return mask.filter(ImageFilter.MaxFilter(size=size))


def _postprocess_remove_bg_mask(mask: Image.Image, data: dict) -> Image.Image:
    out = mask.convert('L')
    threshold = max(0, min(255, _safe_int(data.get('threshold'), 0)))
    feather = max(0.0, min(50.0, _safe_float(data.get('feather'), 0.0)))
    erode = max(0, min(20, _safe_int(data.get('erode'), 0)))
    dilate = max(0, min(20, _safe_int(data.get('dilate'), 0)))
    invert = bool(data.get('invert', False))

    out = _mask_binary_threshold(out, threshold)
    if erode > 0:
        out = _mask_erode(out, erode)
    if dilate > 0:
        out = _mask_dilate(out, dilate)
    if feather > 0:
        out = out.filter(ImageFilter.GaussianBlur(radius=feather))
    if invert:
        arr = np.asarray(out, dtype=np.uint8)
        out = Image.fromarray((255 - arr).astype(np.uint8), mode='L')
    return out


def _apply_mask_to_rgba(src_rgba: Image.Image, mask: Image.Image) -> Image.Image:
    src = src_rgba.convert('RGBA')
    alpha = np.asarray(src.getchannel('A'), dtype=np.uint16)
    mask_arr = np.asarray(mask.convert('L'), dtype=np.uint16)
    new_alpha = (alpha * mask_arr // 255).astype(np.uint8)
    out_arr = np.asarray(src, dtype=np.uint8).copy()
    out_arr[:, :, 3] = new_alpha
    return Image.fromarray(out_arr, mode='RGBA')


def _get_rembg_session(model_name: str):
    model = model_name.strip() or 'isnet-general-use'
    cached = _REMBG_SESSION_CACHE.get(model)
    if cached is not None:
        return cached
    try:
        from rembg import new_session
    except ImportError as e:
        raise ValueError(
            'removeBg: rembg is not installed. Run: pip install -U rembg[cpu]'
        ) from e
    session = new_session(model)
    _REMBG_SESSION_CACHE[model] = session
    return session


def run_remove_bg_raw(image_data: str, data: dict) -> dict[str, str]:
    src = _decode_image(image_data).convert('RGBA')
    session = _get_rembg_session(str(data.get('model', 'isnet-general-use')))

    alpha_matting = bool(data.get('alphaMatting', False))
    fg = max(0, min(255, _safe_int(data.get('fgThreshold'), 240)))
    bg = max(0, min(255, _safe_int(data.get('bgThreshold'), 10)))
    erode_size = max(0, min(50, _safe_int(data.get('erodeSize'), 10)))

    try:
        from rembg import remove
    except ImportError as e:
        raise ValueError(
            'removeBg: rembg is not installed. Run: pip install -U rembg[cpu]'
        ) from e

    cutout = remove(
        src,
        session=session,
        alpha_matting=alpha_matting,
        alpha_matting_foreground_threshold=fg,
        alpha_matting_background_threshold=bg,
        alpha_matting_erode_size=erode_size,
    )
    if not isinstance(cutout, Image.Image):
        cutout = src.copy()
    cutout = cutout.convert('RGBA')
    raw_mask = cutout.getchannel('A').convert('L')

    return {
        'rawImage': _encode_image(cutout),
        'rawMask': _encode_image(raw_mask.convert('RGB')),
    }


def _execute_remove_bg(data: dict, inputs: dict) -> dict:
    baked = data.get('_removeBgBaked')
    if isinstance(baked, str) and baked.startswith('data:'):
        return {'image': baked}

    img_data = inputs.get('image') or data.get('image')
    if not img_data:
        raise ValueError('removeBg: no image input')

    src = _decode_image(img_data).convert('RGBA')
    raw = run_remove_bg_raw(img_data, data)
    raw_mask = _decode_image(raw['rawMask']).convert('L')
    mask = _postprocess_remove_bg_mask(raw_mask, data)
    out = _apply_mask_to_rgba(src, mask)

    bg_fill = _parse_remove_bg_fill(data.get('bgFill'))
    if bg_fill is not None:
        solid = Image.new('RGBA', out.size, bg_fill)
        out = Image.alpha_composite(solid, out)

    return {'image': _encode_image(out)}


def _execute_key_color(data: dict, inputs: dict) -> dict:
    """Pass through the image baked by the Key Color editor modal.

    The modal computes the keyed RGBA at native resolution client-side and
    stores it on ``data._keyColorBaked``. The backend just hands that string
    back as the node's output — there's no algorithm here. If the user
    hasn't baked yet (or the baked field is empty) we forward the input
    image unchanged so downstream nodes still receive *something* and the
    workflow doesn't error out; the user simply sees the original image
    until they open the editor.
    """
    baked = data.get('_keyColorBaked')
    if isinstance(baked, str) and baked.startswith('data:'):
        return {'image': baked}

    img_data = inputs.get('image') or data.get('image')
    if not img_data:
        raise ValueError('keyColor: no image input — connect an image and open the editor')
    return {'image': img_data}


def _execute_stack_images(data: dict, inputs: dict) -> dict:
    """Stack N images horizontally or vertically.

    - ``direction`` is ``'horizontal'`` (default) or ``'vertical'``.
    - When ``stretch`` is True, every image is resized to match Image 1's
      exact width × height. The output along the stack axis is therefore
      ``image1_size * count``.
    - When ``stretch`` is False (default), each following image is scaled
      so its *cross-axis* dimension matches image 1 (preserves aspect ratio)
      and images are center-aligned on the cross axis — so mismatched
      ratios are padded with transparent pixels instead of being squashed.
    """
    count = int(data.get('imageCount') or 0)
    if count <= 0:
        count = MAX_STACK_IMAGES
    count = max(1, min(MAX_STACK_IMAGES, count))

    imgs: list[Image.Image] = []
    for i in range(1, count + 1):
        raw = inputs.get(f'image{i}')
        if not raw:
            continue
        imgs.append(_decode_image(raw).convert('RGBA'))

    if not imgs:
        raise ValueError('stackImages: connect at least one image')

    direction = str(data.get('direction', 'horizontal')).lower()
    if direction not in ('horizontal', 'vertical'):
        direction = 'horizontal'
    stretch = bool(data.get('stretch', False))

    first = imgs[0]
    fw, fh = first.size

    if stretch:
        normalized = [first] + [
            img.resize((fw, fh), Image.LANCZOS) if img.size != (fw, fh) else img
            for img in imgs[1:]
        ]
        if direction == 'horizontal':
            canvas = Image.new('RGBA', (fw * len(normalized), fh), (0, 0, 0, 0))
            x = 0
            for img in normalized:
                canvas.paste(img, (x, 0), img)
                x += fw
        else:
            canvas = Image.new('RGBA', (fw, fh * len(normalized)), (0, 0, 0, 0))
            y = 0
            for img in normalized:
                canvas.paste(img, (0, y), img)
                y += fh
        return {'image': _encode_image(canvas)}

    # Non-stretch: match cross-axis to image 1, preserve aspect, center on cross axis.
    normalized: list[Image.Image] = [first]
    if direction == 'horizontal':
        target_h = fh
        for img in imgs[1:]:
            w, h = img.size
            if h != target_h:
                ratio = target_h / float(h)
                new_w = max(1, int(round(w * ratio)))
                img = img.resize((new_w, target_h), Image.LANCZOS)
            normalized.append(img)
        total_w = sum(img.width for img in normalized)
        canvas = Image.new('RGBA', (total_w, target_h), (0, 0, 0, 0))
        x = 0
        for img in normalized:
            y = (target_h - img.height) // 2
            canvas.paste(img, (x, y), img)
            x += img.width
    else:
        target_w = fw
        for img in imgs[1:]:
            w, h = img.size
            if w != target_w:
                ratio = target_w / float(w)
                new_h = max(1, int(round(h * ratio)))
                img = img.resize((target_w, new_h), Image.LANCZOS)
            normalized.append(img)
        total_h = sum(img.height for img in normalized)
        canvas = Image.new('RGBA', (target_w, total_h), (0, 0, 0, 0))
        y = 0
        for img in normalized:
            x = (target_w - img.width) // 2
            canvas.paste(img, (x, y), img)
            y += img.height

    return {'image': _encode_image(canvas)}


def _parse_lasso_points(raw_points: list) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for p in raw_points:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            try:
                px = float(p[0])
                py = float(p[1])
                pts.append((px, py))
            except (TypeError, ValueError):
                continue
        elif isinstance(p, dict):
            try:
                px = float(p.get('x'))
                py = float(p.get('y'))
                pts.append((px, py))
            except (TypeError, ValueError):
                continue
    return pts


def _execute_divider(data: dict, inputs: dict) -> dict:
    img_data = inputs.get('image') or data.get('image')
    if not img_data:
        raise ValueError('divider: no image input')

    src_img = _decode_image(img_data)
    has_alpha = (
        src_img.mode in ('RGBA', 'LA')
        or (src_img.mode == 'P' and 'transparency' in src_img.info)
    )
    img = src_img.convert('RGBA' if has_alpha else 'RGB')
    iw, ih = img.size

    raw_selections = data.get('selections')
    selections = raw_selections if isinstance(raw_selections, list) else []
    outputs: dict[str, str] = {}

    for idx, sel in enumerate(selections[:MAX_DIVIDER_OUTPUTS], start=1):
        if not isinstance(sel, dict):
            continue

        kind = str(sel.get('kind', 'box')).lower()
        bbox: tuple[int, int, int, int] | None = None
        lasso_points: list[tuple[float, float]] | None = None

        if kind == 'lasso':
            raw_points = sel.get('points')
            if not isinstance(raw_points, list):
                continue
            lasso_points = _parse_lasso_points(raw_points)
            if len(lasso_points) < 3:
                continue
            xs = [p[0] for p in lasso_points]
            ys = [p[1] for p in lasso_points]
            x0 = int(math.floor(min(xs)))
            y0 = int(math.floor(min(ys)))
            x1 = int(math.ceil(max(xs)))
            y1 = int(math.ceil(max(ys)))
            bbox = (x0, y0, x1, y1)
        else:
            try:
                x = float(sel.get('x', 0))
                y = float(sel.get('y', 0))
                w = float(sel.get('w', 0))
                h = float(sel.get('h', 0))
            except (TypeError, ValueError):
                continue
            x0 = int(math.floor(min(x, x + w)))
            y0 = int(math.floor(min(y, y + h)))
            x1 = int(math.ceil(max(x, x + w)))
            y1 = int(math.ceil(max(y, y + h)))
            bbox = (x0, y0, x1, y1)

        bx0 = max(0, min(iw, bbox[0]))
        by0 = max(0, min(ih, bbox[1]))
        bx1 = max(0, min(iw, bbox[2]))
        by1 = max(0, min(ih, bbox[3]))
        if bx1 <= bx0 or by1 <= by0:
            continue

        cropped = img.crop((bx0, by0, bx1, by1))
        out_img = cropped

        if kind == 'lasso' and lasso_points is not None:
            mask = Image.new('L', cropped.size, 0)
            mask_points = [(px - bx0, py - by0) for (px, py) in lasso_points]
            ImageDraw.Draw(mask).polygon(mask_points, fill=255)

            if has_alpha:
                arr = np.asarray(cropped.convert('RGBA'), dtype=np.uint8).copy()
                mask_arr = np.asarray(mask, dtype=np.uint16)
                new_alpha = (arr[:, :, 3].astype(np.uint16) * mask_arr // 255).astype(np.uint8)
                arr[:, :, 3] = new_alpha
                out_img = Image.fromarray(arr, 'RGBA')
            else:
                arr = np.asarray(cropped.convert('RGB'), dtype=np.uint8).copy()
                keep = np.asarray(mask, dtype=np.uint8) > 0
                arr[~keep] = 0
                out_img = Image.fromarray(arr, 'RGB')

        outputs[f'out{idx}'] = _encode_image(out_img)

    return outputs
