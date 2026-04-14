import uuid

REFMAPPER_OPENING = (
    'Take from the following references only what is mentioned below.'
)

REFMAPPER_ATTRIBUTES: dict[str, dict[str, str]] = {
    'pose': {
        'label': 'Pose',
        'phrase': 'From image {n}, use the pose as reference for the subject.',
    },
    'colorPalette': {
        'label': 'Color palette',
        'phrase': (
            'From image {n}, take the color palette—hue relationships, saturation, '
            'and value—and apply that same structure to the result.'
        ),
    },
    'brushwork': {
        'label': 'Brushwork',
        'phrase': (
            'From image {n}, analyze the brushwork and the painting style and '
            'reproduce them as faithfully as possible in the output.'
        ),
    },
    'composition': {
        'label': 'Composition',
        'phrase': (
            'From image {n}, analyze the composition and use it as a guide for '
            'framing, balance, and spatial arrangement in the result.'
        ),
    },
    'atmosphere': {
        'label': 'Atmosphere',
        'phrase': (
            'From image {n}, capture the atmosphere, mood, and overall feel, '
            'and carry that same sensibility into the result.'
        ),
    },
}

REFMAPPER_ORDERED_IDS = [
    'pose',
    'colorPalette',
    'brushwork',
    'composition',
    'atmosphere',
]

REFMAPPER_MAX_IMAGE_INDEX = 14

LEGACY_ATTR_MAP: dict[str, str] = {
    'composition': 'composition',
    'pose': 'pose',
    'atmosphere': 'atmosphere',
    'painterlyStyle': 'brushwork',
    'colorsPalette': 'colorPalette',
}


def _clamp_refmapper_image_index(n: int) -> int:
    try:
        x = int(n)
    except (TypeError, ValueError):
        return 1
    return max(1, min(REFMAPPER_MAX_IMAGE_INDEX, x))


def _migrate_refmapper_entry_row(raw: object) -> dict | None:
    if not isinstance(raw, dict):
        return None
    eid = raw.get('id')
    if not isinstance(eid, str) or not eid:
        eid = str(uuid.uuid4())
    image_index = _clamp_refmapper_image_index(raw.get('imageIndex', 1))
    attrs_in = raw.get('attributes')
    if not isinstance(attrs_in, list):
        attrs_in = []
    attr_set = {str(x) for x in attrs_in}
    attributes = [aid for aid in REFMAPPER_ORDERED_IDS if aid in attr_set]
    return {'id': eid, 'imageIndex': image_index, 'attributes': attributes}


def _legacy_refmapper_entries(data: dict) -> list[dict]:
    raw_count = int(data.get('refImageCount', 2) or 2)
    ref_count = max(1, min(8, raw_count))
    ref_attrs = data.get('refAttributes') or {}
    if not isinstance(ref_attrs, dict):
        ref_attrs = {}
    out: list[dict] = []
    for i in range(1, ref_count + 1):
        key = str(i)
        ids = ref_attrs.get(key) or ref_attrs.get(i)
        if not isinstance(ids, list):
            continue
        mapped = [
            aid
            for aid in REFMAPPER_ORDERED_IDS
            if any(LEGACY_ATTR_MAP.get(str(old)) == aid for old in ids)
        ]
        if not mapped:
            continue
        out.append({
            'id': f'legacy-slot-{i}',
            'imageIndex': _clamp_refmapper_image_index(i),
            'attributes': mapped,
        })
    return out


def _normalize_refmapper_entries(data: dict) -> list[dict]:
    raw = data.get('refMapperEntries')
    if isinstance(raw, list):
        rows = [_migrate_refmapper_entry_row(r) for r in raw]
        return [r for r in rows if r is not None]
    if ref_attrs := data.get('refAttributes'):
        if isinstance(ref_attrs, dict) and ref_attrs:
            return _legacy_refmapper_entries(data)
    if data.get('refImageCount') is not None:
        return _legacy_refmapper_entries(data)
    return []


def _build_ref_mapper_text(data: dict, _inputs: dict) -> str:
    entries = _normalize_refmapper_entries(data)
    lines: list[str] = []
    for entry in entries:
        n = _clamp_refmapper_image_index(entry.get('imageIndex', 1))
        for aid in REFMAPPER_ORDERED_IDS:
            attrs = entry.get('attributes') or []
            if not isinstance(attrs, list) or aid not in attrs:
                continue
            meta = REFMAPPER_ATTRIBUTES.get(aid)
            if not meta:
                continue
            phrase = str(meta['phrase']).format(n=n)
            lines.append(phrase)
    if not lines:
        return ''
    return REFMAPPER_OPENING + '\n\n' + '\n'.join(lines)


_SKETCH2FINAL_OPENING = 'Render this sketch into a polished version'

# Exact closing phrase for the sketch template block (keep in sync with frontend).
_SKETCH2FINAL_REMOVE_SOURCE_LINES = 'remove all visible lineart and sketch lines'

_SKETCH2FINAL_LEVEL_PARAGRAPHS: dict[str, str] = {
    'scratch': 'This is a doodle sketch. Use for high-level direction only.',
    'rough': 'This is a rough sketch. Use as a core guide.',
    'detailed': (
        'This is a high detailed sketch. Replicate all linework with 100% accuracy.'
    ),
}


