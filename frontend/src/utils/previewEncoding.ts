/**
 * Shared encoder for on-node / live preview thumbnails.
 *
 * These previews are UI feedback only — the backend recomputes the real output
 * on every workflow run, so we can safely cap their resolution and use a
 * compact, alpha-capable codec (WebP) instead of full-resolution PNG. This
 * keeps the strings small in memory and (combined with Phase 1's save
 * stripping) keeps selection / autosave cheap.
 *
 * WebP is used because it preserves transparency (Editor `bgHidden`, Key Color,
 * Remove BG all produce alpha) while being far smaller than PNG. We fall back
 * to PNG if a browser/canvas rejects the WebP request.
 */
export const PREVIEW_BACKBUFFER_MAX = 512;
export const PREVIEW_WEBP_QUALITY = 0.8;

/**
 * Encode a canvas to a compact preview data URL, downscaling so the longest
 * edge never exceeds `maxEdge`. The source canvas is left untouched.
 */
export function encodeCanvasPreview(
  source: HTMLCanvasElement,
  maxEdge: number = PREVIEW_BACKBUFFER_MAX,
): string {
  const w = source.width;
  const h = source.height;
  const longest = Math.max(w, h);

  let canvas = source;
  if (longest > maxEdge && longest > 0) {
    const scale = maxEdge / longest;
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const scaled = document.createElement('canvas');
    scaled.width = cw;
    scaled.height = ch;
    const ctx = scaled.getContext('2d');
    if (ctx) {
      ctx.drawImage(source, 0, 0, cw, ch);
      canvas = scaled;
    }
  }

  try {
    return canvas.toDataURL('image/webp', PREVIEW_WEBP_QUALITY);
  } catch {
    return canvas.toDataURL('image/png');
  }
}
