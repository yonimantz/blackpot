/** Preview fields on nodes that output an image (same order as getConnectedImageDataUrl). */
export function getNodeImageOutputDataUrl(data: Record<string, any> | undefined): string | null {
  if (!data) return null;
  return (
    data.fileData ||
    data._result?.image ||
    data.previewData ||
    data._editorPreview ||
    data._compositorPreview ||
    data._vignettePreview ||
    null
  );
}

/** Resolve a data URL / preview string from the node connected to a target handle. */
export function getConnectedImageDataUrl(
  nodeId: string,
  handleId: string,
  edges: { source: string; target: string; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
): string | null {
  const edge = edges.find((e) => e.target === nodeId && e.targetHandle === handleId);
  if (!edge) return null;
  const sourceNode = allNodes.find((n) => n.id === edge.source);
  if (!sourceNode) return null;
  return getNodeImageOutputDataUrl(sourceNode.data as Record<string, any>);
}