def _sketch2final_sketch_block(data: dict) -> str:
    level = str(data.get('sketchLevel') or 'rough').lower()
    para = _SKETCH2FINAL_LEVEL_PARAGRAPHS.get(level) or _SKETCH2FINAL_LEVEL_PARAGRAPHS['rough']
    color_clause = 'Use color from sketch' if data.get('coloredSketch') else 'Color it professionally'
    return f'{para} {color_clause}. {_SKETCH2FINAL_REMOVE_SOURCE_LINES}'


def _build_sketch2final_text(data: dict, inputs: dict) -> str:
    base = inputs.get('prompt')
    if base is None or str(base).strip() == '':
        base = str(data.get('value') or data.get('fallbackPrompt') or '')
    else:
        base = str(base).strip()
    body = base.strip()
    sketch_block = _sketch2final_sketch_block(data)
    parts = [_SKETCH2FINAL_OPENING]
    if body:
        parts.append(body)
    parts.append(sketch_block)
    return '\n\n'.join(parts)


# Keep in sync with frontend `studioAttributes.ts`.
_STUDIO_LENS_PHRASES: dict[str, str] = {
    'wideAngle': (
        'Lens: wide-angle (14–35mm)—captures space; expect mild edge distortion.'
    ),
    'standard': 'Lens: standard (50mm)—similar to human vision; neutral perspective.',
    'telephoto': (
        'Lens: telephoto (85mm+)—compresses distance; shallow depth of field, '
        'blurred backgrounds.'
    ),
    'macro': 'Lens: macro—focuses extremely close; enlarged fine detail.',
}

_STUDIO_SHOT_PHRASES: dict[str, str] = {
    'wideShot': 'Shot: wide shot—broad framing of the scene.',
    'mediumShot': 'Shot: medium shot—balanced subject and context.',
    'closeUp': 'Shot: close-up—face or key subject fills most of the frame.',
    'extremeCloseUp': 'Shot: extreme close-up—tight on a small detail.',
    'longShot': 'Shot: long shot—full subject in environment, readable distance.',
    'arrivalShot': (
        'Shot: arrival shot—emphasize the subject entering the space and '
        'establishing presence.'
    ),
}

_STUDIO_VIEW_PHRASES: dict[str, str] = {
    'eyeLevel': 'Camera: eye level.',
    'lowAngle': 'Camera: low angle, looking up at the subject.',
    'highAngle': 'Camera: high angle, looking down at the subject.',
    'birdsEye': "Camera: bird's eye view, from above.",
    'orthoFront': 'View: orthographic front (parallel projection, head-on).',
    'orthoBack': 'View: orthographic back (parallel projection from behind).',
    'orthoLeft': 'View: orthographic left side (parallel projection).',
    'orthoRight': 'View: orthographic right side (parallel projection).',
    'orthoTop': 'View: orthographic top (parallel projection, from above).',
    'orthoBottom': 'View: orthographic bottom (parallel projection, from below).',
}

_STUDIO_DEFAULT_LENS = 'standard'
_STUDIO_DEFAULT_SHOT = 'mediumShot'
_STUDIO_DEFAULT_VIEW = 'eyeLevel'


def _normalize_studio_lens(raw: object) -> str:
    s = str(raw or '').strip()
    return s if s in _STUDIO_LENS_PHRASES else _STUDIO_DEFAULT_LENS


def _normalize_studio_shot(raw: object) -> str:
    s = str(raw or '').strip()
    return s if s in _STUDIO_SHOT_PHRASES else _STUDIO_DEFAULT_SHOT


def _normalize_studio_view(raw: object) -> str:
    s = str(raw or '').strip()
    return s if s in _STUDIO_VIEW_PHRASES else _STUDIO_DEFAULT_VIEW


def _studio_include(data: dict, key: str) -> bool:
    """Category toggles default to on when missing (matches frontend)."""
    return data.get(key) is not False


def _build_studio_text(data: dict, _inputs: dict) -> str:
    lens = _normalize_studio_lens(data.get('studioLens'))
    shot = _normalize_studio_shot(data.get('studioShot'))
    view = _normalize_studio_view(data.get('studioView'))
    parts: list[str] = []
    if _studio_include(data, 'studioIncludeLens'):
        parts.append(_STUDIO_LENS_PHRASES[lens])
    if _studio_include(data, 'studioIncludeShot'):
        parts.append(_STUDIO_SHOT_PHRASES[shot])
    if _studio_include(data, 'studioIncludeView'):
        parts.append(_STUDIO_VIEW_PHRASES[view])
    return '\n'.join(parts)


def execute_text_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'prompt':
        return {'text': str(data.get('value', ''))}
    elif node_type == 'combinePrompts':
        separator = data.get('separator', '\n')
        text_inputs = []
        for key in sorted(inputs.keys()):
            if key.startswith('text'):
                val = inputs[key]
                if val is not None:
                    text_inputs.append(str(val))
        combined = separator.join(text_inputs)
        return {'combined': combined}
    elif node_type == 'refMapper':
        s = _build_ref_mapper_text(data, inputs)
        return {'text': s, 'combined': s}
    elif node_type == 'sketch2Final':
        s = _build_sketch2final_text(data, inputs)
        return {'text': s, 'combined': s}
    elif node_type == 'studio':
        s = _build_studio_text(data, inputs)
        return {'text': s, 'combined': s}
    return {}
