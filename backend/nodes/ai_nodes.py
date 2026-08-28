import base64
import os
import random
import uuid

from paths import MODELS_DIR

from . import fal_common

# ---------------------------------------------------------------------------
# Node types removed when SpotOn moved to fal.ai as its only provider.
#
# They stay dispatchable so a workflow saved before the migration still opens
# and tells the user what to swap in, instead of failing silently. Keep in sync
# with `LEGACY_NODE_TYPES` in frontend/src/types/legacyNodes.ts.
# ---------------------------------------------------------------------------

# node type -> (old label, the FAL AI model that replaces it)
LEGACY_NODES = {
    'nanoBananaPro': ('Nano Banana Pro', 'Nano Banana Pro'),
    'nanoBanana2': ('Nano Banana 2', 'Nano Banana'),
    'nanoBanana2Free': ('Nano Banana 2 Free', 'Nano Banana'),
    'gptImage2': ('GPT Image 2', 'FLUX.1 [dev]'),
}


def legacy_node_error(node_type: str) -> str:
    label, model = LEGACY_NODES[node_type]
    return (
        f'"{label}" was removed when SpotOn moved to fal.ai only. '
        f'Replace it with a FAL AI node set to "{model}".'
    )


def _resolve_seed(data: dict) -> int:
    """Use the node seed when set; otherwise pick one so every image is reproducible."""
    try:
        seed_val = int(data.get('seed', 0) or 0)
    except (TypeError, ValueError):
        seed_val = 0
    if seed_val <= 0:
        seed_val = random.randint(1, 2**31 - 1)
    return seed_val


def _gen_meta(prompt: str, seed: int | None, model: str) -> dict:
    return {'prompt': prompt, 'seed': seed, 'model': model}


def _image_result(data_url: str, prompt: str, seed: int | None, model: str) -> dict:
    return {
        'image': data_url,
        '_meta': _gen_meta(prompt, seed, model),
    }


def _collect_reference_images(inputs: dict) -> list[str]:
    """Gather base64 strings from reference image input ports (dynamic count)."""
    refs = []
    i = 1
    while True:
        img = inputs.get(f'referenceImage{i}')
        if img:
            refs.append(fal_common.strip_data_url(img))
            i += 1
        else:
            break
    return refs


# ---------------------------------------------------------------------------
# Image SCF Prompt  —  image to prompt, via a vision LLM on fal
# ---------------------------------------------------------------------------

IMAGE_SCF_ENDPOINT = 'fal-ai/any-llm/vision'
# any-llm routes to the same model the node used directly before the migration,
# which is why the output format and quality carried over unchanged.
IMAGE_SCF_MODEL = 'google/gemini-2.5-flash'


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


async def _execute_image_scf_prompt(data: dict, inputs: dict) -> dict:
    if not fal_common.HAS_FAL:
        return {'error': f'Image SCF: {fal_common.MISSING_CLIENT_ERROR}'}

    err, instruction = _build_image_scf_instruction(data)
    if err:
        return {'error': err}

    api_key = fal_common.resolve_api_key(data)
    if not api_key:
        return {'error': f'Image SCF: {fal_common.NO_KEY_ERROR}'}

    raw_image = inputs.get('image') or data.get('image', '')
    if not raw_image or not str(raw_image).strip():
        return {'error': 'Image SCF: connect an image input.'}

    client = fal_common.make_client(api_key)
    try:
        image_url = await fal_common.upload_image(client, str(raw_image).strip())
    except Exception as e:
        return {
            'error': fal_common.describe_error('Image SCF', IMAGE_SCF_ENDPOINT, str(e)),
        }

    try:
        result = await client.subscribe(
            IMAGE_SCF_ENDPOINT,
            arguments={
                'model': IMAGE_SCF_MODEL,
                'prompt': instruction,
                'image_url': image_url,
            },
            with_logs=False,
        )
    except Exception as e:
        return {
            'error': fal_common.describe_error('Image SCF', IMAGE_SCF_ENDPOINT, str(e)),
        }

    # any-llm reports model-side failures in the body rather than as an HTTP error.
    model_error = (result or {}).get('error')
    if model_error:
        return {'error': f'Image SCF: {model_error}'}

    text_out = ((result or {}).get('output') or '').strip()
    if not text_out:
        return {'error': 'Image SCF: empty text response.'}

    return {'text': text_out}


