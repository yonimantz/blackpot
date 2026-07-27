import asyncio
import base64
import io
import os

import httpx
from PIL import Image

# When SSL_VERIFY=false is set in the environment (e.g. corporate proxy with self-signed cert),
# skip TLS verification for all outbound API calls.
_SSL_VERIFY = os.getenv('SSL_VERIFY', 'true').strip().lower() not in ('false', '0', 'no')
if not _SSL_VERIFY:
    import ssl
    ssl._create_default_https_context = ssl._create_unverified_context  # noqa: SLF001

try:
    from google import genai
    from google.genai import types
    _HAS_GENAI = True
except ImportError:
    _HAS_GENAI = False

try:
    import fal_client
    _HAS_FAL = True
except ImportError:
    _HAS_FAL = False

NANO_MODEL = 'gemini-3-pro-image-preview'
NANO2_MODEL = 'gemini-3.1-flash-image-preview'
GPT_IMAGE_2_MODEL = 'gpt-image-2'
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


def resolve_openai_api_key(data: dict) -> str:
    """Per-node apiKey overrides user key from run context, then OPENAI_API_KEY env."""
    node_key = (data.get('apiKey', '') or '').strip()
    if node_key:
        return node_key
    try:
        from request_context import get_run_context
        ctx = get_run_context()
        if ctx and ctx.openai_user_key and str(ctx.openai_user_key).strip():
            return str(ctx.openai_user_key).strip()
    except Exception:
        pass
    return os.getenv('OPENAI_API_KEY', '').strip()


def resolve_fal_api_key(data: dict) -> str:
    """Per-node apiKey overrides user key from run context, then FAL_KEY env."""
    node_key = (data.get('apiKey', '') or '').strip()
    if node_key:
        return node_key
    try:
        from request_context import get_run_context
        ctx = get_run_context()
        if ctx and ctx.fal_user_key and str(ctx.fal_user_key).strip():
            return str(ctx.fal_user_key).strip()
    except Exception:
        pass
    return os.getenv('FAL_KEY', '').strip()


# Documented popular `size` values for gpt-image-2 (OpenAI image generation guide).
# The API also accepts other WxH strings within constraints (16px steps, ratio ≤3:1, etc.).
GPT_IMAGE_2_POPULAR_SIZES = frozenset({
    'auto',
    '1024x1024',
    '1536x1024',
    '1024x1536',
    '2048x2048',
    '2048x1152',
    '3840x2160',
    '2160x3840',
})

# Legacy nodes stored `aspectRatio` only — map to closest documented preset or auto.
GPT_IMAGE_2_LEGACY_ASPECT_TO_SIZE = {
    '1:1': '1024x1024',
    '3:4': '1024x1536',
    '4:3': '1536x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '9:16': '1024x1536',
    '16:9': '2048x1152',
    '21:9': 'auto',
    '5:4': '1536x1024',
    '4:5': '1024x1536',
    '1:2': '1024x1536',
    '2:1': '1536x1024',
    # Long:short must be ≤ 3:1 — these presets cannot be expressed; let the API pick.
    '1:8': 'auto',
    '8:1': 'auto',
}


def _gpt_image_2_resolve_size(data: dict) -> str:
    raw = (data.get('imageSize') or '').strip()
    if raw in GPT_IMAGE_2_POPULAR_SIZES:
        return raw
    legacy = (data.get('aspectRatio') or '').strip()
    return GPT_IMAGE_2_LEGACY_ASPECT_TO_SIZE.get(legacy, 'auto')


# Image *edits* endpoint documents a smaller `size` enum than generations for GPT Image.
GPT_IMAGE_2_EDITS_ALLOWED_SIZES = frozenset({
    'auto',
    '1024x1024',
    '1536x1024',
    '1024x1536',
})


def _gpt_image_2_edits_size(resolved: str) -> str:
    if resolved in GPT_IMAGE_2_EDITS_ALLOWED_SIZES:
        return resolved
    return 'auto'


