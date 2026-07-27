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
    const upstream = getConnectedImageDataUrl(
      node.id,
      'image',
      store.edges,
      store.nodes,
    );
    const finalImg = upstream || ssrcImg;
    if (finalImg) {
      store.lockPreviewNodeSize(node.id);
      store.updateNodeData(node.id, { previewData: finalImg });
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
  if (node.type === 'stackImages' && result.image) {
    store.updateNodeData(node.id, { _stackPreview: result.image });
  }
  if (node.type === 'exportImage') {
    // Export is on-demand only — normal run is a no-op.
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