# ---------------------------------------------------------------------------
# FAL AI  —  image generation
# ---------------------------------------------------------------------------

# Registry of supported fal models. Each entry maps a node-type-friendly key
# to a fal endpoint slug plus the parameter shape we should send.
#   size_param:   'image_size' (FLUX/SD enum) | 'aspect_ratio' (Nano Banana) | None
#   image_input:  'single' (image_url) | 'multi' (image_urls list) | None
#                 — describes what `endpoint` itself accepts.
#   edit_endpoint / edit_image_input:
#                 several fal models split text-to-image and image-to-image across two
#                 separate slugs; the base slug rejects (or silently drops) image input.
#                 When reference images are connected we switch to `edit_endpoint`.
#                 Both slugs in each pair take the same size_param, so it is not duplicated.
#   requires_image: endpoint cannot run without at least one reference image.
#   supports_prompt: False for pure image-variation endpoints that have no `prompt` field.
#   supports_seed / supports_num_images: default True; set False for endpoints whose
#                 schema has no such field — sending one anyway either errors or is silently
#                 dropped, so we gate on it instead of assuming every model has it.
#   supports_steps: default False. Only the FLUX/SD family (plus Z-Image) exposes
#                 num_inference_steps; every other image_size model manages its own
#                 sampling and must opt in explicitly.
#   size_options / aspect_options: per-model override of the size/aspect-ratio enum.
#                 Falls back to FAL_IMAGE_SIZE_PRESETS / FAL_ASPECT_RATIO_PRESETS.
#   extra_params: {fal_argument_name: {data_key, values, default}} for cost- or
#                 quality-affecting fields with no generic home (quality, resolution,
#                 rendering speed, ...). Read from `data[data_key]`, validated against
#                 `values`, falls back to `default`.
FAL_IMAGE_SIZE_PRESETS = frozenset({
    'square_hd', 'square',
    'portrait_4_3', 'portrait_16_9',
    'landscape_4_3', 'landscape_16_9',
})

FAL_ASPECT_RATIO_PRESETS = frozenset({
    '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9',
})

# GPT Image 2 and Seedream 5 Pro add an `auto`-flavoured size option on top of the
# shared preset list rather than replacing it.
FAL_GPT_IMAGE2_SIZE_OPTIONS = FAL_IMAGE_SIZE_PRESETS | {'auto'}
FAL_SEEDREAM_SIZE_OPTIONS = FAL_IMAGE_SIZE_PRESETS | {'auto_1K', 'auto_2K'}

FAL_NANO_BANANA_2_ASPECT_OPTIONS = frozenset({
    'auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1',
    '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8',
})

