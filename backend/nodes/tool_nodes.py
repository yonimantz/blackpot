import base64
import io
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np

from . import fal_common

# Keep in sync with frontend `MAX_COMPOSITOR_LAYERS` in nodeTypes.ts
MAX_COMPOSITOR_LAYERS = 24

# Keep in sync with frontend `MAX_VIGNETTE_LAYERS` in nodeTypes.ts
MAX_VIGNETTE_LAYERS = 4

# Keep in sync with frontend `MAX_STACK_IMAGES` in nodeTypes.ts
MAX_STACK_IMAGES = 12

# Keep in sync with frontend `MAX_DIVIDER_OUTPUTS` in nodeTypes.ts
MAX_DIVIDER_OUTPUTS = 16

# Background removal. Keep in sync with `MODELS` in RemoveBgModal.tsx.
REMOVE_BG_ENDPOINT = 'fal-ai/birefnet/v2'
REMOVE_BG_MODELS = (
    'General Use (Light)',
    'General Use (Light 2K)',
    'General Use (Heavy)',
    'Matting',
    'Portrait',
)
DEFAULT_REMOVE_BG_MODEL = 'General Use (Heavy)'
REMOVE_BG_RESOLUTIONS = ('1024x1024', '2048x2048')

# Model ids from the local rembg era, mapped to their closest birefnet variant so
# a workflow saved before the fal migration keeps working.
_LEGACY_REMBG_MODELS = {
    'u2net': 'General Use (Light)',
    'u2netp': 'General Use (Light)',
    'u2net_human_seg': 'Portrait',
    'isnet-general-use': 'General Use (Light)',
    'birefnet-general': 'General Use (Heavy)',
    'birefnet-portrait': 'Portrait',
}

_GREY_BG = (154, 154, 160, 255)

# Fraction of the free space that sits before the anchored box, per axis.
# Keep in sync with frontend `utils/anchorPlacement.ts`.
_ANCHOR_FRACTIONS = {
    'topLeft': (0.0, 0.0),
    'top': (0.5, 0.0),
    'topRight': (1.0, 0.0),
    'left': (0.0, 0.5),
    'center': (0.5, 0.5),
    'right': (1.0, 0.5),
    'bottomLeft': (0.0, 1.0),
    'bottom': (0.5, 1.0),
    'bottomRight': (1.0, 1.0),
}


def _js_round(value: float) -> int:
    """Round halves up, the way JS `Math.round` does, so the live previews in
    the frontend land on exactly the same pixel as a run."""
    return math.floor(value + 0.5)


def _anchor_origin(anchor: str, outer_w: int, outer_h: int, inner_w: int, inner_h: int):
    """Top-left corner of an `inner` box anchored inside an `outer` box."""
    fx, fy = _ANCHOR_FRACTIONS.get(anchor, _ANCHOR_FRACTIONS['center'])
    return _js_round((outer_w - inner_w) * fx), _js_round((outer_h - inner_h) * fy)


def _read_offset(data: dict):
    try:
        ox = int(data.get('offsetX', 0) or 0)
    except (TypeError, ValueError):
        ox = 0
    try:
        oy = int(data.get('offsetY', 0) or 0)
    except (TypeError, ValueError):
        oy = 0
    return ox, oy


def _place_on_transparent_canvas(src: Image.Image, w: int, h: int, x: int, y: int) -> Image.Image:
    """Paste `src` at (x, y) on a transparent w×h canvas, clipping overflow."""
    canvas = Image.new('RGBA', (max(1, w), max(1, h)), (0, 0, 0, 0))
    src = src.convert('RGBA')
    sx0 = max(0, -x)
    sy0 = max(0, -y)
    sx1 = min(src.width, canvas.width - x)
    sy1 = min(src.height, canvas.height - y)
    if sx1 > sx0 and sy1 > sy0:
        region = src.crop((sx0, sy0, sx1, sy1))
        canvas.paste(region, (x + sx0, y + sy0))
    return canvas

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
    """Synchronous, local-only tool nodes.

    `removeBg` is dispatched separately by the engine because it now calls fal
    and has to be awaited.
    """
    if node_type == 'editor':
        return _execute_editor(data, inputs)
    if node_type == 'compositor':
        return _execute_compositor(data, inputs)
    if node_type == 'vignette':
        return _execute_vignette(data, inputs)
    if node_type == 'adjustments':
        return _execute_adjustments(data, inputs)
    if node_type == 'getChannel':
        return _execute_get_channel(inputs)
    if node_type == 'setMask':
        return _execute_set_mask(data, inputs)
    if node_type == 'simpleCombine':
        return _execute_simple_combine(data, inputs)
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
        img = _apply_resize(data, inputs, img)

    elif node_type == 'crop':
        img = _apply_crop(data, inputs, img)

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


