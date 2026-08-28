import { useEffect } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { normalizeCropAnchor, resolveCropRect } from './anchorPlacement';

/** Size currently stored on the node, read straight from the live store. */
function readStoredSize(nodeId: string): { width: number; height: number } {
  const data = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as
    | Record<string, any>
    | undefined;
  return {
    width: Math.max(0, Number(data?._origWidth) || 0),
    height: Math.max(0, Number(data?._origHeight) || 0),
  };
}

/**
 * Mirrors the natural size of `src` onto the node as `_origWidth` /
 * `_origHeight` and returns it. Both are transient (stripped on save) and are
 * what the anchor math needs in order to place a box inside the source image.
 */
export function useSourceImageSizeSync(
  nodeId: string,
  src: string | null,
  data: Record<string, any>,
): { width: number; height: number } {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const width = Math.max(0, Number(data._origWidth) || 0);
  const height = Math.max(0, Number(data._origHeight) || 0);

  // The stored size is compared against the live store rather than the props
  // this effect closes over, so writing it doesn't re-trigger the image load.
  useEffect(() => {
    if (!src) {
      const stored = readStoredSize(nodeId);
      if (stored.width || stored.height) {
        updateNodeData(nodeId, { _origWidth: 0, _origHeight: 0 });
      }
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      const stored = readStoredSize(nodeId);
      if (w === stored.width && h === stored.height) return;
      updateNodeData(nodeId, { _origWidth: w, _origHeight: h });
    };
    img.onerror = () => {
      /* keep the last known size on load errors */
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, nodeId, updateNodeData]);

  return { width, height };
}

/**
 * Keeps the Crop node's stored x/y in step with its anchor + offset.
 *
 * The backend derives the rectangle the same way, so persisting it here is
 * only so the crop editor overlay, the node body and the inspector all show
 * the rectangle that a run will actually produce.
 */
export function useCropAnchorSync(
  nodeId: string,
  data: Record<string, any>,
  srcW: number,
  srcH: number,
) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const anchor = normalizeCropAnchor(data.anchor);
  const rect = resolveCropRect(data, srcW, srcH);
  const storedX = Math.round(Number(data.x) || 0);
  const storedY = Math.round(Number(data.y) || 0);

  useEffect(() => {
    if (anchor === 'free' || srcW <= 0 || srcH <= 0) return;
    if (rect.x === storedX && rect.y === storedY) return;
    updateNodeData(nodeId, { x: rect.x, y: rect.y });
  }, [anchor, srcW, srcH, rect.x, rect.y, storedX, storedY, nodeId, updateNodeData]);

  return rect;
}