FAL_MODELS: dict[str, dict] = {
    'flux_dev': {
        'endpoint': 'fal-ai/flux/dev',
        'size_param': 'image_size',
        'image_input': None,
        'supports_steps': True,
    },
    'flux_schnell': {
        'endpoint': 'fal-ai/flux/schnell',
        'size_param': 'image_size',
        'image_input': None,
        'supports_steps': True,
    },
    'flux_pro_v11': {
        'endpoint': 'fal-ai/flux-pro/v1.1',
        'size_param': 'image_size',
        'image_input': None,
        # v1.1 pro manages its own sampling and has no num_inference_steps field.
        'supports_steps': False,
    },
    'flux_redux_dev': {
        # Redux re-imagines an input image and has no `prompt` field at all.
        'endpoint': 'fal-ai/flux/dev/redux',
        'size_param': 'image_size',
        'image_input': 'single',
        'requires_image': True,
        'supports_prompt': False,
        'supports_steps': True,
    },
    'sd35_large': {
        'endpoint': 'fal-ai/stable-diffusion-v35-large',
        'size_param': 'image_size',
        'image_input': None,
        'supports_steps': True,
    },
    'fast_sdxl': {
        'endpoint': 'fal-ai/fast-sdxl',
        'size_param': 'image_size',
        'image_input': None,
        'edit_endpoint': 'fal-ai/fast-sdxl/image-to-image',
        'edit_image_input': 'single',
        'supports_steps': True,
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
        'requires_image': True,
    },
    'nano_banana_pro': {
        'endpoint': 'fal-ai/nano-banana-pro',
        'size_param': 'aspect_ratio',
        'image_input': None,
        'edit_endpoint': 'fal-ai/nano-banana-pro/edit',
        'edit_image_input': 'multi',
    },
    'gpt_image_2': {
        'endpoint': 'openai/gpt-image-2',
        'size_param': 'image_size',
        'image_input': None,
        'edit_endpoint': 'openai/gpt-image-2/edit',
        'edit_image_input': 'multi',
        'size_options': FAL_GPT_IMAGE2_SIZE_OPTIONS,
        'supports_seed': False,
        'extra_params': {
            'quality': {
                'data_key': 'quality',
                'values': ('auto', 'low', 'medium', 'high'),
                'default': 'high',
            },
        },
    },
    'flux_2_pro': {
        'endpoint': 'fal-ai/flux-2-pro',
        'size_param': 'image_size',
        'image_input': None,
        'edit_endpoint': 'fal-ai/flux-2-pro/edit',
        'edit_image_input': 'multi',
        'supports_num_images': False,
    },
    'nano_banana_2': {
        'endpoint': 'fal-ai/nano-banana-2',
        'size_param': 'aspect_ratio',
        'image_input': None,
        'edit_endpoint': 'fal-ai/nano-banana-2/edit',
        'edit_image_input': 'multi',
        'aspect_options': FAL_NANO_BANANA_2_ASPECT_OPTIONS,
        'extra_params': {
            'resolution': {
                'data_key': 'resolution',
                'values': ('0.5K', '1K', '2K', '4K'),
                'default': '1K',
            },
        },
    },
    'seedream_v5_pro': {
        'endpoint': 'bytedance/seedream/v5/pro/text-to-image',
        'size_param': 'image_size',
        'image_input': None,
        'edit_endpoint': 'bytedance/seedream/v5/pro/edit',
        'edit_image_input': 'multi',
        'size_options': FAL_SEEDREAM_SIZE_OPTIONS,
        'supports_seed': False,
    },
    'ideogram_v4': {
        'endpoint': 'ideogram/v4',
        'size_param': 'image_size',
        'image_input': None,
        'edit_endpoint': 'ideogram/v4/image-to-image',
        'edit_image_input': 'single',
        'extra_params': {
            'rendering_speed': {
                'data_key': 'renderingSpeed',
                'values': ('TURBO', 'BALANCED', 'QUALITY'),
                'default': 'BALANCED',
            },
        },
    },
    'recraft_v41': {
        'endpoint': 'fal-ai/recraft/v4.1/text-to-image',
        'size_param': 'image_size',
        'image_input': None,
        'supports_seed': False,
        'supports_num_images': False,
    },
    'z_image_turbo': {
        'endpoint': 'fal-ai/z-image/turbo',
        'size_param': 'image_size',
        'image_input': None,
        'edit_endpoint': 'fal-ai/z-image/turbo/image-to-image',
        'edit_image_input': 'single',
        'supports_steps': True,
    },
}