def _gpt_image_2_decode_response_image(payload: dict) -> tuple[bytes | None, dict | None]:
    """Parse OpenAI images JSON; return (bytes, None) or (None, error_dict)."""
    data_arr = payload.get('data') or []
    if not data_arr:
        return None, {'error': 'GPT Image 2: API returned no image data.'}
    item = data_arr[0]
    if not isinstance(item, dict):
        return None, {'error': 'GPT Image 2: unexpected response shape.'}
    b64 = item.get('b64_json')
    if not b64:
        return None, {'error': 'GPT Image 2: response missing b64_json.'}
    try:
        return base64.b64decode(b64), None
    except Exception:
        return None, {'error': 'GPT Image 2: could not decode image bytes.'}


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


# OpenAI image *edits* accepts multiple files; docs show several inputs — cap for stability.
GPT_IMAGE_2_MAX_REFERENCE_IMAGES = 8


def _collect_gpt_image_2_reference_files(inputs: dict) -> list[tuple[bytes, str]]:
    """Decode reference image ports to (bytes, mime_type) for multipart edits."""
    out: list[tuple[bytes, str]] = []
    i = 1
    while True:
        raw = inputs.get(f'referenceImage{i}')
        if not raw:
            break
        s = str(raw).strip()
        mime = 'image/png'
        try:
            if s.startswith('data:'):
                head, b64part = s.split(',', 1)
                if ';' in head:
                    mime = head[5:].split(';')[0].strip() or mime
                out.append((base64.b64decode(b64part), mime))
            else:
                out.append((base64.b64decode(_strip_data_url(s)), mime))
        except Exception as e:
            raise ValueError(
                f'GPT Image 2: could not decode reference image {i}.'
            ) from e
        i += 1
    return out


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
# GPT Image 2  —  OpenAI Images API (generations + edits with reference images)
# ---------------------------------------------------------------------------


def _gpt_image_2_openai_error_detail(resp: httpx.Response) -> str:
    try:
        err_json = resp.json()
        err_obj = err_json.get('error', err_json)
        if isinstance(err_obj, dict):
            return str(err_obj.get('message', err_obj))
        return str(err_obj)
    except Exception:
        return (resp.text or '')[:500]