def _apply_resize(data: dict, inputs: dict, img: Image.Image) -> Image.Image:
    """Resize to W×H in one of three modes (see frontend `ResizeMode`):

    - ``stretch``: scale straight to W×H, distorting if the ratio differs.
    - ``fit``: scale proportionally to fit inside W×H, then anchor it in the
      frame; the uncovered area stays transparent.
    - ``canvas``: keep the pixels at their original size and change the frame
      to W×H, cropping when smaller and padding transparently when larger.

    In ``fit`` / ``canvas`` the anchor picks the corner, edge or center the
    image is aligned to, and offsetX/offsetY nudge it from there.
    """
    w = max(1, int(inputs.get('width', data.get('width', 512))))
    h = max(1, int(inputs.get('height', data.get('height', 512))))
    mode = data.get('resizeMode', 'stretch')
    if mode not in ('fit', 'canvas'):
        return img.resize((w, h), Image.LANCZOS)

    anchor = data.get('anchor', 'center')
    off_x, off_y = _read_offset(data)

    placed = img
    if mode == 'fit':
        scale = min(w / img.width, h / img.height)
        placed = img.resize(
            (max(1, _js_round(img.width * scale)), max(1, _js_round(img.height * scale))),
            Image.LANCZOS,
        )

    x, y = _anchor_origin(anchor, w, h, placed.width, placed.height)
    return _place_on_transparent_canvas(placed, w, h, x + off_x, y + off_y)


def _apply_crop(data: dict, inputs: dict, img: Image.Image) -> Image.Image:
    """Cut a W×H rectangle out of the image.

    With an anchor the rectangle is positioned automatically (corner, middle
    edge or center) and offsetX/offsetY nudge it; ``free`` — also the default
    for workflows saved before anchors existed — uses the stored x/y instead.
    A rectangle larger than the source pads transparently.
    """
    w = max(1, int(inputs.get('width', data.get('width', 256))))
    h = max(1, int(inputs.get('height', data.get('height', 256))))
    anchor = data.get('anchor', 'free')
    off_x, off_y = _read_offset(data)

    if anchor in _ANCHOR_FRACTIONS:
        x, y = _anchor_origin(anchor, img.width, img.height, w, h)
    else:
        x = int(inputs.get('x', data.get('x', 0)))
        y = int(inputs.get('y', data.get('y', 0)))

    x += off_x
    y += off_y

    # Keep the rectangle inside the source whenever it fits; when it is bigger
    # it stays where the anchor put it and the overflow is padded.
    if w <= img.width:
        x = max(0, min(x, img.width - w))
    if h <= img.height:
        y = max(0, min(y, img.height - h))

    if x < 0 or y < 0 or x + w > img.width or y + h > img.height:
        return _place_on_transparent_canvas(img, w, h, -x, -y)

    return img.crop((x, y, x + w, y + h))


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

        opacity = max(0.0, min(1.0, float(cfg.get('opacity', 1.0))))
        if opacity < 1.0:
            r, g, b, a = layer_img.split()
            a = a.point(lambda v: int(v * opacity))
            layer_img = Image.merge('RGBA', (r, g, b, a))

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


# Keep in sync with frontend `adjustmentsMath.ts` GAMMA_MIN / GAMMA_MAX.
_ADJUSTMENTS_GAMMA_MIN = 0.1
_ADJUSTMENTS_GAMMA_MAX = 10.0