FAL_MODEL_LABELS: dict[str, str] = {
    'flux_dev': 'FLUX.1 [dev]',
    'flux_schnell': 'FLUX.1 [schnell] (fast)',
    'flux_pro_v11': 'FLUX1.1 [pro]',
    'flux_redux_dev': 'FLUX.1 [dev] Redux (image variation, no prompt)',
    'sd35_large': 'Stable Diffusion 3.5 Large',
    'fast_sdxl': 'Fast SDXL',
    'nano_banana': 'Nano Banana (Gemini 2.5 Flash Image)',
    'nano_banana_edit': 'Nano Banana Edit (image-to-image)',
    'nano_banana_pro': 'Nano Banana Pro',
    'gpt_image_2': 'GPT Image 2',
    'flux_2_pro': 'FLUX.2 [pro]',
    'nano_banana_2': 'Nano Banana 2',
    'seedream_v5_pro': 'Seedream 5 Pro',
    'ideogram_v4': 'Ideogram 4',
    'recraft_v41': 'Recraft V4.1',
    'z_image_turbo': 'Z-Image Turbo',
}


async def _execute_fal_ai(data: dict, inputs: dict) -> dict:
    if not fal_common.HAS_FAL:
        return {'error': f'FAL AI: {fal_common.MISSING_CLIENT_ERROR}'}

    model_key = (data.get('model') or 'flux_dev').strip()
    model_spec = FAL_MODELS.get(model_key)
    if not model_spec:
        return {'error': f'FAL AI: unknown model "{model_key}".'}

    api_key = fal_common.resolve_api_key(data)
    if not api_key:
        return {'error': f'FAL AI: {fal_common.NO_KEY_ERROR}'}

    ref_images = _collect_reference_images(inputs)

    # Connecting a reference image selects the image-to-image variant for models
    # that split the two modes across separate endpoints.
    endpoint = model_spec['endpoint']
    image_input_kind = model_spec.get('image_input')
    if ref_images and model_spec.get('edit_endpoint'):
        endpoint = model_spec['edit_endpoint']
        image_input_kind = model_spec.get('edit_image_input')
    if not image_input_kind:
        ref_images = []
    elif image_input_kind == 'single':
        ref_images = ref_images[:1]

    if model_spec.get('requires_image') and not ref_images:
        return {
            'error': (
                f'FAL AI: model "{model_key}" requires a reference image. '
                'Connect an image to Image 1.'
            ),
        }

    supports_prompt = model_spec.get('supports_prompt', True)
    prompt = (inputs.get('prompt') or data.get('prompt') or '').strip()
    if supports_prompt and not prompt:
        return {'error': 'FAL AI: no prompt provided'}

    arguments: dict = {}
    if model_spec.get('supports_num_images', True):
        arguments['num_images'] = 1
    if supports_prompt:
        arguments['prompt'] = prompt

    size_param = model_spec.get('size_param')
    if size_param == 'image_size':
        size_options = model_spec.get('size_options', FAL_IMAGE_SIZE_PRESETS)
        size = (data.get('imageSize') or 'square_hd').strip()
        if size not in size_options:
            size = 'square_hd'
        arguments['image_size'] = size
    elif size_param == 'aspect_ratio':
        aspect_options = model_spec.get('aspect_options', FAL_ASPECT_RATIO_PRESETS)
        ar = (data.get('aspectRatio') or '1:1').strip()
        if ar not in aspect_options:
            ar = '1:1'
        arguments['aspect_ratio'] = ar

    steps_raw = data.get('numInferenceSteps')
    if steps_raw is not None and model_spec.get('supports_steps', False):
        try:
            steps = int(steps_raw)
            if 1 <= steps <= 50:
                arguments['num_inference_steps'] = steps
        except (TypeError, ValueError):
            pass

    for arg_name, extra_spec in model_spec.get('extra_params', {}).items():
        raw_val = data.get(extra_spec['data_key'])
        value = raw_val.strip() if isinstance(raw_val, str) else None
        allowed_values = extra_spec.get('values')
        if not value or (allowed_values and value not in allowed_values):
            value = extra_spec['default']
        arguments[arg_name] = value

    seed_val = _resolve_seed(data) if model_spec.get('supports_seed', True) else None
    if seed_val is not None:
        arguments['seed'] = seed_val

    fal_model_label = FAL_MODEL_LABELS.get(model_key, model_key)
    client = fal_common.make_client(api_key)

    if ref_images:
        try:
            uploaded = []
            for ref in ref_images:
                uploaded.append(await fal_common.upload_image(client, ref))
        except Exception as e:
            err_msg = str(e)
            if fal_common.is_auth_error(err_msg):
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

    try:
        result = await client.subscribe(endpoint, arguments=arguments, with_logs=False)
    except Exception as e:
        return {'error': fal_common.describe_error('FAL AI', endpoint, str(e))}

    images = (result or {}).get('images') or []
    if not images:
        return {'error': 'FAL AI: API returned no images.'}

    first = images[0] if isinstance(images[0], dict) else {}
    img_url = first.get('url')
    if not img_url:
        return {'error': 'FAL AI: API response missing image url.'}

    img_bytes, mime, err = await fal_common.download_image(img_url, 'FAL AI')
    if err:
        return {'error': err}

    declared = first.get('content_type')
    if declared in ('image/png', 'image/jpeg', 'image/webp'):
        mime = declared

    out_b64 = base64.b64encode(img_bytes).decode('ascii')
    meta_prompt = prompt if supports_prompt else ''
    return _image_result(
        f'data:{mime};base64,{out_b64}',
        meta_prompt,
        seed_val,
        fal_model_label,
    )


