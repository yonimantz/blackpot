import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from './upstreamImage';

function sameNodeId(a: unknown, b: unknown) {
  return a === b || String(a) === String(b);
}

/** Apply a single node's SSE/run result into the workflow store (shared by editor Run and Playground template runs). */
export function applyNodeResult(
  nodeId: string,
  result: any,
  streamingResults?: Record<string, any>,
) {
  if (streamingResults) streamingResults[String(nodeId)] = result;
  const store = useWorkflowStore.getState();
  const node = store.nodes.find((n) => sameNodeId(n.id, nodeId));
  if (!node) return;

  if (result.error || result.skipped) return;

  if (node.type === 'preview') {
    const ssrcImg =
      typeof result?.image === 'string' && result.image.length > 0
        ? (result.image as string)
        : null;
    // Live upstream only — this node just produced a fresh result, so a saved
    // preview from an earlier session must not be picked over it.
    const upstream = getConnectedImageDataUrl(
      node.id,
      'image',
      store.edges,
      store.nodes,
      { includeSaved: false },
    );
    const finalImg = upstream || ssrcImg;
    if (finalImg) {
      store.lockPreviewNodeSize(node.id);
      const patch: Record<string, unknown> = { previewData: finalImg };
      if (result._meta && typeof result._meta === 'object') {
        patch.previewMeta = result._meta;
      } else {
        patch.previewMeta = null;
      }
      store.updateNodeData(node.id, patch);
    }
    return;
  }
  if (node.type === 'editor' && result.image) {
    store.updateNodeData(node.id, { _editorPreview: result.image });
  }
  if (node.type === 'compositor' && result.image) {
    store.updateNodeData(node.id, { _compositorPreview: result.image });
  }
  if (node.type === 'vignette' && result.image) {
    store.updateNodeData(node.id, { _vignettePreview: result.image });
  }
  if (node.type === 'adjustments' && result.image) {
    store.updateNodeData(node.id, { _adjustmentsPreview: result.image });
  }
  if (node.type === 'stackImages' && result.image) {
    store.updateNodeData(node.id, { _stackPreview: result.image });
  }
  if (node.type === 'pickRandom') {
    const out = result.out;
    const isImg = typeof out === 'string' && out.startsWith('data:');
    store.updateNodeData(node.id, { _result: isImg ? { ...result, image: out } : result });
    return;
  }
  if (node.type === 'boolean') {
    const out = result.value;
    const isImg = typeof out === 'string' && out.startsWith('data:');
    store.updateNodeData(node.id, { _result: isImg ? { ...result, image: out } : result });
    return;
  }
  if (node.type === 'exportImage' || node.type === 'export3d') {
    // Export is on-demand only — normal run is a no-op.
  } else if (node.type === 'imageTo3d' || node.type === 'preview3d') {
    // Keep the mesh id on the node (not only in `_result`): `_`-prefixed
    // fields are stripped on save, so without this Preview 3D / Image to 3D
    // come back empty after a tab switch or app restart. The GLB itself
    // already lives in MODELS_DIR under this asset id.
    const model = result?.model;
    const assetId =
      model && typeof model === 'object' && typeof model.assetId === 'string'
        ? (model.assetId as string)
        : '';
    const patch: Record<string, unknown> = { _result: result };
    if (assetId) {
      patch.modelAssetId = assetId;
      if (typeof model.sizeBytes === 'number') patch.sizeBytes = model.sizeBytes;
    }
    store.updateNodeData(node.id, patch);
  } else if (result.image && node.type !== 'preview') {
    store.updateNodeData(node.id, { _result: result });
  } else if (
    typeof result.text === 'string' &&
    result.image == null &&
    result.data == null
  ) {
    store.updateNodeData(node.id, { text: result.text, _result: result });
  }
  if (result.data && node.type !== 'preview') {
    store.updateNodeData(node.id, { _result: result.data });
  }
}

export function formatWorkflowRunErrors(mergedResults: Record<string, any>): string[] {
  const errors: string[] = [];
  for (const [nodeId, result] of Object.entries(mergedResults)) {
    if (nodeId === '_cancelled') continue;
    if (result.skipped && !result.error) continue;
    if (result.error) {
      const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
      const label = (node?.data?.label as string) || node?.type || nodeId;
      let msg = String(result.error);
      const dup = `${label}: `;
      if (msg.startsWith(dup)) {
        msg = msg.slice(dup.length);
      }
      errors.push(`${label}: ${msg}`);
    }
  }
  return errors;
}
