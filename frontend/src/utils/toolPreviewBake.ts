import { useEffect, useRef } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { encodeCanvasPreview } from './previewEncoding';
import { drawCompositorLayers } from '../compositor/compositorUtils';
import { applyVignetteLayersToRgba, type VignetteLayerData } from './vignetteMath';

export type LoadedImages = Record<string, HTMLImageElement>;

/** Draws into `canvas`/`ctx` (the drawer sets its own size) from the loaded
 * images, keyed the same as the `sources` map that produced them. Returns
 * `false` when there is nothing to render (e.g. a required input missing). */
export type ToolPreviewDraw = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  images: LoadedImages,
) => boolean;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface UseToolPreviewBakeOptions {
  nodeId: string;
  /** Node data field the bake is written to, e.g. `_cropPreview`. */
  field: string;
  /** Named input handles resolved to a source string (or null/undefined when unconnected). */
  sources: Record<string, string | null | undefined>;
  /** Extra dependency signature covering every non-image param the draw reads. */
  signature: string;
  maxEdge?: number;
  draw: ToolPreviewDraw;
}

/**
 * Generalized `useEditorPreviewBake`: mirrors a backend tool op in canvas and
 * writes the result to `data[field]`, so a connected Preview node (or another
 * tool node downstream) updates without a workflow run. Follows the same
 * shape as `ResizePreviewCanvas` / `StackImagesCanvasPreview` — one bake per
 * node, keyed on both the resolved image sources and a caller-supplied
 * signature of the non-image params. When `draw` reports nothing to render
 * (missing input), the field is cleared instead of left stale.
 */
