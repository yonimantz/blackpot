"""The one place that talks to fal.ai.

Every node that reaches fal goes through here: key resolution, client creation,
uploading inputs, and pulling results back down. fal is now our only provider,
so this is also the single chokepoint that P2 has to redirect when the key moves
off the user's machine and behind our own proxy.
"""

import base64
import os

import httpx

# A corporate proxy re-signs TLS; SSL_VERIFY=false is the documented escape hatch
# when the native trust store injection in main.py is not enough.
SSL_VERIFY = os.getenv('SSL_VERIFY', 'true').strip().lower() not in ('false', '0', 'no')

try:
    import fal_client
    HAS_FAL = True
except ImportError:
    HAS_FAL = False

MISSING_CLIENT_ERROR = 'fal-client package is not installed. Run: pip install -U fal-client'

NO_KEY_ERROR = (
    'no fal.ai API key configured. Add your key in Settings, set FAL_KEY in '
    'backend/.env, or set apiKey on the node.'
)


def resolve_api_key(data: dict) -> str:
    """Per-node apiKey overrides the user key from run context, then FAL_KEY env."""
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


def make_client(api_key: str):
    """Scope the key to a client rather than os.environ.

    Concurrent workflow runs share one process and interleave at every await, so
    a process-global FAL_KEY can be cleared by one run while another is still
    mid-flight.
    """
    return fal_client.AsyncClient(key=api_key)


def is_auth_error(err_msg: str) -> bool:
    u = err_msg.upper()
    return (
        '401' in err_msg
        or '403' in err_msg
        or 'UNAUTHORIZED' in u
        or 'FORBIDDEN' in u
        or 'INVALID API KEY' in u
        or 'INVALID_API_KEY' in u
    )


def describe_error(label: str, endpoint: str, err_msg: str) -> str:
    """Turn a fal exception into something a user can act on."""
    if is_auth_error(err_msg):
        return f'{label}: invalid or expired fal.ai API key. ({err_msg})'
    if '404' in err_msg or 'not found' in err_msg.lower():
        return f'{label}: endpoint "{endpoint}" not found. You may need access. ({err_msg})'
    lowered = err_msg.lower()
    if '429' in err_msg or 'quota' in lowered or 'rate' in lowered:
        return f'{label}: rate-limited or out of quota. ({err_msg})'
    return f'{label}: API call failed — {err_msg}'


def strip_data_url(data_url: str) -> str:
    """Return raw base64 from a data URL, or pass through if already raw."""
    if ',' in data_url:
        return data_url.split(',', 1)[1]
    return data_url


def mime_from_data_url(data_url: str, default: str = 'image/png') -> str:
    """Read the declared mime off a data URL header (e.g. 'image/jpeg' from
    'data:image/jpeg;base64,...'). Falls back to *default* for raw base64
    with no header, or anything that doesn't parse."""
    if data_url.startswith('data:') and ',' in data_url:
        header = data_url.split(',', 1)[0]
        mime = header[len('data:'):].split(';', 1)[0].strip()
        if mime:
            return mime
    return default


def to_data_url(img_bytes: bytes, mime: str = 'image/png') -> str:
    return f'data:{mime};base64,' + base64.b64encode(img_bytes).decode('ascii')


async def upload_image(client, b64_data_url_or_raw: str) -> str:
    """Upload a base64 image to fal storage and return its CDN url.

    The content type sent to fal must match the actual bytes — a JPEG/WebP
    upload from importImage tagged as image/png fails to decode on fal's side
    ("provided image could not be read") even though the upload itself
    succeeds, since we're the ones telling fal what format to expect.
    """
    mime = mime_from_data_url(b64_data_url_or_raw)
    img_bytes = base64.b64decode(strip_data_url(b64_data_url_or_raw))
    return await client.upload(img_bytes, mime)


async def download_image(url: str, label: str) -> tuple[bytes | None, str, str]:
    """Fetch a result image. Returns (bytes, mime, error) with exactly one of
    bytes/error set."""
    try:
        async with httpx.AsyncClient(timeout=120.0, verify=SSL_VERIFY) as http:
            resp = await http.get(url)
        if resp.status_code != 200:
            return None, '', f'{label}: failed to download result image ({resp.status_code}).'
    except httpx.TimeoutException:
        return None, '', f'{label}: timed out fetching result image.'
    except httpx.RequestError as e:
        return None, '', f'{label}: network error fetching result image — {e}'

    mime = resp.headers.get('content-type', 'image/png').split(';')[0].strip()
    if mime not in ('image/png', 'image/jpeg', 'image/webp'):
        mime = 'image/png'
    return resp.content, mime, ''


_MODEL_FILE_MIMES = (
    'model/gltf-binary',
    'model/gltf+json',
    'application/octet-stream',
    'application/gltf-buffer',
    'binary/octet-stream',
)


async def download_file(
    url: str,
    label: str,
    allowed_mimes: tuple[str, ...] = _MODEL_FILE_MIMES,
) -> tuple[bytes | None, str, str]:
    """Fetch a non-image result (GLB, etc.). Returns (bytes, mime, error).

    Unlike ``download_image``, unknown content-types are inferred from the URL
    rather than coerced to ``image/png``.
    """
    try:
        async with httpx.AsyncClient(timeout=120.0, verify=SSL_VERIFY) as http:
            resp = await http.get(url)
        if resp.status_code != 200:
            return None, '', f'{label}: failed to download result file ({resp.status_code}).'
    except httpx.TimeoutException:
        return None, '', f'{label}: timed out fetching result file.'
    except httpx.RequestError as e:
        return None, '', f'{label}: network error fetching result file — {e}'

    mime = resp.headers.get('content-type', '').split(';')[0].strip().lower()
    path = (url or '').split('?', 1)[0].lower()
    if mime not in allowed_mimes:
        if path.endswith('.glb'):
            mime = 'model/gltf-binary'
        elif path.endswith('.gltf'):
            mime = 'model/gltf+json'
        elif mime.startswith('text/') or mime.startswith('image/') or mime.startswith('application/json'):
            return None, '', f'{label}: unexpected file type ({mime or "unknown"}).'
        else:
            mime = 'model/gltf-binary'
    return resp.content, mime, ''
