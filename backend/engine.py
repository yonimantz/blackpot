import asyncio
import base64
import io
from collections import defaultdict, deque
from typing import Any
from nodes.tool_nodes import execute_tool_node
from nodes.value_nodes import execute_value_node
from nodes.read_nodes import execute_read_node
from nodes.io_nodes import execute_io_node
from nodes.ai_nodes import _apply_resolution_output, execute_ai_node, resolve_gemini_api_key
from nodes.text_nodes import execute_text_node


async def _safe_execute_nano_banana_pro(data: dict, inputs: dict) -> dict:
    """Run Nano Banana Pro, retrying with a minimal request when the API
    rejects one of the optional generation parameters."""
    result = await execute_ai_node('nanoBananaPro', data, inputs)

    if not isinstance(result, dict) or 'error' not in result:
        return result

    err = result['error']
    if 'not supported' not in err.lower() and 'extra_forbidden' not in err.lower():
        return result

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return result

    api_key = resolve_gemini_api_key(data)
    prompt = inputs.get('prompt') or data.get('prompt', '')
    if not api_key or not prompt:
        return result

    client = genai.Client(api_key=api_key)
    gen_config = types.GenerateContentConfig(response_modalities=['IMAGE'])

    contents: list = []
    for key in ('referenceImage1', 'referenceImage2',
                'referenceImage3', 'referenceImage4'):
        img = inputs.get(key)
        if img:
            raw = img.split(',', 1)[1] if ',' in img else img
            contents.append(
                types.Part.from_bytes(
                    data=base64.b64decode(raw), mime_type='image/png'))
    contents.append(prompt)

    def _gen():
        return client.models.generate_content(
            model='gemini-3-pro-image-preview',
            contents=contents,
            config=gen_config,
        )

    try:
        response = await asyncio.to_thread(_gen)
    except Exception as e2:
        return {'error': f'Nano Banana Pro: API call failed — {e2}'}

    candidates = getattr(response, 'candidates', None)
    if not candidates:
        return {'error': 'Nano Banana Pro: API returned no candidates.'}

    parts = candidates[0].content.parts if candidates[0].content else []
    for part in parts:
        inline = getattr(part, 'inline_data', None)
        if inline and inline.data:
            img_bytes = inline.data
            mime = getattr(inline, 'mime_type', None) or 'image/png'
            if isinstance(img_bytes, str):
                img_bytes = base64.b64decode(img_bytes)
            resolution = data.get('resolution', '1k')
            img_bytes = _apply_resolution_output(img_bytes, resolution, mime)
            b64 = base64.b64encode(img_bytes).decode('ascii')
            return {'image': f'data:{mime};base64,{b64}'}

    return {'error': 'Nano Banana Pro: response contained no image data'}

_cancel_event = asyncio.Event()


class WorkflowCancelled(Exception):
    pass


def request_cancel():
    _cancel_event.set()


def reset_cancel():
    _cancel_event.clear()


def is_cancelled() -> bool:
    return _cancel_event.is_set()

TOOL_TYPES = {
    'resize', 'crop', 'blur', 'rotate', 'editor', 'compositor', 'vignette',
    'getChannel', 'setMask', 'simpleCombine', 'removeBg', 'keyColor', 'stackImages', 'divider',
}
VALUE_TYPES = {'numberValue', 'colorValue'}
TEXT_TYPES = {'prompt', 'combinePrompts', 'refMapper', 'sketch2Final', 'studio'}
READ_TYPES = {'getImageSize', 'getColorPalette'}
IO_TYPES = {'importImage', 'exportImage', 'preview'}
AI_TYPES = {'nanoBananaPro', 'nanoBanana2', 'nanoBanana2Free', 'imageScfPrompt', 'gptImage2', 'falAi'}

# AI nodes that output text on the `text` handle (bypass must not force image passthrough).
AI_TEXT_OUTPUT_TYPES = {'imageScfPrompt'}


def _find_connected_node_ids(nodes: list[dict], edges: list[dict]) -> set[str]:
    """Return the set of node IDs that participate in at least one edge
    (either as source or target).  Completely disconnected nodes — those with
    zero edges — are excluded so they don't run."""
    connected: set[str] = set()
    all_ids = {n['id'] for n in nodes}
    for e in edges:
        if e['source'] in all_ids:
            connected.add(e['source'])
        if e['target'] in all_ids:
            connected.add(e['target'])
    return connected