export function useToolPreviewBake({
  nodeId,
  field,
  sources,
  signature,
  maxEdge,
  draw,
}: UseToolPreviewBakeOptions): void {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const lastBakedRef = useRef<string>('');

  const keys = Object.keys(sources).sort();
  const srcSig = keys.map((k) => sources[k] || '').join('|');

  useEffect(() => {
    let cancelled = false;

    const clearBake = () => {
      if (lastBakedRef.current) {
        lastBakedRef.current = '';
        updateNodeData(nodeId, { [field]: '' });
      }
    };

    (async () => {
      const loaded: LoadedImages = {};
      for (const k of keys) {
        const src = sources[k];
        if (!src) continue;
        const img = await loadImage(src);
        if (cancelled) return;
        if (img) loaded[k] = img;
      }
      if (cancelled) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const ok = draw(ctx, canvas, loaded);
      if (!ok) {
        clearBake();
        return;
      }

      let url: string;
      try {
        url = encodeCanvasPreview(canvas, maxEdge);
      } catch {
        return;
      }
      if (cancelled) return;
      if (lastBakedRef.current === url) return;
      lastBakedRef.current = url;
      updateNodeData(nodeId, { [field]: url });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, field, srcSig, signature, maxEdge]);
}

/**
 * Apply-gated bakes (Vignette, Blur) can go stale: their preview field only
 * updates when the user clicks Apply, but the params it was baked from can
 * keep changing underneath it. Clears `field` the moment `signature` changes
 * after the initial mount, so the resolver chain falls back to the last run's
 * image instead of showing an outdated bake.
 */
export function useInvalidateBakeOnChange(
  nodeId: string,
  field: string,
  signature: string,
  hasBake: boolean,
): void {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const lastSigRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastSigRef.current === null) {
      lastSigRef.current = signature;
      return;
    }
    if (lastSigRef.current === signature) return;
    lastSigRef.current = signature;
    if (hasBake) updateNodeData(nodeId, { [field]: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

/**
 * One-shot bake for Apply buttons (Vignette, Blur): resolves `sources`,
 * loads each into an <img>, draws, and returns the encoded preview — or null
 * when a required source failed to load or nothing was drawn.
 */
export async function bakeCanvasPreview(
  sources: Record<string, string | null | undefined>,
  draw: ToolPreviewDraw,
  maxEdge?: number,
): Promise<string | null> {
  const loaded: LoadedImages = {};
  for (const [k, src] of Object.entries(sources)) {
    if (!src) continue;
    const img = await loadImage(src);
    if (!img) return null;
    loaded[k] = img;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (!draw(ctx, canvas, loaded)) return null;
  try {
    return encodeCanvasPreview(canvas, maxEdge);
  } catch {
    return null;
  }
}

/** Mirrors backend `_apply_crop`: `rect` is the already-anchored/clamped crop
 * rectangle (see `resolveCropRect`); drawing the source at a negative offset
 * and letting the canvas clip to `rect.w × rect.h` reproduces both the crop
 * and the transparent padding a too-large rectangle gets. */
export function drawCrop(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  images: LoadedImages,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  const img = images.image;
  if (!img) return false;
  canvas.width = Math.max(1, Math.round(rect.w));
  canvas.height = Math.max(1, Math.round(rect.h));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, -rect.x, -rect.y);
  return true;
}

/** Mirrors backend `rotate` in `execute_tool_node`: expand to the rotated
 * bounding box, rotate, then flipH/flipV in that order. PIL's `rotate()` is
 * counter-clockwise for positive angles; canvas `rotate()` is clockwise, so
 * the angle is negated here to keep the two in visual agreement. */
export function drawRotate(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  images: LoadedImages,
  angle: number,
  flipH: boolean,
  flipV: boolean,
): boolean {
  const img = images.image;
  if (!img) return false;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const rad = (-angle * Math.PI) / 180;

  let bw = w;
  let bh = h;
  if (angle % 360 !== 0) {
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    bw = Math.max(1, Math.round(w * cos + h * sin));
    bh = Math.max(1, Math.round(w * sin + h * cos));
  }

  const rotated = document.createElement('canvas');
  rotated.width = bw;
  rotated.height = bh;
  const rctx = rotated.getContext('2d');
  if (!rctx) return false;
  rctx.translate(bw / 2, bh / 2);
  rctx.rotate(rad);
  rctx.drawImage(img, -w / 2, -h / 2, w, h);

  canvas.width = bw;
  canvas.height = bh;
  ctx.save();
  ctx.translate(flipH ? bw : 0, flipV ? bh : 0);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(rotated, 0, 0);
  ctx.restore();
  return true;
}

/** Mirrors backend `_execute_set_mask`: resize the mask to the image's size,
 * convert it to PIL's `L` luminance, honor `invert`, and multiply it into the
 * image's existing alpha. */
export function drawSetMask(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  images: LoadedImages,
  invert: boolean,
): boolean {
  const img = images.image;
  const mask = images.mask;
  if (!img || !mask) return false;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext('2d');
  if (!mctx) return false;
  mctx.drawImage(mask, 0, 0, w, h);
  const maskData = mctx.getImageData(0, 0, w, h);

  const px = imageData.data;
  const mpx = maskData.data;
  for (let i = 0; i < px.length; i += 4) {
    let l = 0.299 * mpx[i]! + 0.587 * mpx[i + 1]! + 0.114 * mpx[i + 2]!;
    if (invert) l = 255 - l;
    px[i + 3] = Math.round((px[i + 3]! * l) / 255);
  }
  ctx.putImageData(imageData, 0, 0);
  return true;
}

/** Mirrors backend `_execute_simple_combine`: image2 is the base, image1 is
 * composited over it at `opacity`, resized to match the base. Either side may
 * be missing — the other passes through unchanged, same as the backend. */
export function drawSimpleCombine(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  images: LoadedImages,
  opacity: number,
): boolean {
  const overlay = images.image1;
  const base = images.image2;
  if (!overlay && !base) return false;

  if (!base) {
    canvas.width = overlay!.naturalWidth;
    canvas.height = overlay!.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(overlay!, 0, 0);
    return true;
  }

  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

  if (overlay) {
    ctx.globalAlpha = Math.min(1, Math.max(0, opacity));
    ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
  return true;
}

/** Mirrors backend `_execute_compositor`: reuses the modal's own renderer at
 * scale 1, with selection handles and guides off, so the two never drift. */
export function drawCompositor(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  images: LoadedImages,
  width: number,
  height: number,
  layers: Record<string, any>[],
): boolean {
  const w = Math.max(1, Math.min(8192, Math.round(width)));
  const h = Math.max(1, Math.min(8192, Math.round(height)));
  canvas.width = w;
  canvas.height = h;
  drawCompositorLayers(ctx, w, h, 1, layers, images.background ?? null, { showHandles: false });
  return true;
}

/** Mirrors backend `_execute_vignette`, via the same `applyVignetteLayersToRgba`
 * used by the modal's own live canvas. */
export function drawVignette(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  images: LoadedImages,
  layers: VignetteLayerData[],
): boolean {
  const img = images.image;
  if (!img) return false;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  if (layers.length === 0) return true;
  const imageData = ctx.getImageData(0, 0, w, h);
  applyVignetteLayersToRgba(imageData.data, w, h, layers);
  ctx.putImageData(imageData, 0, 0);
  return true;
}

/** Mirrors backend `blur` in `execute_tool_node`. Canvas's CSS-filter blur is
 * a close but not pixel-identical approximation of PIL's `GaussianBlur` — a
 * genuine run may render very slightly differently. */
export function drawBlur(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  images: LoadedImages,
  radius: number,
): boolean {
  const img = images.image;
  if (!img) return false;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const r = Math.max(0, Number(radius) || 0);
  ctx.filter = r > 0 ? `blur(${r}px)` : 'none';
  ctx.drawImage(img, 0, 0);
  ctx.filter = 'none';
  return true;
}
