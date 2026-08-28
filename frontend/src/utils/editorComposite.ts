/**
 * Shared composite logic for the Editor tool. Used by both the interactive
 * modal preview (`EditorCanvasPreview`) and the headless node-thumbnail bake
 * (`editorBake`) so the two renderers can never draw different pixels.
 */

export interface EditorLayerCfg {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  flipH?: boolean;
  opacity?: number;
  hidden?: boolean;
}

export interface ResolvedLayerBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipH: boolean;
  opacity: number;
}

/** Largest size that fits fully inside `bgW x bgH` while preserving `img`'s aspect ratio. */
function containFitSize(imgW: number, imgH: number, bgW: number, bgH: number) {
  const fitS = Math.min(bgW / imgW, bgH / imgH);
  return { width: Math.round(imgW * fitS), height: Math.round(imgH * fitS) };
}

/**
 * Resolves a layer's config against its loaded image into concrete pixel
 * values. When `width`/`height` are unset (0), the layer is treated as
 * "contain fit" against the BG — centered, scaled to fit fully inside.
 */
export function resolveLayerBox(
  cfg: EditorLayerCfg,
  img: { naturalWidth: number; naturalHeight: number },
  bgW: number,
  bgH: number,
): ResolvedLayerBox {
  const hasSize = (cfg.width ?? 0) > 0 || (cfg.height ?? 0) > 0;
  let w: number;
  let h: number;
  let x: number;
  let y: number;
  if (hasSize) {
    w = (cfg.width ?? 0) > 0 ? (cfg.width as number) : img.naturalWidth;
    h = (cfg.height ?? 0) > 0 ? (cfg.height as number) : img.naturalHeight;
    x = cfg.x ?? 0;
    y = cfg.y ?? 0;
  } else {
    const fit = containFitSize(img.naturalWidth, img.naturalHeight, bgW, bgH);
    w = fit.width;
    h = fit.height;
    x = cfg.x || bgW / 2;
    y = cfg.y || bgH / 2;
  }
  return {
    x,
    y,
    w,
    h,
    rotation: cfg.rotation || 0,
    flipH: Boolean(cfg.flipH),
    opacity: Math.max(0, Math.min(1, Number(cfg.opacity ?? 1))),
  };
}

/**
 * Returns a new layer config scaled/positioned to fit fully inside the BG
 * (contain fit, centered). Rotation, flip and opacity are preserved.
 * Used both for auto-fit-on-connect and the manual "Fit to BG" action, so
 * they can never drift apart.
 */
export function fitLayerToBg(
  cfg: EditorLayerCfg,
  img: { naturalWidth: number; naturalHeight: number },
  bgW: number,
  bgH: number,
): EditorLayerCfg {
  const { width, height } = containFitSize(img.naturalWidth, img.naturalHeight, bgW, bgH);
  return {
    ...cfg,
    width,
    height,
    x: Math.round(bgW / 2),
    y: Math.round(bgH / 2),
  };
}

/**
 * Restores the layer to the source image's own pixel size, which by definition
 * also restores its original aspect ratio (undoing any stretching). Position,
 * rotation, flip and opacity are left alone.
 */
export function resetLayerToOriginalSize(
  cfg: EditorLayerCfg,
  img: { naturalWidth: number; naturalHeight: number },
): EditorLayerCfg {
  return {
    ...cfg,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
}

export interface DrawEditorCompositeOptions {
  bgImg: HTMLImageElement | HTMLCanvasElement | null;
  bgW: number;
  bgH: number;
  bgHidden: boolean;
  layerCount: number;
  layers: Record<string, EditorLayerCfg>;
  images: Record<string, { naturalWidth: number; naturalHeight: number } & CanvasImageSource>;
  /** Image-space -> canvas-space uniform scale. */
  scale: number;
  /** Canvas-space offset of the BG frame's top-left corner (the gutter). */
  offsetX: number;
  offsetY: number;
}

/**
 * Draws the BG + all layers into `ctx` using image-space coordinates mapped
 * through `scale`/`offsetX`/`offsetY`.
 *
 * Everything is clipped to the BG frame, exactly like the backend composite:
 * whatever a layer has hanging outside the frame is not part of the output, so
 * it must not be painted here either. In the editor the selection overlay is
 * drawn separately (and unclipped) on top, which is what keeps the transform
 * box usable while the image itself disappears past the frame edge.
 */
export function drawEditorComposite(ctx: CanvasRenderingContext2D, opts: DrawEditorCompositeOptions): void {
  const { bgImg, bgW, bgH, bgHidden, layerCount, layers, images, scale: s, offsetX: ox, offsetY: oy } = opts;

  const frameW = bgW * s;
  const frameH = bgH * s;

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, frameW, frameH);
  ctx.clip();

  if (!bgHidden && bgImg) {
    ctx.drawImage(bgImg, ox, oy, frameW, frameH);
  }

  for (let i = 1; i <= layerCount; i++) {
    const key = `layer${i}`;
    const img = images[key];
    if (!img) continue;
    const cfg = layers[key] || {};
    if (cfg.hidden) continue;
    const box = resolveLayerBox(cfg, img, bgW, bgH);
    const rad = (box.rotation * Math.PI) / 180;
    ctx.save();
    ctx.globalAlpha = box.opacity;
    ctx.translate(ox + box.x * s, oy + box.y * s);
    ctx.rotate(rad);
    if (box.flipH) ctx.scale(-1, 1);
    ctx.drawImage(img, (-box.w * s) / 2, (-box.h * s) / 2, box.w * s, box.h * s);
    ctx.restore();
  }

  ctx.restore();
}

/** Converts an image-space point to canvas-space using the current viewport. */
export function toCanvas(v: number, offset: number, scale: number): number {
  return offset + v * scale;
}

/** Converts a canvas-space point to image-space using the current viewport. */
export function toImage(v: number, offset: number, scale: number): number {
  return (v - offset) / scale;
}