# ---------------------------------------------------------------------------
# Image to 3D
# ---------------------------------------------------------------------------

# Keep keys in sync with frontend IMAGE_TO_3D_MODEL_SPECS.
# image_arg / extra_params / mesh_paths are data-driven so a third model is
# one dict entry. mesh_paths are dotted lookups into the fal response.
DEFAULT_IMAGE_TO_3D_MODEL = 'tripo_h31'

IMAGE_TO_3D_MODELS: dict[str, dict] = {
    'tripo_h31': {
        'endpoint': 'tripo3d/h3.1/image-to-3d',
        'label': 'Tripo H3.1 (textured)',
        'image_arg': 'image_url',
        'mesh_paths': (
            'model_urls.glb.url',
            'model_mesh.url',
            'model_glb.url',
            'glb.url',
        ),
        'thumb_paths': ('rendered_image.url', 'thumbnail.url'),
        'fixed_params': {},
        'extra_params': (
            {'data_key': 'textureQuality', 'api_key': 'texture_quality', 'default': 'standard'},
        ),
    },
    'hunyuan_v21': {
        # Verified against a live run: the response carries `model_glb`
        # (untextured) and `model_glb_pbr` (textured) — both real .glb URLs —
        # plus `model_mesh`, which is a .zip of loose assets, not a mesh this
        # pipeline can use. No thumbnail-shaped field comes back at all.
        'endpoint': 'fal-ai/hunyuan3d-v21',
        'label': 'Hunyuan3D 2.1 (PBR textured)',
        'image_arg': 'input_image_url',
        'mesh_paths': (
            'model_glb_pbr.url',
            'model_glb.url',
            'model_urls.glb.url',
        ),
        'thumb_paths': (),
        'fixed_params': {'textured_mesh': True},
        'extra_params': (),
    },
    'hunyuan_rapid': {
        # The slug without the fal-ai/ prefix 404s.
        #
        # Textured mode returns OBJ + MTL + a texture PNG and no GLB at all —
        # its `model_glb` field is documented as holding an .obj. enable_geometry
        # is the only mode that yields GLB, at the cost of textures, so this
        # entry is the fast untextured draft rather than a Tripo substitute.
        'endpoint': 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d',
        'label': 'Hunyuan 3D 3.1 Rapid (fast, untextured)',
        'image_arg': 'input_image_url',
        'mesh_paths': (
            'model_urls.glb.url',
            'model_glb.url',
            'glb.url',
        ),
        'thumb_paths': ('thumbnail.url', 'rendered_image.url'),
        'fixed_params': {'enable_geometry': True},
        'extra_params': (),
    },
}

