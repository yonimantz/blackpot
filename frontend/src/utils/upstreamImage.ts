import { getModelFileUrl, getUploadFileUrl } from './api';
import type { Model3dDescriptor } from '../types/nodeTypes';
import { captureModel3dImage } from './model3dCapture';

export interface ImageResolveOptions {
  /**
   * Fall back to the node's saved preview asset when nothing live is in memory.
   * On by default. Turn it off where a stale copy would be worse than nothing:
   * a fresh run result should never lose to one, and values that leave the
   * browser have to be real image data rather than a URL.
   */
  includeSaved?: boolean;
}

/**
 * URL of a node's saved preview, written to the file store after a run or bake.
 *
 * This is the only image reference on most nodes that survives a save, so it is
 * what makes previews reappear after a tab switch or a reload — and, because
 * upstream resolution flows through here, what lets downstream bakes re-derive
 * themselves instead of coming back blank.
 */
export function getSavedPreviewUrl(
  data: Record<string, any> | undefined,
  handleId?: string | null,
): string | null {
  if (!data) return null;
  const rev = typeof data.previewAssetRev === 'number' ? data.previewAssetRev : null;
  if (handleId && handleId.startsWith('out')) {
    const perHandle = data.previewAssetIds?.[handleId];
    return typeof perHandle === 'string' && perHandle
      ? getUploadFileUrl(perHandle, rev)
      : null;
  }
  const id = data.previewAssetId;
  return typeof id === 'string' && id ? getUploadFileUrl(id, rev) : null;
}

/** Preview fields on nodes that output an image, in priority order:
 *  - live 3D capture       → Preview 3D's `image` output (browser is the only renderer, so this always wins when available)
 *  - `fileAssetId`         → externalized import-image source (served by URL)
 *  - `fileData`            → legacy/inline import-image source (base64)
 *  - `previewData`         → preview node's own cached run output
 *  - `_editorPreview` etc. → live previews from tool modals / canvas bake (may include alpha)
 *  - `_cropPreview` etc.   → live canvas bakes for Crop / Rotate / Set Mask / Simple Combine
 *  - `_vignettePreview`, `_blurPreview` → Apply-gated bakes, cleared when their params change
 *  - `_result.image`      → last workflow run output (can be stale after editing node params)
 *  - `_resizePreview`      → Resize node live dimensions before re-run
 *  - `previewAssetId`      → saved copy of the above, the only one that outlives a save
 */
export function getNodeImageOutputDataUrl(
  data: Record<string, any> | undefined,
  handleId?: string | null,
  nodeId?: string | null,
  opts?: ImageResolveOptions,
): string | null {
  if (!data) return null;
  const includeSaved = opts?.includeSaved !== false;
  if (nodeId && (!handleId || handleId === 'image')) {
    const live = captureModel3dImage(nodeId);
    if (live) return live;
  }
  if (handleId && handleId.startsWith('out')) {
    const dividerPreview = data._dividerOutputs?.[handleId];
    if (typeof dividerPreview === 'string' && dividerPreview) return dividerPreview;
    const dividerRunResult = data._result?.[handleId];
    if (typeof dividerRunResult === 'string' && dividerRunResult) return dividerRunResult;
    if (includeSaved) {
      const saved = getSavedPreviewUrl(data, handleId);
      if (saved) return saved;
    }
  }
  if (typeof data.fileAssetId === 'string' && data.fileAssetId) {
    return getUploadFileUrl(data.fileAssetId);
  }
  return (
    data.fileData ||
    data.previewData ||
    data._editorPreview ||
    data._compositorPreview ||
    data._cropPreview ||
    data._rotatePreview ||
    data._maskPreview ||
    data._combinePreview ||
    data._vignettePreview ||
    data._blurPreview ||
    data._adjustmentsPreview ||
    data._stackPreview ||
    data._keyColorBaked ||
    data._removeBgBaked ||
    data._resizePreview ||
    data._result?.image ||
    (includeSaved ? getSavedPreviewUrl(data) : null) ||
    null
  );
}

/** Resolve a data URL / preview string from the node connected to a target handle. */
export function getConnectedImageDataUrl(
  nodeId: string,
  handleId: string,
  edges: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
  opts?: ImageResolveOptions,
): string | null {
  const edge = edges.find((e) => e.target === nodeId && e.targetHandle === handleId);
  if (!edge) return null;
  const sourceNode = allNodes.find((n) => n.id === edge.source);
  if (!sourceNode) return null;
  return getNodeImageOutputDataUrl(
    sourceNode.data as Record<string, any>,
    edge.sourceHandle,
    sourceNode.id,
    opts,
  );
}

function asModel3dDescriptor(value: unknown): Model3dDescriptor | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.assetId !== 'string' || !rec.assetId) return null;
  return {
    assetId: rec.assetId,
    url: typeof rec.url === 'string' ? rec.url : '',
    format: typeof rec.format === 'string' ? rec.format : 'glb',
    sizeBytes: typeof rec.sizeBytes === 'number' ? rec.sizeBytes : undefined,
  };
}

/**
 * Last mesh descriptor a node can offer: `_result.model` for a generator that
 * has just run, or `modelAssetId` for Import 3D / a prior run whose `_result`
 * was stripped on save. The asset id is what survives tab switches and reloads
 * — the GLB bytes stay on disk under MODELS_DIR.
 */
export function getNodeModel3dOutput(data: Record<string, any> | undefined): Model3dDescriptor | null {
  if (!data) return null;
  const fromResult = asModel3dDescriptor(data._result?.model);
  if (fromResult) return fromResult;
  if (typeof data.modelAssetId === 'string' && data.modelAssetId) {
    return {
      assetId: data.modelAssetId,
      url: getModelFileUrl(data.modelAssetId),
      format: 'glb',
      sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : undefined,
    };
  }
  return null;
}

/** Resolve a mesh descriptor from the node connected to a target handle. */
export function getConnectedModel3d(
  nodeId: string,
  handleId: string,
  edges: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
): Model3dDescriptor | null {
  const edge = edges.find(
    (e) => e.target === nodeId && (e.targetHandle === handleId || (!e.targetHandle && handleId === 'model')),
  );
  if (!edge) return null;
  const sourceNode = allNodes.find((n) => n.id === edge.source);
  if (!sourceNode) return null;
  const sourceData = sourceNode.data as Record<string, any> | undefined;
  if (!sourceData) return null;
  const handleKey = edge.sourceHandle || 'model';
  return asModel3dDescriptor(sourceData._result?.[handleKey]) || getNodeModel3dOutput(sourceData);
}