def topological_sort(nodes: list[dict], edges: list[dict]) -> list[str]:
    graph: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {}

    for n in nodes:
        in_degree[n['id']] = 0

    for e in edges:
        graph[e['source']].append(e['target'])
        in_degree[e['target']] = in_degree.get(e['target'], 0) + 1

    queue = deque([nid for nid, deg in in_degree.items() if deg == 0])
    order = []

    while queue:
        nid = queue.popleft()
        order.append(nid)
        for neighbor in graph[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(order) != len(nodes):
        raise ValueError("Cycle detected in workflow graph")

    return order


def resolve_inputs(
    node_id: str,
    node_data: dict,
    edges: list[dict],
    outputs: dict[str, dict[str, Any]],
    node_map: dict[str, dict] | None = None,
) -> dict[str, Any]:
    """Gather input values for a node from connected outputs."""
    inputs: dict[str, Any] = {}
    for edge in edges:
        if edge['target'] == node_id:
            source_id = edge['source']
            # JSON null becomes None in Python; normalize so '' is never confused with missing keys.
            source_handle = edge.get('sourceHandle') or ''
            target_handle = edge.get('targetHandle') or ''
            source_outputs = outputs.get(source_id, {})
            val = None
            if source_handle in source_outputs:
                val = source_outputs[source_handle]
            elif not source_handle and 'image' in source_outputs:
                # Multi-output nodes (e.g. keyColor): default to main image when handle omitted.
                val = source_outputs['image']
            if val is not None:
                th = target_handle
                if not th and node_map:
                    nt = node_map.get(node_id, {}).get('type')
                    if nt in IO_TYPES:
                        th = 'image'
                if not th:
                    continue
                inputs[th] = val
    return inputs


def _save_image_to_collection(data_url: str, workflow_id: str | None = None):
    """Extract bytes from a data-URL and persist to the collection store."""
    try:
        from persistence import get_persistence
        from database import LEGACY_OWNER_SENTINEL
        from request_context import get_run_context
        from PIL import Image as _PILImage

        if ',' not in data_url:
            return
        header, b64 = data_url.split(',', 1)
        img_bytes = base64.b64decode(b64)

        ext = 'png'
        if 'jpeg' in header or 'jpg' in header:
            ext = 'jpg'
        elif 'webp' in header:
            ext = 'webp'

        width, height = None, None
        try:
            img = _PILImage.open(io.BytesIO(img_bytes))
            width, height = img.width, img.height
        except Exception:
            pass

        ctx = get_run_context()
        owner = (
            ctx.owner_uid
            if ctx and ctx.owner_uid
            else LEGACY_OWNER_SENTINEL
        )
        store = get_persistence()
        store.add_to_collection(
            owner,
            img_bytes,
            ext=ext,
            workflow_id=workflow_id,
            width=width,
            height=height,
        )
    except Exception:
        pass


async def run_workflow(workflow: dict) -> dict[str, Any]:
    return await run_workflow_streaming(workflow, progress_callback=None)


async def run_workflow_streaming(
    workflow: dict,
    progress_callback=None,
) -> dict[str, Any]:
    """Run a workflow. If progress_callback is provided, it is called with
    (event_type, payload) at each stage so the caller can stream SSE events.

    Behaviour:
    - Nodes that are completely disconnected (no edges at all) are skipped.
    - Nodes marked as bypassed pass through the first input unchanged.
    - If a node produces an error, every downstream node that depends on it
      is also skipped so the workflow doesn't cascade broken data.
    """
    all_nodes = workflow['nodes']
    edges = workflow['edges']
    workflow_id = workflow.get('workflow_id')

    connected_ids = _find_connected_node_ids(all_nodes, edges)

    nodes_to_run = []
    skipped_ids: set[str] = set()
    for n in all_nodes:
        nid = n['id']
        data = n.get('data', {})
        if nid not in connected_ids:
            skipped_ids.add(nid)
            continue
        if data.get('bypassed', False):
            skipped_ids.add(nid)
            continue
        nodes_to_run.append(n)

    bypassed_nodes = [
        n for n in all_nodes
        if n['id'] in connected_ids and n.get('data', {}).get('bypassed', False)
    ]

    active_edges = [
        e for e in edges
        if e['source'] not in (skipped_ids - {n['id'] for n in bypassed_nodes})
        and e['target'] not in (skipped_ids - {n['id'] for n in bypassed_nodes})
    ]

    runnable_nodes = nodes_to_run + bypassed_nodes
    node_map = {n['id']: n for n in all_nodes}
    order = topological_sort(
        [{'id': n['id']} for n in runnable_nodes],
        active_edges,
    )

    failed_ids: set[str] = set()
    outputs: dict[str, dict[str, Any]] = {}
    results: dict[str, Any] = {}

    skipped_disconnected = [
        nid for nid in skipped_ids
        if nid not in {n['id'] for n in bypassed_nodes}
    ]
    for nid in skipped_disconnected:
        # Notes are decorative-only; never report them as skipped so they
        # don't dim or show the SKIPPED badge after a run.
        if node_map.get(nid, {}).get('type') == 'note':
            continue
        results[nid] = {'skipped': True, 'reason': 'disconnected'}

    def _has_failed_ancestor(nid: str) -> bool:
        """Check whether any upstream node of *nid* has failed."""
        for e in edges:
            if e['target'] == nid and e['source'] in failed_ids:
                return True
        return False

    reset_cancel()

    for node_id in order:
        if is_cancelled():
            results['_cancelled'] = True
            if progress_callback:
                await progress_callback('cancelled', {})
            break

        node = node_map[node_id]
        node_type = node['type']
        node_data = node.get('data', {})

        if _has_failed_ancestor(node_id):
            failed_ids.add(node_id)
            results[node_id] = {
                'error': 'Skipped — an upstream node failed.',
                'skipped': True,
            }
            outputs[node_id] = {}
            if progress_callback:
                await progress_callback('node_start', {'nodeId': node_id})
                await progress_callback('node_done', {
                    'nodeId': node_id, 'result': results[node_id],
                })
            continue

        if progress_callback:
            await progress_callback('node_start', {'nodeId': node_id})

        inputs = resolve_inputs(node_id, node_data, edges, outputs, node_map)

        if node_data.get('bypassed', False):
            first_input_val = next(iter(inputs.values()), None) if inputs else None
            if first_input_val is not None:
                if node_type in TOOL_TYPES:
                    outputs[node_id] = {'image': first_input_val}
                elif node_type in AI_TEXT_OUTPUT_TYPES:
                    outputs[node_id] = {'text': ''}
                elif node_type in AI_TYPES or node_type in IO_TYPES:
                    outputs[node_id] = {'image': first_input_val}
                else:
                    outputs[node_id] = {'value': first_input_val}
            else:
                outputs[node_id] = {}
            results[node_id] = {'bypassed': True}
            if progress_callback:
                await progress_callback('node_done', {
                    'nodeId': node_id, 'result': results[node_id],
                })
            continue

        try:
            if node_type in TOOL_TYPES:
                node_outputs = execute_tool_node(node_type, node_data, inputs)
            elif node_type in VALUE_TYPES:
                node_outputs = execute_value_node(node_type, node_data, inputs)
            elif node_type in TEXT_TYPES:
                node_outputs = execute_text_node(node_type, node_data, inputs)
            elif node_type in READ_TYPES:
                node_outputs = execute_read_node(node_type, node_data, inputs)
            elif node_type in IO_TYPES:
                node_outputs = execute_io_node(node_type, node_data, inputs)
            elif node_type == 'nanoBananaPro':
                node_outputs = await _safe_execute_nano_banana_pro(node_data, inputs)
            elif node_type in AI_TYPES:
                node_outputs = await execute_ai_node(node_type, node_data, inputs)
            else:
                node_outputs = {}

            if isinstance(node_outputs, dict) and 'error' in node_outputs:
                failed_ids.add(node_id)
                results[node_id] = node_outputs
                outputs[node_id] = {}
            else:
                outputs[node_id] = node_outputs
                results[node_id] = node_outputs

                if node_type in AI_TYPES and isinstance(node_outputs, dict) and 'image' in node_outputs:
                    _save_image_to_collection(node_outputs['image'], workflow_id=workflow_id)

        except Exception as e:
            failed_ids.add(node_id)
            results[node_id] = {'error': str(e)}
            outputs[node_id] = {}

        if progress_callback:
            await progress_callback('node_done', {
                'nodeId': node_id, 'result': results[node_id],
            })

        await asyncio.sleep(0)

    return results