# Response fields whose name already promises a GLB, so the URL extension is
# not second-guessed. Everything else is extension-checked because Hunyuan
# ships an .obj under `model_glb`.
_TRUSTED_GLB_PATHS = frozenset({'model_urls.glb.url', 'glb.url'})


def _dig(obj, path: str):
    cur = obj
    for part in path.split('.'):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


_NON_GLB_SUFFIXES = (
    '.obj', '.fbx', '.mtl', '.usdz', '.png', '.jpg', '.jpeg', '.webp', '.zip',
)


def _looks_like_glb(url: str, content_type: str = '') -> bool:
    bare = url.split('?', 1)[0].lower()
    mime = (content_type or '').lower()
    if bare.endswith(('.glb', '.gltf')) or 'gltf' in mime:
        return True
    if any(bare.endswith(ext) for ext in _NON_GLB_SUFFIXES):
        return False
    return True


def _file_url(value, glb_only: bool = False) -> str | None:
    url = None
    content_type = ''
    if isinstance(value, str) and value.startswith(('http://', 'https://')):
        url = value
    elif isinstance(value, dict):
        candidate = value.get('url')
        if isinstance(candidate, str) and candidate.startswith(('http://', 'https://')):
            url = candidate
            content_type = str(value.get('content_type') or '')
    if not url:
        return None
    if glb_only and not _looks_like_glb(url, content_type):
        return None
    return url


def _first_url(result, paths: tuple[str, ...], glb_only: bool = False) -> str | None:
    for path in paths:
        check = glb_only and path not in _TRUSTED_GLB_PATHS
        found = _file_url(_dig(result, path), glb_only=check)
        if found:
            return found
    return None


def _describe_result_shape(result) -> str:
    """Summarize a fal response so a shape mismatch is self-diagnosing."""
    if not isinstance(result, dict):
        return f'response was {type(result).__name__}'
    parts: list[str] = []
    for key in sorted(result.keys()):
        value = result[key]
        if isinstance(value, dict) and isinstance(value.get('url'), str):
            name = value.get('file_name') or value['url'].split('?', 1)[0].rsplit('/', 1)[-1]
            parts.append(f'{key}={name}')
        elif isinstance(value, dict):
            inner = sorted(k for k, v in value.items() if isinstance(v, dict) and v.get('url'))
            parts.append(f'{key}{{{", ".join(inner) or "none"}}}')
        else:
            parts.append(key)
    return ', '.join(parts) or 'empty response'


def _find_mesh_url(obj, depth: int = 0) -> str | None:
    """Last-resort walk for a GLB URL when the documented path is missing."""
    if depth > 6 or obj is None:
        return None
    if isinstance(obj, str):
        bare = obj.split('?', 1)[0].lower()
        if obj.startswith(('http://', 'https://')) and bare.endswith(('.glb', '.gltf')):
            return obj
        return None
    if isinstance(obj, dict):
        nested_urls = obj.get('model_urls')
        if isinstance(nested_urls, dict):
            found = _file_url(nested_urls.get('glb'), glb_only=True)
            if found:
                return found
        for key in ('model_mesh', 'model_glb', 'glb', 'mesh', 'model'):
            if key in obj:
                found = _file_url(obj[key], glb_only=True) or _find_mesh_url(obj[key], depth + 1)
                if found:
                    return found
        for value in obj.values():
            found = _find_mesh_url(value, depth + 1)
            if found:
                return found
    if isinstance(obj, list):
        for item in obj:
            found = _find_mesh_url(item, depth + 1)
            if found:
                return found
    return None


