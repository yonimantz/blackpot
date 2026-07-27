import { getUploadFileUrl } from './api';

/** Preview fields on nodes that output an image, in priority order:
 *  - `fileAssetId`         → externalized import-image source (served by URL)
 *  - `fileData`            → legacy/inline import-image source (base64)
 *  - `previewData`         → preview node's own cached run output
 *  - `_editorPreview` etc. → live previews from tool modals / canvas bake (may include alpha)
 *  - `_result.image`      → last workflow run output (can be stale after editing node params)
 *  - `_resizePreview`      → Resize node live dimensions before re-run
 */
export function getNodeImageOutputDataUrl(
  data: Record<string, any> | undefined,
  handleId?: string | null,
): string | null {
  if (!data) return null;
  if (handleId && handleId.startsWith('out')) {
    const dividerPreview = data._dividerOutputs?.[handleId];
    if (typeof dividerPreview === 'string' && dividerPreview) return dividerPreview;
    const dividerRunResult = data._result?.[handleId];
    if (typeof dividerRunResult === 'string' && dividerRunResult) return dividerRunResult;
  }
  if (typeof data.fileAssetId === 'string' && data.fileAssetId) {
    return getUploadFileUrl(data.fileAssetId);
  }
  return (
    data.fileData ||
    data.previewData ||
    data._editorPreview ||
    data._compositorPreview ||
    data._vignettePreview ||
    data._stackPreview ||
    data._keyColorBaked ||
    data._removeBgBaked ||
    data._resizePreview ||
    data._result?.image ||
    null
  );
}

/** Resolve a data URL / preview string from the node connected to a target handle. */
export function getConnectedImageDataUrl(
  nodeId: string,
  handleId: string,
  edges: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
): string | null {
  const edge = edges.find((e) => e.target === nodeId && e.targetHandle === handleId);
  if (!edge) return null;
  const sourceNode = allNodes.find((n) => n.id === edge.source);
  if (!sourceNode) return null;
  return getNodeImageOutputDataUrl(sourceNode.data as Record<string, any>, edge.sourceHandle);
}