async def _execute_gpt_image_2(data: dict, inputs: dict) -> dict:
    api_key = resolve_openai_api_key(data)
    if not api_key:
        return {
            'error': (
                'GPT Image 2: no API key configured. '
                'Add your key in Settings, set OPENAI_API_KEY in backend/.env, or set apiKey on the node.'
            ),
        }

    prompt = (inputs.get('prompt') or data.get('prompt') or '').strip()
    if not prompt:
        return {'error': 'GPT Image 2: no prompt provided'}

    try:
        ref_files = _collect_gpt_image_2_reference_files(inputs)
    except ValueError as e:
        return {'error': str(e)}

    if len(ref_files) > GPT_IMAGE_2_MAX_REFERENCE_IMAGES:
        return {
            'error': (
                f'GPT Image 2: at most {GPT_IMAGE_2_MAX_REFERENCE_IMAGES} reference images '
                '(connect inputs in order: Image 1, Image 2, …).'
            ),
        }

    size = _gpt_image_2_resolve_size(data)

    quality = data.get('quality', 'auto')
    if quality not in ('low', 'medium', 'high', 'auto'):
        quality = 'auto'

    output_format = data.get('outputFormat', 'png')
    if output_format not in ('png', 'jpeg', 'webp'):
        output_format = 'png'

    moderation = data.get('moderation', 'auto')
    if moderation not in ('auto', 'low'):
        moderation = 'auto'

    comp_val: int | None = None
    comp = data.get('outputCompression')
    if output_format in ('jpeg', 'webp') and comp is not None:
        try:
            c = int(comp)
            if 0 <= c <= 100:
                comp_val = c
        except (TypeError, ValueError):
            pass

    headers_auth = {'Authorization': f'Bearer {api_key}'}

    try:
        async with httpx.AsyncClient(timeout=180.0, verify=_SSL_VERIFY) as client:
            if ref_files:
                edits_size = _gpt_image_2_edits_size(size)
                form_data: dict[str, str] = {
                    'model': GPT_IMAGE_2_MODEL,
                    'prompt': prompt,
                    'size': edits_size,
                    'quality': quality,
                    'output_format': output_format,
                    'moderation': moderation,
                }
                if comp_val is not None:
                    form_data['output_compression'] = str(comp_val)

                file_parts: list[tuple[str, tuple[str, bytes, str]]] = []
                for idx, (img_bytes, mime) in enumerate(ref_files):
                    ext = '.png'
                    if 'jpeg' in mime or 'jpg' in mime:
                        ext = '.jpg'
                    elif 'webp' in mime:
                        ext = '.webp'
                    file_parts.append(
                        ('image[]', (f'ref_{idx}{ext}', img_bytes, mime or 'image/png')),
                    )

                resp = await client.post(
                    'https://api.openai.com/v1/images/edits',
                    headers=headers_auth,
                    data=form_data,
                    files=file_parts,
                )
            else:
                body: dict = {
                    'model': GPT_IMAGE_2_MODEL,
                    'prompt': prompt,
                    'n': 1,
                    'size': size,
                    'quality': quality,
                    'output_format': output_format,
                }
                if moderation in ('auto', 'low'):
                    body['moderation'] = moderation
                if comp_val is not None:
                    body['output_compression'] = comp_val

                resp = await client.post(
                    'https://api.openai.com/v1/images/generations',
                    json=body,
                    headers={**headers_auth, 'Content-Type': 'application/json'},
                )
    except httpx.TimeoutException:
        return {'error': 'GPT Image 2: request timed out.'}
    except httpx.RequestError as e:
        return {'error': f'GPT Image 2: network error — {e}'}

    if resp.status_code != 200:
        detail = _gpt_image_2_openai_error_detail(resp)
        return {'error': f'GPT Image 2: API error ({resp.status_code}) — {detail}'}

    try:
        payload = resp.json()
    except Exception:
        return {'error': 'GPT Image 2: invalid JSON response from API.'}

    img_bytes, err = _gpt_image_2_decode_response_image(payload)
    if err:
        return err

    mime = {
        'png': 'image/png',
        'jpeg': 'image/jpeg',
        'webp': 'image/webp',
    }.get(output_format, 'image/png')
    out_b64 = base64.b64encode(img_bytes).decode('ascii')
    return {'image': f'data:{mime};base64,{out_b64}'}


# ---------------------------------------------------------------------------
# fal.ai  —  FLUX / Stable Diffusion / SDXL via fal-client SDK
# ---------------------------------------------------------------------------

# Registry of supported fal models. Each entry maps a node-type-friendly key
# to a fal endpoint slug plus the parameter shape we should send.
#   size_param:  'image_size' (FLUX/SD enum) | 'aspect_ratio' (Nano Banana) | None
#   image_input: 'single' (image_url) | 'multi' (image_urls list) | None
FAL_MODELS: dict[str, dict] = {
    'flux_dev': {
        'endpoint': 'fal-ai/flux/dev',
        'size_param': 'image_size',
        'image_input': None,
    },
    'flux_schnell': {
        'endpoint': 'fal-ai/flux/schnell',
        'size_param': 'image_size',
        'image_input': None,
    },
    'flux_pro_v11': {
        'endpoint': 'fal-ai/flux-pro/v1.1',
        'size_param': 'image_size',
        'image_input': None,
    },
    'flux_redux_dev': {
        'endpoint': 'fal-ai/flux/dev/redux',
        'size_param': 'image_size',
        'image_input': 'single',
    },
    'sd35_large': {
        'endpoint': 'fal-ai/stable-diffusion-v35-large',
        'size_param': 'image_size',
        'image_input': None,
    },
    'fast_sdxl': {
        'endpoint': 'fal-ai/fast-sdxl',
        'size_param': 'image_size',
        'image_input': 'single',
    },
    'nano_banana': {
        'endpoint': 'fal-ai/nano-banana',
        'size_param': 'aspect_ratio',
        'image_input': None,
    },
    'nano_banana_edit': {
        'endpoint': 'fal-ai/nano-banana/edit',
        'size_param': None,
        'image_input': 'multi',
    },
    'nano_banana_pro': {
        'endpoint': 'fal-ai/nano-banana-pro',
        'size_param': 'aspect_ratio',
        'image_input': 'multi',
    },
}