async def _execute_image_to_3d(data: dict, inputs: dict) -> dict:
    if not fal_common.HAS_FAL:
        return {'error': f'Image to 3D: {fal_common.MISSING_CLIENT_ERROR}'}

    api_key = fal_common.resolve_api_key(data)
    if not api_key:
        return {'error': f'Image to 3D: {fal_common.NO_KEY_ERROR}'}

    model_key = (data.get('model') or DEFAULT_IMAGE_TO_3D_MODEL).strip()
    spec = IMAGE_TO_3D_MODELS.get(model_key)
    if not spec:
        return {'error': f'Image to 3D: unknown model "{model_key}".'}

    raw_image = inputs.get('image') or data.get('image', '')
    if not raw_image or not str(raw_image).strip():
        return {'error': 'Image to 3D: connect an image input.'}

    endpoint = spec['endpoint']
    client = fal_common.make_client(api_key)
    try:
        image_url = await fal_common.upload_image(client, str(raw_image).strip())
    except Exception as e:
        return {'error': fal_common.describe_error('Image to 3D', endpoint, str(e))}

    arguments: dict = {spec['image_arg']: image_url}
    arguments.update(spec.get('fixed_params') or {})
    for extra in spec.get('extra_params') or ():
        data_key = extra['data_key']
        api_key_name = extra['api_key']
        value = data.get(data_key, extra.get('default'))
        if value is not None and value != '':
            arguments[api_key_name] = value

    try:
        result = await client.subscribe(endpoint, arguments=arguments, with_logs=False)
    except Exception as e:
        err_msg = str(e)
        alt_arg = 'image_url' if spec['image_arg'] != 'image_url' else 'input_image_url'
        lowered = err_msg.lower()
        if alt_arg in lowered or '422' in err_msg:
            try:
                alt_args = {k: v for k, v in arguments.items() if k != spec['image_arg']}
                alt_args[alt_arg] = image_url
                result = await client.subscribe(endpoint, arguments=alt_args, with_logs=False)
            except Exception as e2:
                return {'error': fal_common.describe_error('Image to 3D', endpoint, str(e2))}
        else:
            return {'error': fal_common.describe_error('Image to 3D', endpoint, err_msg)}

    mesh_url = _first_url(result, spec['mesh_paths'], glb_only=True) or _find_mesh_url(result)
    if not mesh_url:
        return {
            'error': (
                f'Image to 3D: {spec["label"]} returned no GLB — got '
                f'{_describe_result_shape(result)}. Try the other model in the dropdown.'
            )
        }

    raw, _mime, err = await fal_common.download_file(mesh_url, 'Image to 3D')
    if err:
        return {'error': err}
    if not raw:
        return {'error': 'Image to 3D: downloaded mesh was empty.'}

    os.makedirs(MODELS_DIR, exist_ok=True)
    asset_id = f'{uuid.uuid4()}.glb'
    dest = os.path.join(MODELS_DIR, asset_id)
    with open(dest, 'wb') as f:
        f.write(raw)

    thumbnail = None
    thumb_url = _first_url(result, spec['thumb_paths'])
    if thumb_url:
        thumb_bytes, thumb_mime, thumb_err = await fal_common.download_image(thumb_url, 'Image to 3D')
        if thumb_bytes and not thumb_err:
            thumbnail = fal_common.to_data_url(thumb_bytes, thumb_mime)

    return {
        'model': {
            'assetId': asset_id,
            'url': f'/api/model/{asset_id}',
            'format': 'glb',
            'sizeBytes': len(raw),
        },
        'thumbnail': thumbnail,
        '_meta': _gen_meta('', None, spec['label']),
    }


# ---------------------------------------------------------------------------
# Upscaler  —  image in, larger image out
# ---------------------------------------------------------------------------

# Keep keys in sync with frontend UPSCALER_MODEL_SPECS.
# Both models take `image_url` and return a single `image` object (not the
# `images` array FAL AI's generators use) — verified against each endpoint's
# live OpenAPI schema. scale_arg is the fal argument name for the scale
# dropdown; both endpoints accept it as a number, 1–4 (esrgan allows up to 8,
# but we cap the dropdown at the shared 2/4 range both models support well).
DEFAULT_UPSCALER_MODEL = 'esrgan'

