/** Mirrors backend `tool_nodes._execute_vignette` for live canvas preview. */

export type VignetteShape = 'circle' | 'square';
export type VignetteBlendMode = 'normal' | 'multiply' | 'screen';

export interface VignetteLayerData {
  id: string;
  shape: VignetteShape;
  color: string;
  opacity: number;
  blendMode: VignetteBlendMode;
  size: number;
  feather: number;
}

function parseHexColor(s: string): { r: number; g: number; b: number } {
  let raw = (s || '#000000').trim();
  if (raw.startsWith('#')) raw = raw.slice(1);
  if (raw.length === 3) {
    raw = raw
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (raw.length >= 6) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return { r, g, b };
    }
  }
  return { r: 0, g: 0, b: 0 };
}

function normDistCircle(w: number, h: number, out: Float32Array): void {
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const halfW = Math.max(w * 0.5, 1e-6);
  const halfH = Math.max(h * 0.5, 1e-6);
  const invSqrt2 = 1 / Math.sqrt(2);
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / halfW;
      const dy = (y - cy) / halfH;
      const d = Math.sqrt(dx * dx + dy * dy) * invSqrt2;
      out[i++] = Math.min(1, Math.max(0, d));
    }
  }
}

function normDistSquare(w: number, h: number, out: Float32Array): void {
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const halfW = Math.max(w * 0.5, 1e-6);
  const halfH = Math.max(h * 0.5, 1e-6);
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.max(Math.abs(x - cx) / halfW, Math.abs(y - cy) / halfH);
      out[i++] = Math.min(1, Math.max(0, d));
    }
  }
}

/**
 * Apply vignette layers in order to RGBA pixel buffer (mutates copy).
 */
export function applyVignetteLayersToRgba(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  layers: VignetteLayerData[],
): void {
  if (!layers.length || w <= 0 || h <= 0) return;

  const n = w * h;
  const dCircle = new Float32Array(n);
  const dSquare = new Float32Array(n);
  normDistCircle(w, h, dCircle);
  normDistSquare(w, h, dSquare);

  for (const layer of layers) {
    const shape = layer.shape === 'square' ? 'square' : 'circle';
    const d = shape === 'square' ? dSquare : dCircle;

    const size = Math.min(1, Math.max(0, Number(layer.size) || 0));
    const feather = Math.min(1, Math.max(0, Number(layer.feather) || 0));
    const opacity = Math.min(1, Math.max(0, Number(layer.opacity) || 0));
    const { r: cr, g: cg, b: cb } = parseHexColor(layer.color);
    const blendMode = layer.blendMode === 'multiply' || layer.blendMode === 'screen' ? layer.blendMode : 'normal';

    const clearR = (1.0 - size) * 0.92;
    const denom = Math.max(1e-6, 1.0 - clearR);
    const power = 1.0 / (0.25 + feather * 3.5);

    for (let i = 0; i < n; i++) {
      const di = d[i]!;
      let raw = (di - clearR) / denom;
      if (raw < 0) raw = 0;
      else if (raw > 1) raw = 1;
      const m = Math.pow(raw, power);
      const am = m * opacity;
      if (am <= 0) continue;

      const o = i * 4;
      let br = pixels[o]!;
      let bg_ = pixels[o + 1]!;
      let bb = pixels[o + 2]!;

      if (blendMode === 'multiply') {
        const mr = (br / 255) * (cr / 255) * 255;
        const mg = (bg_ / 255) * (cg / 255) * 255;
        const mb = (bb / 255) * (cb / 255) * 255;
        br = br * (1 - am) + mr * am;
        bg_ = bg_ * (1 - am) + mg * am;
        bb = bb * (1 - am) + mb * am;
      } else if (blendMode === 'screen') {
        const sr = 255 - ((255 - br) * (255 - cr)) / 255;
        const sg = 255 - ((255 - bg_) * (255 - cg)) / 255;
        const sb = 255 - ((255 - bb) * (255 - cb)) / 255;
        br = br * (1 - am) + sr * am;
        bg_ = bg_ * (1 - am) + sg * am;
        bb = bb * (1 - am) + sb * am;
      } else {
        br = br * (1 - am) + cr * am;
        bg_ = bg_ * (1 - am) + cg * am;
        bb = bb * (1 - am) + cb * am;
      }

      pixels[o] = Math.min(255, Math.max(0, Math.round(br)));
      pixels[o + 1] = Math.min(255, Math.max(0, Math.round(bg_)));
      pixels[o + 2] = Math.min(255, Math.max(0, Math.round(bb)));
    }
  }
}

export function newVignetteLayerId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `vig-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `vig-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultVignetteLayer(): VignetteLayerData {
  return {
    id: newVignetteLayerId(),
    shape: 'circle',
    color: '#000000',
    opacity: 0.5,
    blendMode: 'normal',
    size: 0.5,
    feather: 0.5,
  };
}
