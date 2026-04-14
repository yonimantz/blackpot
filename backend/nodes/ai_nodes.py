import asyncio
import base64
import io
import os

from PIL import Image

try:
    from google import genai
    from google.genai import types
    _HAS_GENAI = True
except ImportError:
    _HAS_GENAI = False

NANO_MODEL = 'gemini-3-pro-image-preview'
NANO2_MODEL = 'gemini-3.1-flash-image-preview'
# gemini-2.0-flash is not available to new API users; 2.5 Flash is the current workhorse for vision→text.
IMAGE_ANALYZER_MODEL = 'gemini-2.5-flash'

# Integer upscale factors applied to API-native output (1k). "512" is handled by downscaling.
RESOLUTION_SCALE = {
    '1k': 1,
    '2k': 2,
    '4k': 4,
}

PERSON_GEN_MAP = {
    'allow_adult': 'ALLOW_ADULT',
    'dont_allow': 'ALLOW_NONE',
    'allow_all': 'ALLOW_ALL',
}

ASPECT_RATIO_HINT = {
    '1:1': 'square (1:1 aspect ratio, equal width and height)',
    '3:4': 'portrait 3:4 aspect ratio (taller than wide)',
    '4:3': 'landscape 4:3 aspect ratio (wider than tall)',
    '3:2': 'landscape 3:2 classic photo aspect ratio (wider than tall)',
    '2:3': 'portrait 2:3 aspect ratio (taller than wide)',
    '9:16': 'tall portrait 9:16 vertical aspect ratio',
    '16:9': 'widescreen 16:9 horizontal aspect ratio',
    '21:9': 'ultra-wide 21:9 cinematic aspect ratio',
}

ASPECT_RATIO_HINT_EXTENDED = {
    **ASPECT_RATIO_HINT,
    '5:4': 'landscape 5:4 aspect ratio (slightly wider than tall)',
    '4:5': 'portrait 4:5 aspect ratio (slightly taller than wide)',
    '1:2': 'tall portrait 1:2 vertical aspect ratio (double height)',
    '2:1': 'wide landscape 2:1 horizontal aspect ratio (double width)',
    '1:8': 'extreme vertical 1:8 tower aspect ratio',
    '8:1': 'extreme horizontal 8:1 banner aspect ratio',
}

THINKING_BUDGET = {
    'minimal': 1024,
    'high': 8192,
    'dynamic': 0,
}


def resolve_gemini_api_key(data: dict) -> str:
    """Per-node apiKey overrides user key from run context, then GEMINI_API_KEY env."""
    node_key = (data.get('apiKey', '') or '').strip()
    if node_key:
        return node_key
    try:
        from request_context import get_run_context
        ctx = get_run_context()
        if ctx and ctx.gemini_user_key and str(ctx.gemini_user_key).strip():
            return str(ctx.gemini_user_key).strip()
    except Exception:
        pass
    return os.getenv('GEMINI_API_KEY', '').strip()


def _is_gemini_api_key_auth_error(err_msg: str) -> bool:
    """True when Google indicates the API key is missing/invalid (various message shapes)."""
    u = err_msg.upper()
    return (
        'API_KEY_INVALID' in u
        or 'API KEY NOT VALID' in u
        or 'INVALID API KEY' in u
        or 'API_KEY' in u
        or '401' in err_msg
        or '403' in err_msg
    )


def _strip_data_url(data_url: str) -> str:
    """Return raw base64 from a data-URL or pass through if already raw."""
    if ',' in data_url:
        return data_url.split(',', 1)[1]
    return data_url


