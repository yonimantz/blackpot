import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { LevelsParams } from '../utils/adjustmentsMath';

const HIST_WIDTH = 256;
const HIST_HEIGHT = 100;
const DOWNSAMPLE_CAP = 256;

/** Downsample the image into an offscreen canvas and bin luminance into 256 buckets. UI aid only — precision doesn't need to match the backend. */
function computeLuminanceHistogram(img: HTMLImageElement): Uint32Array {
  const bins = new Uint32Array(256);
  const natW = img.naturalWidth || 1;
  const natH = img.naturalHeight || 1;
  const scale = Math.min(1, DOWNSAMPLE_CAP / Math.max(natW, natH));
  const w = Math.max(1, Math.round(natW * scale));
  const h = Math.max(1, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return bins;
  ctx.drawImage(img, 0, 0, w, h);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return bins;
  }
  for (let o = 0; o + 3 < pixels.length; o += 4) {
    const lum = 0.299 * pixels[o]! + 0.587 * pixels[o + 1]! + 0.114 * pixels[o + 2]!;
    const bucket = Math.min(255, Math.max(0, Math.round(lum)));
    bins[bucket]!++;
  }
  return bins;
}

/**
 * Simple percentile-clip autolevel: finds the ~0.5th/99.5th percentile
 * luminance values from the histogram. Not a rigorous algorithm — a
 * reasonable default for the Auto button, nothing more.
 */
export function computeAutoLevels(img: HTMLImageElement | null): { inBlack: number; inWhite: number } | null {
  if (!img || !img.naturalWidth) return null;
  const bins = computeLuminanceHistogram(img);
  let total = 0;
  for (let i = 0; i < 256; i++) total += bins[i]!;
  if (total === 0) return null;

  const lowCut = total * 0.005;
  const highCut = total * 0.005;

  let acc = 0;
  let inBlack = 0;
  for (let i = 0; i < 256; i++) {
    acc += bins[i]!;
    if (acc >= lowCut) {
      inBlack = i;
      break;
    }
  }

  acc = 0;
  let inWhite = 255;
  for (let i = 255; i >= 0; i--) {
    acc += bins[i]!;
    if (acc >= highCut) {
      inWhite = i;
      break;
    }
  }

  if (inWhite <= inBlack) return { inBlack: 0, inWhite: 255 };
  return { inBlack, inWhite };
}

type DragTarget = 'black' | 'white' | 'gamma';

export default function AdjustmentsHistogram({
  baseImg,
  levels,
  onChange,
  disabled,
}: {
  baseImg: HTMLImageElement | null;
  levels: LevelsParams;
  onChange: (patch: Partial<LevelsParams>) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<DragTarget | null>(null);

  const bins = useMemo(() => (baseImg ? computeLuminanceHistogram(baseImg) : null), [baseImg]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = HIST_WIDTH;
    canvas.height = HIST_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, HIST_WIDTH, HIST_HEIGHT);
    if (bins) {
      let max = 1;
      for (let i = 0; i < 256; i++) max = Math.max(max, bins[i]!);
      ctx.fillStyle = '#a1a1aa';
      for (let i = 0; i < 256; i++) {
        const v = bins[i]!;
        if (v === 0) continue;
        // log scale so a dominant bucket doesn't flatten the rest of the histogram.
        const h = Math.max(1, Math.round((Math.log(1 + v) / Math.log(1 + max)) * (HIST_HEIGHT - 4)));
        ctx.fillRect(i, HIST_HEIGHT - h, 1, h);
      }
    }
  }, [bins]);

  const blackPct = (Math.max(0, Math.min(255, levels.inBlack)) / 255) * 100;
  const whitePct = (Math.max(0, Math.min(255, levels.inWhite)) / 255) * 100;
  const gammaPct = useMemo(() => {
    const span = levels.inWhite - levels.inBlack;
    if (span <= 0) return blackPct;
    const g = levels.gamma > 0 ? levels.gamma : 1;
    const mid = levels.inBlack + span * Math.pow(0.5, 1 / g);
    return (Math.max(0, Math.min(255, mid)) / 255) * 100;
  }, [levels.inBlack, levels.inWhite, levels.gamma, blackPct]);

  const valueFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const t = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.round(Math.min(1, Math.max(0, t)) * 255);
  };

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: globalThis.PointerEvent) => {
      const val = valueFromClientX(e.clientX);
      if (dragging === 'black') {
        onChange({ inBlack: Math.min(val, levels.inWhite - 1) });
      } else if (dragging === 'white') {
        onChange({ inWhite: Math.max(val, levels.inBlack + 1) });
      } else if (dragging === 'gamma') {
        const lo = levels.inBlack;
        const hi = levels.inWhite;
        const span = hi - lo;
        if (span > 0) {
          const t = Math.min(0.98, Math.max(0.02, (val - lo) / span));
          // invert mid = lo + span * 0.5 ** (1/gamma) for gamma.
          const gamma = Math.log(0.5) / Math.log(t);
          if (Number.isFinite(gamma)) {
            onChange({ gamma: Math.min(10, Math.max(0.1, gamma)) });
          }
        }
      }
    };
    const handleUp = () => setDragging(null);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragging, levels.inBlack, levels.inWhite, onChange]);

  const startDrag = (target: DragTarget) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(target);
  };

  const markerStyle = (pct: number, color: string): CSSProperties => ({
    position: 'absolute',
    top: 0,
    bottom: -8,
    left: `${pct}%`,
    width: 2,
    marginLeft: -1,
    background: color,
    cursor: disabled ? 'default' : 'ew-resize',
    touchAction: 'none',
  });

  const handleKnobStyle = (color: string): CSSProperties => ({
    position: 'absolute',
    bottom: -8,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 9,
    height: 9,
    borderRadius: '50%',
    background: color,
    border: '1px solid #0f0f11',
    pointerEvents: 'none',
  });

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        ref={trackRef}
        style={{
          position: 'relative',
          width: '100%',
          height: HIST_HEIGHT,
          marginBottom: 12,
          userSelect: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', borderRadius: 4 }}
        />
        {!baseImg && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: '#71717a',
              pointerEvents: 'none',
            }}
          >
            Connect an image
          </div>
        )}
        <div style={markerStyle(blackPct, '#e4e4e7')} onPointerDown={startDrag('black')}>
          <div style={handleKnobStyle('#e4e4e7')} />
        </div>
        <div style={markerStyle(gammaPct, '#6366f1')} onPointerDown={startDrag('gamma')}>
          <div style={handleKnobStyle('#6366f1')} />
        </div>
        <div style={markerStyle(whitePct, '#fafafa')} onPointerDown={startDrag('white')}>
          <div style={handleKnobStyle('#fafafa')} />
        </div>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 3,
          background: `linear-gradient(to right, rgb(${levels.outBlack},${levels.outBlack},${levels.outBlack}), rgb(${levels.outWhite},${levels.outWhite},${levels.outWhite}))`,
          border: '1px solid #27272a',
        }}
      />
    </div>
  );
}