UPSCALER_MODELS: dict[str, dict] = {
    'esrgan': {
        'endpoint': 'fal-ai/esrgan',
        'label': 'Real-ESRGAN (fast)',
        'image_arg': 'image_url',
        'scale_arg': 'scale',
        'supports_prompt': False,
    },
    'clarity': {
        'endpoint': 'fal-ai/clarity-upscaler',
        'label': 'Clarity Upscaler (quality)',
        'image_arg': 'image_url',
        'scale_arg': 'upscale_factor',
        'supports_prompt': True,
    },
}

UPSCALER_SCALE_VALUES = ('2', '4')
DEFAULT_UPSCALER_SCALE = '2'


async def _execute_upscaler(data: dict, inputs: dict) -> dict:
    if not fal_common.HAS_FAL:
        return {'error': f'Upscaler: {fal_common.MISSING_CLIENT_ERROR}'}

    api_key = fal_common.resolve_api_key(data)
    if not api_key:
        return {'error': f'Upscaler: {fal_common.NO_KEY_ERROR}'}

    model_key = (data.get('model') or DEFAULT_UPSCALER_MODEL).strip()
    spec = UPSCALER_MODELS.get(model_key)
    if not spec:
        return {'error': f'Upscaler: unknown model "{model_key}".'}

    raw_image = inputs.get('image') or data.get('image', '')
    if not raw_image or not str(raw_image).strip():
        return {'error': 'Upscaler: connect an image input.'}

    scale_raw = str(data.get('scale') or DEFAULT_UPSCALER_SCALE).strip()
    if scale_raw not in UPSCALER_SCALE_VALUES:
        scale_raw = DEFAULT_UPSCALER_SCALE
    try:
        scale_val = int(scale_raw)
    except ValueError:
        scale_val = 2

    prompt = ''
    if spec.get('supports_prompt'):
        prompt = (inputs.get('prompt') or data.get('prompt') or '').strip()

    endpoint = spec['endpoint']
    client = fal_common.make_client(api_key)
    try:
        image_url = await fal_common.upload_image(client, str(raw_image).strip())
    except Exception as e:
        err_msg = str(e)
        if fal_common.is_auth_error(err_msg):
            return {
                'error': (
                    f'Upscaler: invalid or expired API key while uploading '
                    f'image. ({err_msg})'
                ),
            }
        return {'error': f'Upscaler: could not upload image — {err_msg}'}

    arguments: dict = {
        spec['image_arg']: image_url,
        spec['scale_arg']: scale_val,
    }
    if prompt:
        arguments['prompt'] = prompt

    try:
        result = await client.subscribe(endpoint, arguments=arguments, with_logs=False)
    except Exception as e:
        return {'error': fal_common.describe_error('Upscaler', endpoint, str(e))}

    img_obj = (result or {}).get('image')
    img_url = img_obj.get('url') if isinstance(img_obj, dict) else None
    if not img_url:
        return {'error': 'Upscaler: API response missing image url.'}

    img_bytes, mime, err = await fal_common.download_image(img_url, 'Upscaler')
    if err:
        return {'error': err}

    declared = img_obj.get('content_type') if isinstance(img_obj, dict) else None
    if declared in ('image/png', 'image/jpeg', 'image/webp'):
        mime = declared

    out_b64 = base64.b64encode(img_bytes).decode('ascii')
    seed_val = result.get('seed') if isinstance(result, dict) else None
    return _image_result(
        f'data:{mime};base64,{out_b64}',
        prompt,
        seed_val if isinstance(seed_val, int) else None,
        spec['label'],
    )


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

async def execute_ai_node(node_type: str, data: dict, inputs: dict) -> dict:
    if node_type == 'falAi':
        return await _execute_fal_ai(data, inputs)
    if node_type == 'imageScfPrompt':
        return await _execute_image_scf_prompt(data, inputs)
    if node_type == 'imageTo3d':
        return await _execute_image_to_3d(data, inputs)
    if node_type == 'upscaler':
        return await _execute_upscaler(data, inputs)
    if node_type in LEGACY_NODES:
        return {'error': legacy_node_error(node_type)}
    return {}