def _downscale_max_long_edge(img_bytes: bytes, max_px: int, mime: str) -> bytes:
    """Shrink so the longest side is at most max_px (aspect ratio preserved)."""
    img = Image.open(io.BytesIO(img_bytes))
    w, h = img.size
    long_edge = max(w, h)
    if long_edge <= max_px:
        return img_bytes
    scale_f = max_px / long_edge
    new_w = max(1, int(round(w * scale_f)))
    new_h = max(1, int(round(h * scale_f)))
    img = img.resize((new_w, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    fmt = 'PNG' if 'png' in mime else 'JPEG'
    img.save(buf, format=fmt)
    return buf.getvalue()


def _upscale_image(img_bytes: bytes, scale: int, mime: str) -> bytes:
    """Upscale image by integer factor using Lanczos resampling."""
    if scale <= 1:
        return img_bytes
    img = Image.open(io.BytesIO(img_bytes))
    new_size = (img.width * scale, img.height * scale)
    img = img.resize(new_size, Image.LANCZOS)
    buf = io.BytesIO()
    fmt = 'PNG' if 'png' in mime else 'JPEG'
    img.save(buf, format=fmt)
    return buf.getvalue()


def _apply_resolution_output(img_bytes: bytes, resolution: str, mime: str) -> bytes:
    """512 = downscale prototype; 1k = native; 2k/4k = upscale from native."""
    if resolution == '512':
        img_bytes = _downscale_max_long_edge(img_bytes, 512, mime)
    scale = RESOLUTION_SCALE.get(resolution, 1)
    if scale > 1:
        img_bytes = _upscale_image(img_bytes, scale, mime)
    return img_bytes


# ---------------------------------------------------------------------------
# Nano Banana Pro  —  Gemini 3 Pro Image via google-genai SDK
# ---------------------------------------------------------------------------

def _collect_reference_images(inputs: dict) -> list[str]:
    """Gather base64 strings from reference image input ports (dynamic count)."""
    refs = []
    i = 1
    while True:
        img = inputs.get(f'referenceImage{i}')
        if img:
            refs.append(_strip_data_url(img))
            i += 1
        else:
            break
    return refs


async def _execute_nano_banana_pro(data: dict, inputs: dict) -> dict:
    if not _HAS_GENAI:
        raise ValueError(
            "Nano Banana Pro: google-genai package is not installed. "
            "Run: pip install -U google-genai"
        )

    api_key = resolve_gemini_api_key(data)
    if not api_key:
        raise ValueError(
            "Nano Banana Pro: no API key configured. "
            "Add your key in Settings, set GEMINI_API_KEY in backend/.env, or set apiKey on the node."
        )

    prompt = inputs.get('prompt') or data.get('prompt', '')
    if not prompt:
        raise ValueError("Nano Banana Pro: no prompt provided")

    aspect_ratio = data.get('aspectRatio', '1:1')
    resolution = data.get('resolution', '1k')
    output_mime = data.get('outputMimeType', 'image/png')
    seed_val = int(data.get('seed', 0))

    ref_images = _collect_reference_images(inputs)

    client = genai.Client(api_key=api_key)

    image_config = types.ImageConfig(
        aspect_ratio=aspect_ratio,
    )

    config_kwargs: dict = {
        'response_modalities': ['IMAGE'],
        'image_config': image_config,
    }
    if seed_val > 0:
        config_kwargs['seed'] = seed_val

    gen_config = types.GenerateContentConfig(**config_kwargs)

    ratio_hint = ASPECT_RATIO_HINT.get(aspect_ratio, f'{aspect_ratio} aspect ratio')
    augmented_prompt = f"{prompt}\n\n[Generate this image in {ratio_hint}.]"

    contents: list = []
    if ref_images:
        for ref_b64 in ref_images:
            raw_bytes = base64.b64decode(ref_b64)
            contents.append(
                types.Part.from_bytes(data=raw_bytes, mime_type='image/png')
            )
    contents.append(augmented_prompt)

    # #region agent log
    import json as _json, time as _time, pathlib as _pathlib
    _lp = _pathlib.Path(__file__).resolve().parent.parent.parent / 'debug-5a1439.log'
    _lp.open('a').write(_json.dumps({"sessionId":"5a1439","location":"ai_nodes.py:config","message":"config built","data":{"aspect_ratio":aspect_ratio,"resolution":resolution,"seed_val":seed_val,"model":NANO_MODEL,"image_config_str":str(image_config),"gen_config_str":str(gen_config),"prompt_len":len(prompt),"ref_count":len(ref_images)},"timestamp":int(_time.time()*1000),"hypothesisId":"H1,H3"})+'\n')
    # #endregion

    def _sync_generate():
        return client.models.generate_content(
            model=NANO_MODEL,
            contents=contents,
            config=gen_config,
        )

    try:
        response = await asyncio.to_thread(_sync_generate)
        # #region agent log
        _lp.open('a').write(_json.dumps({"sessionId":"5a1439","location":"ai_nodes.py:api_ok","message":"API call succeeded","data":{"has_candidates":bool(getattr(response,'candidates',None))},"timestamp":int(_time.time()*1000),"hypothesisId":"H2,H4"})+'\n')
        # #endregion
    except Exception as e:
        err_msg = str(e)
        # #region agent log
        _lp.open('a').write(_json.dumps({"sessionId":"5a1439","location":"ai_nodes.py:api_error","message":"API call FAILED","data":{"error":err_msg[:500],"error_type":type(e).__name__},"timestamp":int(_time.time()*1000),"hypothesisId":"H1,H2"})+'\n')
        # #endregion
        if _is_gemini_api_key_auth_error(err_msg):
            return {'error': f'Nano Banana Pro: Invalid or expired API key. Check your Gemini API key. ({err_msg})'}
        if 'not found' in err_msg.lower() or '404' in err_msg:
            return {'error': f'Nano Banana Pro: Model "{NANO_MODEL}" not found. You may need access or a different model name. ({err_msg})'}
        return {'error': f'Nano Banana Pro: API call failed — {err_msg}'}

    candidates = getattr(response, 'candidates', None)
    if not candidates:
        block_reason = getattr(response, 'prompt_feedback', None)
        extra = f' (block reason: {block_reason})' if block_reason else ''
        return {'error': f'Nano Banana Pro: API returned no candidates.{extra}'}

    parts = candidates[0].content.parts if candidates[0].content else []
    if not parts:
        return {'error': 'Nano Banana Pro: response contained no parts'}

    for part in parts:
        inline = getattr(part, 'inline_data', None)
        if inline and inline.data:
            img_bytes = inline.data
            mime = getattr(inline, 'mime_type', None) or output_mime

            if isinstance(img_bytes, str):
                img_bytes = base64.b64decode(img_bytes)

            # #region agent log
            try:
                _tmp_img = Image.open(io.BytesIO(img_bytes))
                _lp.open('a').write(_json.dumps({"sessionId":"5a1439","location":"ai_nodes.py:image_dims","message":"returned image dimensions","data":{"width":_tmp_img.width,"height":_tmp_img.height,"mime":mime,"requested_aspect":aspect_ratio},"timestamp":int(_time.time()*1000),"hypothesisId":"H4,H5"})+'\n')
            except Exception:
                pass
            # #endregion

            img_bytes = _apply_resolution_output(img_bytes, resolution, mime)

            b64 = base64.b64encode(img_bytes).decode('ascii')
            return {'image': f'data:{mime};base64,{b64}'}

    return {'error': 'Nano Banana Pro: response contained no image data'}


# ---------------------------------------------------------------------------
# Nano Banana 2  —  Gemini 3.1 Flash Image via google-genai SDK
# ---------------------------------------------------------------------------

async def _execute_nano_banana_2(data: dict, inputs: dict) -> dict:
    if not _HAS_GENAI:
        raise ValueError(
            "Nano Banana 2: google-genai package is not installed. "
            "Run: pip install -U google-genai"
        )

    api_key = resolve_gemini_api_key(data)
    if not api_key:
        raise ValueError(
            "Nano Banana 2: no API key configured. "
            "Add your key in Settings, set GEMINI_API_KEY in backend/.env, or set apiKey on the node."
        )

    prompt = inputs.get('prompt') or data.get('prompt', '')
    if not prompt:
        raise ValueError("Nano Banana 2: no prompt provided")

    aspect_ratio = data.get('aspectRatio', '1:1')
    resolution = data.get('resolution', '1k')
    output_mime = data.get('outputMimeType', 'image/png')
    seed_val = int(data.get('seed', 0))
    thinking_mode = data.get('thinkingMode', 'off')

    ref_images = _collect_reference_images(inputs)

    client = genai.Client(api_key=api_key)

    image_config = types.ImageConfig(
        aspect_ratio=aspect_ratio,
    )

    config_kwargs: dict = {
        'response_modalities': ['IMAGE'],
        'image_config': image_config,
    }
    if seed_val > 0:
        config_kwargs['seed'] = seed_val

    if thinking_mode != 'off' and thinking_mode in THINKING_BUDGET:
        budget = THINKING_BUDGET[thinking_mode]
        if budget > 0:
            config_kwargs['thinking_config'] = types.ThinkingConfig(
                thinking_budget=budget,
            )
        else:
            config_kwargs['thinking_config'] = types.ThinkingConfig()

    gen_config = types.GenerateContentConfig(**config_kwargs)

    ratio_hint = ASPECT_RATIO_HINT_EXTENDED.get(aspect_ratio, f'{aspect_ratio} aspect ratio')
    augmented_prompt = f"{prompt}\n\n[Generate this image in {ratio_hint}.]"

    contents: list = []
    if ref_images:
        for ref_b64 in ref_images:
            raw_bytes = base64.b64decode(ref_b64)
            contents.append(
                types.Part.from_bytes(data=raw_bytes, mime_type='image/png')
            )
    contents.append(augmented_prompt)

    def _sync_generate():
        return client.models.generate_content(
            model=NANO2_MODEL,
            contents=contents,
            config=gen_config,
        )

    try:
        response = await asyncio.to_thread(_sync_generate)
    except Exception as e:
        err_msg = str(e)
        if _is_gemini_api_key_auth_error(err_msg):
            return {'error': f'Nano Banana 2: Invalid or expired API key. Check your Gemini API key. ({err_msg})'}
        if 'not found' in err_msg.lower() or '404' in err_msg:
            return {'error': f'Nano Banana 2: Model "{NANO2_MODEL}" not found. You may need access or a different model name. ({err_msg})'}
        return {'error': f'Nano Banana 2: API call failed — {err_msg}'}

    candidates = getattr(response, 'candidates', None)
    if not candidates:
        block_reason = getattr(response, 'prompt_feedback', None)
        extra = f' (block reason: {block_reason})' if block_reason else ''
        return {'error': f'Nano Banana 2: API returned no candidates.{extra}'}

    parts = candidates[0].content.parts if candidates[0].content else []
    if not parts:
        return {'error': 'Nano Banana 2: response contained no parts'}

    for part in parts:
        inline = getattr(part, 'inline_data', None)
        if inline and inline.data:
            img_bytes = inline.data
            mime = getattr(inline, 'mime_type', None) or output_mime

            if isinstance(img_bytes, str):
                img_bytes = base64.b64decode(img_bytes)

            img_bytes = _apply_resolution_output(img_bytes, resolution, mime)

            b64 = base64.b64encode(img_bytes).decode('ascii')
            return {'image': f'data:{mime};base64,{b64}'}

    return {'error': 'Nano Banana 2: response contained no image data'}


# ---------------------------------------------------------------------------
# Image SCF prompt — vision model, text-only output (Style / Content / Feel)
# ---------------------------------------------------------------------------

def _mime_from_image_data_url(data_url: str) -> str:
    if data_url.startswith('data:'):
        semi = data_url.find(';')
        if semi > 5:
            mime = data_url[5:semi].strip().lower()
            if mime in ('image/png', 'image/jpeg', 'image/jpg', 'image/webp'):
                return 'image/jpeg' if mime == 'image/jpg' else mime
    return 'image/png'


def _build_image_scf_instruction(data: dict) -> tuple[str | None, str | None]:
    """Return (error_message, user_text) or (None, instruction)."""
    style = bool(data.get('analyzeStyle', True))
    content = bool(data.get('analyzeContent', True))
    feel = bool(data.get('analyzeFeel', True))
    if not style and not content and not feel:
        return ('Image SCF: enable at least one of Style, Content, or Feel.', '')

    sections: list[str] = []
    if style:
        sections.append(
            '## Style\n'
            'Very short guide for an image-generation model—compact phrases or a tiny bullet list, '
            'not prose.\n'
            'Cover ONLY:\n'
            '- Brushwork / mark-making (how paint or strokes read: loose, tight, visible strokes, smooth, etc.).\n'
            '- Medium / material read: e.g. oil, acrylic, watercolor, pencil, photo, 3D render, digital paint; '
            'expressive vs realistic vs stylized (pick what fits).\n'
            '- A few technical tags only: detail level (low vs high), contrast (low/medium/high), '
            'saturation / vibrance (muted, rich, flat, etc.), flat vs dimensional if relevant.\n'
            'Do NOT describe subject matter, story, or scene. Do NOT name specific colors or hex codes.\n'
            'Cap the whole section at roughly 3–6 short lines total.'
        )
    if content:
        sections.append(
            '## Content\n'
            'Very short: who/what, pose, expression, key props or setting—in sparse phrases for another '
            'model to follow. No medium, no brushwork, no mood essay, no palette.\n'
            'About 2–4 short lines max.'
        )
    if feel:
        sections.append(
            '## Feel\n'
            'Very short mood tags or one line (e.g. calm, tense, playful). No scene list, no technique, '
            'no colors.\n'
            'One or two short lines max.'
        )

    header = (
        'You are given one image. Output a compact text guide another AI will use as a prompt—terse '
        'tags and short phrases, not long paragraphs.\n'
        'Follow the sections below exactly. Include ONLY the sections requested—use the exact '
        'markdown headers shown. Omit any section that is not listed below. Do not write '
        '"N/A" or placeholders for omitted sections.\n\n'
        'Requested sections (in this order):\n'
    )
    order_labels: list[str] = []
    if style:
        order_labels.append('Style')
    if content:
        order_labels.append('Content')
    if feel:
        order_labels.append('Feel')
    header += ', '.join(order_labels) + '.\n\n'
    body = '\n\n'.join(sections)
    return (None, header + body)


def _extract_text_from_genai_response(response) -> str:
    candidates = getattr(response, 'candidates', None) or []
    if not candidates:
        return ''
    content = getattr(candidates[0], 'content', None)
    parts = getattr(content, 'parts', None) if content else None
    if not parts:
        return ''
    chunks: list[str] = []
    for part in parts:
        t = getattr(part, 'text', None)
        if t:
            chunks.append(t)
    return '\n'.join(chunks).strip()


async def _execute_image_scf_prompt(data: dict, inputs: dict) -> dict:
    if not _HAS_GENAI:
        raise ValueError(
            'Image SCF: google-genai package is not installed. Run: pip install -U google-genai'
        )

    err, instruction = _build_image_scf_instruction(data)
    if err:
        return {'error': err}

    api_key = resolve_gemini_api_key(data)
    if not api_key:
        return {
            'error': (
                'Image SCF: no API key configured. Add your key in Settings, set GEMINI_API_KEY, '
                'or set apiKey on the node.'
            ),
        }

    raw_image = inputs.get('image') or data.get('image', '')
    if not raw_image or not str(raw_image).strip():
        return {'error': 'Image SCF: connect an image input.'}

    data_url = str(raw_image).strip()
    mime = _mime_from_image_data_url(data_url)
    try:
        raw_b64 = _strip_data_url(data_url)
        raw_bytes = base64.b64decode(raw_b64)
    except Exception:
        return {'error': 'Image SCF: could not decode image data.'}

    client = genai.Client(api_key=api_key)
    contents: list = [
        types.Part.from_bytes(data=raw_bytes, mime_type=mime),
        instruction,
    ]

    def _sync_generate():
        return client.models.generate_content(
            model=IMAGE_ANALYZER_MODEL,
            contents=contents,
        )

    try:
        response = await asyncio.to_thread(_sync_generate)
    except Exception as e:
        err_msg = str(e)
        if _is_gemini_api_key_auth_error(err_msg):
            return {'error': f'Image SCF: Invalid or expired API key. ({err_msg})'}
        if 'not found' in err_msg.lower() or '404' in err_msg:
            return {
                'error': (
                    f'Image SCF: Model "{IMAGE_ANALYZER_MODEL}" not found. ({err_msg})'
                ),
            }
        return {'error': f'Image SCF: API call failed — {err_msg}'}

    text_out = _extract_text_from_genai_response(response)
    if not text_out:
        block_reason = getattr(response, 'prompt_feedback', None)
        extra = f' (block reason: {block_reason})' if block_reason else ''
        return {'error': f'Image SCF: empty text response.{extra}'}

    return {'text': text_out}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

async def execute_ai_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'nanoBananaPro':
        return await _execute_nano_banana_pro(data, inputs)
    if node_type == 'nanoBanana2':
        return await _execute_nano_banana_2(data, inputs)
    if node_type == 'imageScfPrompt':
        return await _execute_image_scf_prompt(data, inputs)
    if node_type == 'nanoBanana2Free':
        return {
            'error': (
                'This workflow still contains "Nano Banana 2 Free", which was removed. '
                'Replace it with Nano Banana 2 or Nano Banana Pro.'
            ),
        }
    return {}