def _num(v, default: float) -> float:
    """Coerce to a finite float, matching the frontend's `Number.isFinite` guard."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(f):
        return default
    return f


def _clamp_num(n: float, lo: float, hi: float) -> float:
    return lo if n < lo else hi if n > hi else n


def _normalize_adjustments(data: dict) -> dict:
    """Mirrors frontend `normalizeAdjustments`: clamps and fills gaps from a
    saved graph. Hue is clamped, not wrapped — only the per-pixel shift wraps.
    """
    lv = data.get('levels')
    if not isinstance(lv, dict):
        lv = {}
    return {
        'hue': _clamp_num(_num(data.get('hue'), 0.0), -180.0, 180.0),
        'saturation': _clamp_num(_num(data.get('saturation'), 0.0), -100.0, 100.0),
        'value': _clamp_num(_num(data.get('value'), 0.0), -100.0, 100.0),
        'levels': {
            'inBlack': _clamp_num(_num(lv.get('inBlack'), 0.0), 0.0, 255.0),
            'inWhite': _clamp_num(_num(lv.get('inWhite'), 255.0), 0.0, 255.0),
            'gamma': _clamp_num(_num(lv.get('gamma'), 1.0), _ADJUSTMENTS_GAMMA_MIN, _ADJUSTMENTS_GAMMA_MAX),
            'outBlack': _clamp_num(_num(lv.get('outBlack'), 0.0), 0.0, 255.0),
            'outWhite': _clamp_num(_num(lv.get('outWhite'), 255.0), 0.0, 255.0),
        },
    }


def _adjustments_levels_is_identity(l: dict) -> bool:
    return (
        l['inBlack'] == 0 and l['inWhite'] == 255 and l['gamma'] == 1
        and l['outBlack'] == 0 and l['outWhite'] == 255
    )


def _adjustments_is_identity(params: dict) -> bool:
    return (
        params['hue'] == 0 and params['saturation'] == 0 and params['value'] == 0
        and _adjustments_levels_is_identity(params['levels'])
    )


def _build_adjustments_levels_lut(l: dict):
    """256-entry input byte -> output byte map. Returns None when a no-op,
    mirroring frontend `buildLevelsLut`."""
    if _adjustments_levels_is_identity(l):
        return None

    in_black = l['inBlack']
    in_white = l['inWhite']
    out_black = l['outBlack']
    out_white = l['outWhite']
    gamma = l['gamma']
    span = in_white - in_black

    c = np.arange(256, dtype=np.float64)
    if span > 0:
        t = np.clip((c - in_black) / span, 0.0, 1.0)
    else:
        # Degenerate input range collapses to a hard threshold at inBlack.
        t = np.where(c <= in_black, 0.0, 1.0)
    if gamma != 1:
        t = np.power(t, 1.0 / gamma)

    out = np.clip(np.floor(out_black + t * (out_white - out_black) + 0.5), 0.0, 255.0)
    return out.astype(np.uint8)


def _adjustments_apply_hsv(rgb: np.ndarray, hue: float, saturation: float, value: float) -> np.ndarray:
    """Vectorized HSV shift over an (H, W, 3) float64 array in 0..255.

    Mirrors `colorsys.rgb_to_hsv` / `colorsys.hsv_to_rgb`, and the frontend's
    per-pixel loop in `applyAdjustmentsToRgba`. Returns float64 values already
    rounded (round-half-up) and clamped to 0..255 — the caller must byte-cast
    before the Levels stage, per the hard HSV-then-Levels contract.
    """
    r = rgb[:, :, 0] / 255.0
    g = rgb[:, :, 1] / 255.0
    b = rgb[:, :, 2] / 255.0

    maxc = np.maximum(np.maximum(r, g), b)
    minc = np.minimum(np.minimum(r, g), b)
    rng = maxc - minc
    range_eq_zero = rng == 0

    v = maxc
    safe_rng = np.where(range_eq_zero, 1.0, rng)
    safe_maxc = np.where(range_eq_zero, 1.0, maxc)
    s = np.where(range_eq_zero, 0.0, rng / safe_maxc)

    rc = (maxc - r) / safe_rng
    gc = (maxc - g) / safe_rng
    bc = (maxc - b) / safe_rng

    is_r_max = r == maxc
    is_g_max = (~is_r_max) & (g == maxc)
    h_raw = np.where(is_r_max, bc - gc, np.where(is_g_max, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(range_eq_zero, 0.0, np.mod(h_raw / 6.0, 1.0))

    h = np.mod(h + hue / 360.0, 1.0)
    s = np.clip(s * (1.0 + saturation / 100.0), 0.0, 1.0)
    v = np.clip(v * (1.0 + value / 100.0), 0.0, 1.0)

    h6 = h * 6.0
    i = np.floor(h6).astype(np.int64) % 6
    f = h6 - np.floor(h6)
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))

    conds = [i == 0, i == 1, i == 2, i == 3, i == 4]
    nr = np.select(conds, [v, q, p, p, t], default=v)
    ng = np.select(conds, [t, v, v, q, p], default=p)
    nb = np.select(conds, [p, p, t, v, v], default=q)

    out = np.empty_like(rgb)
    out[:, :, 0] = np.clip(np.floor(nr * 255.0 + 0.5), 0.0, 255.0)
    out[:, :, 1] = np.clip(np.floor(ng * 255.0 + 0.5), 0.0, 255.0)
    out[:, :, 2] = np.clip(np.floor(nb * 255.0 + 0.5), 0.0, 255.0)
    return out


def _execute_adjustments(data: dict, inputs: dict) -> dict:
    """Numpy twin of frontend `applyAdjustmentsToRgba` (adjustmentsMath.ts).

    HARD CONTRACT with the frontend: HSV first, then Levels, and the HSV
    result is rounded to 8 bits before the Levels LUT indexes it.
    """
    img_data = inputs.get('image') or data.get('image')
    if not img_data:
        raise ValueError('adjustments: no image input')

    img = _decode_image(img_data).convert('RGBA')
    params = _normalize_adjustments(data)
    if _adjustments_is_identity(params):
        return {'image': _encode_image(img)}

    do_hsv = params['hue'] != 0 or params['saturation'] != 0 or params['value'] != 0
    lut = _build_adjustments_levels_lut(params['levels'])
    if not do_hsv and lut is None:
        return {'image': _encode_image(img)}

    arr = np.asarray(img, dtype=np.float64)
    rgb = arr[:, :, :3]
    if do_hsv:
        rgb = _adjustments_apply_hsv(rgb, params['hue'], params['saturation'], params['value'])

    rgb_bytes = np.clip(rgb, 0.0, 255.0).astype(np.uint8)
    if lut is not None:
        rgb_bytes = lut[rgb_bytes]

    out = np.empty(arr.shape, dtype=np.uint8)
    out[:, :, :3] = rgb_bytes
    out[:, :, 3] = np.clip(arr[:, :, 3], 0.0, 255.0).astype(np.uint8)
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


def _resolve_remove_bg_model(raw) -> str:
    name = str(raw or '').strip()
    if name in REMOVE_BG_MODELS:
        return name
    return _LEGACY_REMBG_MODELS.get(name, DEFAULT_REMOVE_BG_MODEL)


async def _fetch_remove_bg_output(result: dict, key: str) -> Image.Image | None:
    node = (result or {}).get(key)
    url = node.get('url') if isinstance(node, dict) else None
    if not url:
        return None
    img_bytes, _mime, err = await fal_common.download_image(url, 'removeBg')
    if err:
        raise ValueError(err)
    return Image.open(io.BytesIO(img_bytes))


async def run_remove_bg_raw(image_data: str, data: dict) -> dict[str, str]:
    """Cut out the background and return both the cutout and its raw mask.

    The mask is what the node's threshold/feather/erode/dilate controls and the
    preview modal operate on, so it stays part of the contract even though fal
    hands us a finished cutout.
    """
    if not fal_common.HAS_FAL:
        raise ValueError(f'removeBg: {fal_common.MISSING_CLIENT_ERROR}')

    api_key = fal_common.resolve_api_key(data)
    if not api_key:
        raise ValueError(f'removeBg: {fal_common.NO_KEY_ERROR}')

    client = fal_common.make_client(api_key)
    try:
        image_url = await fal_common.upload_image(client, image_data)
    except Exception as e:
        raise ValueError(
            fal_common.describe_error('removeBg', REMOVE_BG_ENDPOINT, str(e))
        ) from e

    resolution = str(data.get('operatingResolution') or '1024x1024').strip()
    if resolution not in REMOVE_BG_RESOLUTIONS:
        resolution = '1024x1024'

    try:
        result = await client.subscribe(
            REMOVE_BG_ENDPOINT,
            arguments={
                'image_url': image_url,
                'model': _resolve_remove_bg_model(data.get('model')),
                'operating_resolution': resolution,
                'output_format': 'png',
                'refine_foreground': bool(data.get('refineForeground', True)),
                'output_mask': True,
            },
            with_logs=False,
        )
    except Exception as e:
        raise ValueError(
            fal_common.describe_error('removeBg', REMOVE_BG_ENDPOINT, str(e))
        ) from e

    cutout = await _fetch_remove_bg_output(result, 'image')
    if cutout is None:
        raise ValueError('removeBg: fal returned no image.')
    cutout = cutout.convert('RGBA')

    mask = await _fetch_remove_bg_output(result, 'mask_image')
    raw_mask = mask.convert('L') if mask is not None else cutout.getchannel('A').convert('L')

    # fal runs at its operating resolution, so the cutout can come back a
    # different size than the source; everything downstream composites the mask
    # against the original pixels.
    return {
        'rawImage': _encode_image(cutout),
        'rawMask': _encode_image(raw_mask.convert('RGB')),
    }


async def execute_remove_bg_node(data: dict, inputs: dict) -> dict:
    baked = data.get('_removeBgBaked')
    if isinstance(baked, str) and baked.startswith('data:'):
        return {'image': baked}

    img_data = inputs.get('image') or data.get('image')
    if not img_data:
        raise ValueError('removeBg: no image input')

    src = _decode_image(img_data).convert('RGBA')
    raw = await run_remove_bg_raw(img_data, data)
    raw_mask = _decode_image(raw['rawMask']).convert('L')
    if raw_mask.size != src.size:
        raw_mask = raw_mask.resize(src.size, Image.LANCZOS)
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
