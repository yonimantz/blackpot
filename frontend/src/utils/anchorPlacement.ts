import type { MingcuteIconName } from '../icons/mingcuteIcons';

/**
 * Anchor placement math shared by the Resize and Crop nodes.
 *
 * An anchor describes where a smaller box sits inside a larger one:
 *  - Resize (fit / canvas mode): the source image inside the target frame.
 *  - Crop: the crop rectangle inside the source image.
 *
 * Keep in sync with `_anchor_origin` / `_resolve_*` in backend
 * `nodes/tool_nodes.py` — the live previews here must match what a run bakes.
 */

export type AnchorPosition =
  | 'topLeft'
  | 'top'
  | 'topRight'
  | 'left'
  | 'center'
  | 'right'
  | 'bottomLeft'
  | 'bottom'
  | 'bottomRight';

/** Crop can also be positioned freely by dragging in the crop editor. */
export type CropAnchor = AnchorPosition | 'free';

/** How the Resize node maps the source image onto the target W×H frame. */
export type ResizeMode = 'stretch' | 'fit' | 'canvas';

export const ANCHOR_ROWS: readonly (readonly AnchorPosition[])[] = [
  ['topLeft', 'top', 'topRight'],
  ['left', 'center', 'right'],
  ['bottomLeft', 'bottom', 'bottomRight'],
] as const;

export const ANCHOR_LABELS: Record<AnchorPosition, string> = {
  topLeft: 'Top left',
  top: 'Top center',
  topRight: 'Top right',
  left: 'Middle left',
  center: 'Center',
  right: 'Middle right',
  bottomLeft: 'Bottom left',
  bottom: 'Bottom center',
  bottomRight: 'Bottom right',
};

export const ANCHOR_ICONS: Record<AnchorPosition, MingcuteIconName> = {
  topLeft: 'arrow-left-up-line',
  top: 'arrow-up-line',
  topRight: 'arrow-right-up-line',
  left: 'arrow-left-line',
  center: 'dot-circle-line',
  right: 'arrow-right-line',
  bottomLeft: 'arrow-left-down-line',
  bottom: 'arrow-down-line',
  bottomRight: 'arrow-right-down-line',
};

/** Fraction of the free space that goes before the inner box, per axis. */
const ANCHOR_FRACTION_X: Record<AnchorPosition, number> = {
  topLeft: 0,
  left: 0,
  bottomLeft: 0,
  top: 0.5,
  center: 0.5,
  bottom: 0.5,
  topRight: 1,
  right: 1,
  bottomRight: 1,
};

const ANCHOR_FRACTION_Y: Record<AnchorPosition, number> = {
  topLeft: 0,
  top: 0,
  topRight: 0,
  left: 0.5,
  center: 0.5,
  right: 0.5,
  bottomLeft: 1,
  bottom: 1,
  bottomRight: 1,
};

const ALL_ANCHORS = new Set<string>(Object.keys(ANCHOR_LABELS));

export function normalizeAnchor(value: unknown, fallback: AnchorPosition = 'center'): AnchorPosition {
  return typeof value === 'string' && ALL_ANCHORS.has(value) ? (value as AnchorPosition) : fallback;
}

/**
 * Crop anchors fall back to `free` so workflows saved before anchors existed
 * keep using the x/y they were dragged to.
 */
export function normalizeCropAnchor(value: unknown): CropAnchor {
  return typeof value === 'string' && ALL_ANCHORS.has(value) ? (value as AnchorPosition) : 'free';
}

export function normalizeResizeMode(value: unknown): ResizeMode {
  return value === 'fit' || value === 'canvas' ? value : 'stretch';
}

export const RESIZE_MODE_LABELS: Record<ResizeMode, string> = {
  stretch: 'Stretch',
  fit: 'Fit',
  canvas: 'Canvas',
};

export const RESIZE_MODE_HINTS: Record<ResizeMode, string> = {
  stretch: 'Scale the image to exactly W×H, distorting it if the ratio differs.',
  fit: 'Scale the image proportionally to fit inside W×H, then place it at the anchor. Empty area stays transparent.',
  canvas: 'Keep the pixels at their original size and change the frame to W×H — crops when smaller, pads transparently when larger.',
};

/** Whether the anchor and offset controls do anything in this resize mode. */
export function resizeModeUsesAnchor(mode: ResizeMode): boolean {
  return mode !== 'stretch';
}

/** Top-left corner of an `inner` box anchored inside an `outer` box. */
export function resolveAnchorOrigin(
  anchor: AnchorPosition,
  outerW: number,
  outerH: number,
  innerW: number,
  innerH: number,
): { x: number; y: number } {
  return {
    x: Math.round((outerW - innerW) * ANCHOR_FRACTION_X[anchor]),
    y: Math.round((outerH - innerH) * ANCHOR_FRACTION_Y[anchor]),
  };
}

export function readOffset(data: Record<string, any> | undefined): { x: number; y: number } {
  return {
    x: Math.round(Number(data?.offsetX) || 0),
    y: Math.round(Number(data?.offsetY) || 0),
  };
}

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where the source image lands inside the target frame for the given mode.
 * Coordinates may be negative (canvas mode crops) — callers clip as needed.
 */
export function resolveResizePlacement(
  mode: ResizeMode,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  anchor: AnchorPosition,
  offsetX: number,
  offsetY: number,
): Placement {
  const tw = Math.max(1, Math.round(targetW));
  const th = Math.max(1, Math.round(targetH));
  if (mode === 'stretch' || srcW <= 0 || srcH <= 0) {
    return { x: 0, y: 0, w: tw, h: th };
  }

  let w = srcW;
  let h = srcH;
  if (mode === 'fit') {
    const scale = Math.min(tw / srcW, th / srcH);
    w = Math.max(1, Math.round(srcW * scale));
    h = Math.max(1, Math.round(srcH * scale));
  }

  const origin = resolveAnchorOrigin(anchor, tw, th, w, h);
  return { x: origin.x + Math.round(offsetX), y: origin.y + Math.round(offsetY), w, h };
}

/**
 * The crop rectangle in source-image pixels. With a fixed anchor the stored
 * x/y are ignored and re-derived, so the rectangle keeps its position when the
 * size or the source image changes. `free` keeps whatever the user dragged.
 */
export function resolveCropRect(
  data: Record<string, any>,
  srcW: number,
  srcH: number,
): Placement {
  const w = Math.max(1, Math.round(Number(data.width) || 1));
  const h = Math.max(1, Math.round(Number(data.height) || 1));
  const anchor = normalizeCropAnchor(data.anchor);
  const offset = readOffset(data);

  let x = Math.round(Number(data.x) || 0);
  let y = Math.round(Number(data.y) || 0);

  if (srcW > 0 && srcH > 0 && anchor !== 'free') {
    const origin = resolveAnchorOrigin(anchor, srcW, srcH, w, h);
    x = origin.x;
    y = origin.y;
  }

  x += offset.x;
  y += offset.y;

  // Only pull the rectangle back in-bounds when it actually fits; a rectangle
  // larger than the source keeps its anchored position and pads instead.
  if (srcW > 0 && w <= srcW) x = Math.max(0, Math.min(x, srcW - w));
  if (srcH > 0 && h <= srcH) y = Math.max(0, Math.min(y, srcH - h));

  return { x, y, w, h };
}
