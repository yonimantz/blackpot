import base64
import io
import numpy as np
from PIL import Image, ImageDraw
from collections import Counter


def _decode_image(data: str) -> Image.Image:
    if ',' in data:
        data = data.split(',', 1)[1]
    img_bytes = base64.b64decode(data)
    return Image.open(io.BytesIO(img_bytes))


def _encode_image(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    return f'data:image/png;base64,{b64}'


def _extract_palette(img: Image.Image, count: int) -> list[tuple[int, int, int]]:
    """Extract a color palette using K-Means clustering on image pixels."""
    sample = img.convert('RGB').resize((150, 150), Image.LANCZOS)
    pixels = np.array(sample).reshape(-1, 3).astype(np.float64)

    rng = np.random.default_rng(42)
    indices = rng.choice(len(pixels), size=min(count, len(pixels)), replace=False)
    centroids = pixels[indices].copy()

    for _ in range(20):
        dists = np.linalg.norm(pixels[:, None] - centroids[None, :], axis=2)
        labels = dists.argmin(axis=1)
        new_centroids = np.empty_like(centroids)
        for k in range(count):
            members = pixels[labels == k]
            new_centroids[k] = members.mean(axis=0) if len(members) > 0 else centroids[k]
        if np.allclose(centroids, new_centroids, atol=0.5):
            break
        centroids = new_centroids

    dists = np.linalg.norm(pixels[:, None] - centroids[None, :], axis=2)
    labels = dists.argmin(axis=1)
    cluster_sizes = np.bincount(labels, minlength=count)
    order = np.argsort(-cluster_sizes)

    return [tuple(int(c) for c in centroids[i]) for i in order]


def _build_swatch(colors: list[tuple[int, int, int]], swatch_h: int = 120) -> Image.Image:
    """Create a horizontal swatch strip image from a list of RGB tuples."""
    n = len(colors)
    cell_w = swatch_h
    swatch = Image.new('RGB', (cell_w * n, swatch_h), (0, 0, 0))
    draw = ImageDraw.Draw(swatch)
    for i, rgb in enumerate(colors):
        x0 = i * cell_w
        draw.rectangle([x0, 0, x0 + cell_w, swatch_h], fill=rgb)
    return swatch


def execute_read_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'getImageSize':
        img_data = inputs.get('image')
        if not img_data:
            raise ValueError("getImageSize: no image input")
        img = _decode_image(img_data)
        w, h = img.width, img.height
        return {'width': w, 'height': h, 'data': {'width': w, 'height': h}}

    elif node_type == 'getColorPalette':
        img_data = inputs.get('image')
        if not img_data:
            raise ValueError("getColorPalette: no image input")
        img = _decode_image(img_data)
        count = max(1, min(int(data.get('count', 5)), 30))
        palette = _extract_palette(img, count)
        hex_colors = ['#%02x%02x%02x' % c for c in palette]
        swatch_img = _build_swatch(palette)
        return {
            'image': _encode_image(swatch_img),
            'colors': ','.join(hex_colors),
            'data': {'colors': hex_colors},
        }

    return {}