FAL_IMAGE_SIZE_PRESETS = frozenset({
    'square_hd', 'square',
    'portrait_4_3', 'portrait_16_9',
    'landscape_4_3', 'landscape_16_9',
})

FAL_ASPECT_RATIO_PRESETS = frozenset({
    '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9',
})


def _is_fal_auth_error(err_msg: str) -> bool:
    u = err_msg.upper()
    return (
        '401' in err_msg
        or '403' in err_msg
        or 'UNAUTHORIZED' in u
        or 'FORBIDDEN' in u
        or 'INVALID API KEY' in u
        or 'INVALID_API_KEY' in u
    )


async def _fal_upload_reference_image(b64_data_url_or_raw: str) -> str:
    """Upload a base64 image to fal storage and return its CDN url."""
    raw = _strip_data_url(b64_data_url_or_raw)
    img_bytes = base64.b64decode(raw)
    return await fal_client.upload_async(img_bytes, 'image/png')


async def _execute_fal_ai(data: dict, inputs: dict) -> dict:
    if not _HAS_FAL:
        return {
            'error': (
                'FAL AI: fal-client package is not installed. '
                'Run: pip install -U fal-client'
            ),
        }

    model_key = (data.get('model') or 'flux_dev').strip()
    model_spec = FAL_MODELS.get(model_key)
    if not model_spec:
        return {'error': f'FAL AI: unknown model "{model_key}".'}

    api_key = resolve_fal_api_key(data)
    if not api_key:
        return {
            'error': (
                'FAL AI: no API key configured. '
                'Add your key in Settings, set FAL_KEY in backend/.env, or set apiKey on the node.'
            ),
        }

    prompt = (inputs.get('prompt') or data.get('prompt') or '').strip()
    if not prompt:
        return {'error': 'FAL AI: no prompt provided'}

    arguments: dict = {
        'prompt': prompt,
        'num_images': 1,
    }

    size_param = model_spec.get('size_param')
    if size_param == 'image_size':
        size = (data.get('imageSize') or 'square_hd').strip()
        if size not in FAL_IMAGE_SIZE_PRESETS:
            size = 'square_hd'
        arguments['image_size'] = size
    elif size_param == 'aspect_ratio':
        ar = (data.get('aspectRatio') or '1:1').strip()
        if ar not in FAL_ASPECT_RATIO_PRESETS:
            ar = '1:1'
        arguments['aspect_ratio'] = ar

    steps_raw = data.get('numInferenceSteps')
    if steps_raw is not None and size_param == 'image_size':
        # Only FLUX/SD endpoints accept num_inference_steps; nano-banana ignores it.
        try:
            steps = int(steps_raw)
            if 1 <= steps <= 50:
                arguments['num_inference_steps'] = steps
        except (TypeError, ValueError):
            pass

    seed_val = 0
    try:
        seed_val = int(data.get('seed', 0) or 0)
    except (TypeError, ValueError):
        seed_val = 0
    if seed_val > 0:
        arguments['seed'] = seed_val

    # fal_client reads FAL_KEY from the environment for both upload and inference.
    # Set it for the duration of this call (covers uploads + subscribe) and restore after.
    prev_key = os.environ.get('FAL_KEY')
    os.environ['FAL_KEY'] = api_key
    try:
        image_input_kind = model_spec.get('image_input')
        if image_input_kind:
            ref_images = _collect_reference_images(inputs)
            if ref_images:
                try:
                    uploaded = []
                    for ref in ref_images:
                        uploaded.append(await _fal_upload_reference_image(ref))
                except Exception as e:
                    err_msg = str(e)
                    if _is_fal_auth_error(err_msg):
                        return {
                            'error': (
                                'FAL AI: invalid or expired API key while uploading '
                                f'reference image. ({err_msg})'
                            ),
                        }
                    return {'error': f'FAL AI: could not upload reference image — {err_msg}'}
                if image_input_kind == 'single':
                    arguments['image_url'] = uploaded[0]
                else:
                    arguments['image_urls'] = uploaded
            elif image_input_kind == 'multi' and model_spec['endpoint'].endswith('/edit'):
                # Edit endpoints require at least one input image.
                return {
                    'error': (
                        'FAL AI: this edit model requires a reference image. '
                        'Connect an image to Image 1.'
                    ),
                }

        try:
            result = await fal_client.subscribe_async(
                model_spec['endpoint'],
                arguments=arguments,
                with_logs=False,
            )
        except Exception as e:
            err_msg = str(e)
            if _is_fal_auth_error(err_msg):
                return {'error': f'FAL AI: Invalid or expired API key. ({err_msg})'}
            if '404' in err_msg or 'not found' in err_msg.lower():
                return {
                    'error': (
                        f'FAL AI: model endpoint "{model_spec["endpoint"]}" not found. '
                        f'You may need access. ({err_msg})'
                    ),
                }
            if '429' in err_msg or 'quota' in err_msg.lower() or 'rate' in err_msg.lower():
                return {'error': f'FAL AI: rate-limited or out of quota. ({err_msg})'}
            return {'error': f'FAL AI: API call failed — {err_msg}'}
    finally:
        if prev_key is None:
            os.environ.pop('FAL_KEY', None)
        else:
            os.environ['FAL_KEY'] = prev_key

    images = (result or {}).get('images') or []
    if not images:
        return {'error': 'FAL AI: API returned no images.'}

    first = images[0] if isinstance(images[0], dict) else {}
    img_url = first.get('url')
    if not img_url:
        return {'error': 'FAL AI: API response missing image url.'}

    try:
        async with httpx.AsyncClient(timeout=120.0, verify=_SSL_VERIFY) as client:
            img_resp = await client.get(img_url)
        if img_resp.status_code != 200:
            return {
                'error': (
                    f'FAL AI: failed to download generated image '
                    f'({img_resp.status_code}).'
                ),
            }
        img_bytes = img_resp.content
    except httpx.TimeoutException:
        return {'error': 'FAL AI: timed out fetching generated image.'}
    except httpx.RequestError as e:
        return {'error': f'FAL AI: network error fetching image — {e}'}

    mime = first.get('content_type') or 'image/png'
    if mime not in ('image/png', 'image/jpeg', 'image/webp'):
        mime = 'image/png'

    out_b64 = base64.b64encode(img_bytes).decode('ascii')
    return {'image': f'data:{mime};base64,{out_b64}'}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

async def execute_ai_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'nanoBananaPro':
        return await _execute_nano_banana_pro(data, inputs)
    if node_type == 'nanoBanana2':
        return await _execute_nano_banana_2(data, inputs)
    if node_type == 'gptImage2':
        return await _execute_gpt_image_2(data, inputs)
    if node_type == 'imageScfPrompt':
        return await _execute_image_scf_prompt(data, inputs)
    if node_type == 'falAi':
        return await _execute_fal_ai(data, inputs)
    if node_type == 'nanoBanana2Free':
        return {
            'error': (
                'This workflow still contains "Nano Banana 2 Free", which was removed. '
                'Replace it with Nano Banana 2 or Nano Banana Pro.'
            ),
        }
    return {}
