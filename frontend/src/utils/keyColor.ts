/**
 * Client-side chroma-key preview. Mirrors the backend implementation in
 * `backend/nodes/tool_nodes.py::_execute_key_color` so the modal and the node
 * thumbnail can update in real time without a backend round-trip. The actual
 * workflow run on the backend is the source of truth — these helpers are for
 * UI feedback only.
 */

export interface KeyColorSettings {
  keyColor: string;
  threshold: number; // 0..1
  softness: number; // 0..1
}

const NORM = Math.sqrt(3) * 255;

export function parseHex(hex: string): [number, number, number] {
  let s = (hex || '#00ff00').trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length < 6) return [0, 255, 0];
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0, 255, 0];
  return [r, g, b];
}

/** Mutate `targetPx` (RGBA bytes) in place by applying the chroma key + manual mask. */
export function applyKeyColor(
  targetPx: Uint8ClampedArray,
  manualPx: Uint8ClampedArray | null,
  settings: KeyColorSettings,
): void {
  const [kr, kg, kb] = parseHex(settings.keyColor);
  const t = Math.max(0, Math.min(1, settings.threshold));
  const s = Math.max(0, Math.min(1, settings.softness));
  const inner = Math.max(0, t - s * 0.5);
  let outer = Math.min(1, t + s * 0.5);
  if (outer <= inner) outer = inner + 1e-6;
  const denom = outer - inner;

  const len = targetPx.length;
  for (let i = 0; i < len; i += 4) {
    const dr = targetPx[i] - kr;
    const dg = targetPx[i + 1] - kg;
    const db = targetPx[i + 2] - kb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db) / NORM;
    let keep: number;
    if (dist <= inner) keep = 0;
    else if (dist >= outer) keep = 1;
    else keep = (dist - inner) / denom;
    let a = targetPx[i + 3] * keep;

    if (manualPx) {
      const v = manualPx[i]; // grayscale in R channel
      if (v >= 250) a = 255;
      else if (v <= 5) a = 0;
      else {
        const delta = v - 128;
        if (delta > 8) a = Math.max(a, Math.min(255, delta * 2));
        else if (delta < -8) a = Math.min(a, Math.max(0, 255 + delta * 2));
      }
    }
    targetPx[i + 3] = a;
  }
}

/**
 * Render a chroma-keyed preview into `target` at the source image's native
 * resolution. The caller is expected to size `target.width/height` to
 * `srcImg.naturalWidth/Height` (or smaller; we won't resize for them).
 *
 * Returns true if it painted something, false if the source was empty.
 */
export function renderKeyColorPreview(
  target: HTMLCanvasElement,
  srcImg: HTMLImageElement,
  settings: KeyColorSettings,
  manualMaskCanvas: HTMLCanvasElement | null,
): boolean {
  const w = target.width;
  const h = target.height;
  if (w <= 0 || h <= 0 || !srcImg.naturalWidth) return false;
  const ctx = target.getContext('2d');
  if (!ctx) return false;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(srcImg, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);

  let manualPx: Uint8ClampedArray | null = null;
  if (manualMaskCanvas && manualMaskCanvas.width > 0 && manualMaskCanvas.height > 0) {
    if (manualMaskCanvas.width === w && manualMaskCanvas.height === h) {
      const mctx = manualMaskCanvas.getContext('2d');
      if (mctx) manualPx = mctx.getImageData(0, 0, w, h).data;
    } else {
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext('2d');
      if (tctx) {
        tctx.drawImage(manualMaskCanvas, 0, 0, w, h);
        manualPx = tctx.getImageData(0, 0, w, h).data;
      }
    }
  }

  applyKeyColor(id.data, manualPx, settings);
  ctx.putImageData(id, 0, 0);
  return true;
}

