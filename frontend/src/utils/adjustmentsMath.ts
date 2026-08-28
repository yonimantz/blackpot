/** Mirrors backend `tool_nodes._execute_adjustments` for live canvas preview. */

export interface LevelsParams {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export interface AdjustmentsParams {
  hue: number;
  saturation: number;
  value: number;
  levels: LevelsParams;
}

export const DEFAULT_ADJUSTMENTS: AdjustmentsParams = {
  hue: 0,
  saturation: 0,
  value: 0,
  levels: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
};

const GAMMA_MIN = 0.1;
const GAMMA_MAX = 10;

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** JS `%` keeps the sign of the dividend; this always lands in [0, 1). */
function mod1(n: number): number {
  const m = n % 1;
  return m < 0 ? m + 1 : m;
}

/**
 * Fill gaps and clamp values loaded from a saved graph. Hue is clamped, not
 * wrapped — only the shift inside `applyAdjustmentsToRgba` wraps.
 * Nothing is rounded to integers; the levels LUT handles fractional endpoints.
 */
export function normalizeAdjustments(raw: unknown): AdjustmentsParams {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const lv = (src.levels && typeof src.levels === 'object' ? src.levels : {}) as Record<string, unknown>;
  const d = DEFAULT_ADJUSTMENTS;
  return {
    hue: clamp(num(src.hue, d.hue), -180, 180),
    saturation: clamp(num(src.saturation, d.saturation), -100, 100),
    value: clamp(num(src.value, d.value), -100, 100),
    levels: {
      inBlack: clamp(num(lv.inBlack, d.levels.inBlack), 0, 255),
      inWhite: clamp(num(lv.inWhite, d.levels.inWhite), 0, 255),
      gamma: clamp(num(lv.gamma, d.levels.gamma), GAMMA_MIN, GAMMA_MAX),
      outBlack: clamp(num(lv.outBlack, d.levels.outBlack), 0, 255),
      outWhite: clamp(num(lv.outWhite, d.levels.outWhite), 0, 255),
    },
  };
}

function isIdentityLevels(l: LevelsParams): boolean {
  return l.inBlack === 0 && l.inWhite === 255 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 255;
}

/** True when the node would return its input unchanged, so callers can skip work. */
export function isIdentity(params: AdjustmentsParams): boolean {
  return params.hue === 0 && params.saturation === 0 && params.value === 0 && isIdentityLevels(params.levels);
}

/**
 * 256-entry input byte -> output byte map, so a slider drag doesn't call
 * `Math.pow` once per pixel. Returns null when levels are a no-op.
 */
function buildLevelsLut(l: LevelsParams): Uint8Array | null {
  if (isIdentityLevels(l)) return null;

  const inBlack = l.inBlack;
  const inWhite = l.inWhite;
  const outBlack = l.outBlack;
  const outWhite = l.outWhite;
  const span = inWhite - inBlack;
  // gamma <= 0 would make the exponent infinite; fall back to linear.
  const exponent = l.gamma > 0 ? 1 / l.gamma : 1;

  const lut = new Uint8Array(256);
  for (let c = 0; c < 256; c++) {
    // Degenerate input range collapses to a hard threshold at inBlack.
    let t = span > 0 ? clamp((c - inBlack) / span, 0, 1) : c <= inBlack ? 0 : 1;
    if (exponent !== 1) t = Math.pow(t, exponent);
    lut[c] = clamp(Math.round(outBlack + t * (outWhite - outBlack)), 0, 255);
  }
  return lut;
}

/**
 * Apply HSV shift then Levels to an RGBA buffer (mutates in place, alpha untouched).
 *
 * HARD CONTRACT with the backend: the order is HSV first, then Levels, and the
 * HSV result is rounded back to 8 bits before the levels LUT indexes it.
 * Swapping the stages or keeping float precision between them produces a
 * visibly different image and the run output will stop matching this preview.
 */
export function applyAdjustmentsToRgba(pixels: Uint8ClampedArray, params: AdjustmentsParams): void {
  if (isIdentity(params)) return;

  const doHsv = params.hue !== 0 || params.saturation !== 0 || params.value !== 0;
  const lut = buildLevelsLut(params.levels);
  if (!doHsv && !lut) return;

  const hueShift = params.hue / 360;
  const satScale = 1 + params.saturation / 100;
  const valScale = 1 + params.value / 100;

  for (let o = 0; o + 3 < pixels.length; o += 4) {
    let r = pixels[o]!;
    let g = pixels[o + 1]!;
    let b = pixels[o + 2]!;

    if (doHsv) {
      const rf = r / 255;
      const gf = g / 255;
      const bf = b / 255;

      // rgb -> hsv, matching Python `colorsys.rgb_to_hsv`.
      const maxc = Math.max(rf, gf, bf);
      const minc = Math.min(rf, gf, bf);
      const range = maxc - minc;
      let h = 0;
      let s = 0;
      let v = maxc;
      if (range !== 0) {
        s = range / maxc;
        const rc = (maxc - rf) / range;
        const gc = (maxc - gf) / range;
        const bc = (maxc - bf) / range;
        if (rf === maxc) h = bc - gc;
        else if (gf === maxc) h = 2 + rc - bc;
        else h = 4 + gc - rc;
        h = mod1(h / 6);
      }

      h = mod1(h + hueShift);
      s = clamp(s * satScale, 0, 1);
      v = clamp(v * valScale, 0, 1);

      // hsv -> rgb, matching Python `colorsys.hsv_to_rgb`.
      let nr: number;
      let ng: number;
      let nb: number;
      if (s === 0) {
        nr = v;
        ng = v;
        nb = v;
      } else {
        const h6 = h * 6;
        const i = Math.floor(h6) % 6;
        const f = h6 - Math.floor(h6);
        const p = v * (1 - s);
        const q = v * (1 - s * f);
        const t = v * (1 - s * (1 - f));
        if (i === 0) { nr = v; ng = t; nb = p; }
        else if (i === 1) { nr = q; ng = v; nb = p; }
        else if (i === 2) { nr = p; ng = v; nb = t; }
        else if (i === 3) { nr = p; ng = q; nb = v; }
        else if (i === 4) { nr = t; ng = p; nb = v; }
        else { nr = v; ng = p; nb = q; }
      }

      r = clamp(Math.round(nr * 255), 0, 255);
      g = clamp(Math.round(ng * 255), 0, 255);
      b = clamp(Math.round(nb * 255), 0, 255);
    }

    if (lut) {
      r = lut[r]!;
      g = lut[g]!;
      b = lut[b]!;
    }

    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
  }
}
