/** Shared compositor defaults — keep draw math aligned with backend tool_nodes._execute_compositor */

export const COMPOSITOR_GREY = '#9a9aa0';

export function newCompositorLayerId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `l-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createCompositorLayer(kind: string, cw: number, ch: number): Record<string, any> {
  const id = newCompositorLayerId();
  const cx = Math.round(cw / 2);
  const cy = Math.round(ch / 2);
  const base = { id, kind, color: '#6366f1' };
  switch (kind) {
    case 'line':
      return {
        ...base,
        x1: Math.round(cw * 0.1),
        y1: Math.round(ch * 0.1),
        x2: Math.round(cw * 0.4),
        y2: Math.round(ch * 0.35),
        strokeWidth: 3,
      };
    case 'circle':
      return { ...base, cx, cy, r: Math.max(8, Math.round(Math.min(cw, ch) * 0.08)) };
    case 'square': {
      const side = Math.max(8, Math.round(Math.min(cw, ch) * 0.15));
      return {
        ...base,
        x: cx - Math.floor(side / 2),
        y: cy - Math.floor(side / 2),
        w: side,
        h: side,
        rotation: 0,
      };
    }
    case 'triangle':
      return {
        ...base,
        x1: cx,
        y1: Math.round(ch * 0.2),
        x2: Math.round(cx - cw * 0.15),
        y2: Math.round(ch * 0.55),
        x3: Math.round(cx + cw * 0.15),
        y3: Math.round(ch * 0.55),
      };
    case 'text':
      return { ...base, x: 16, y: 24, text: 'Text', fontSize: 24, rotation: 0 };
    default:
      return { ...base, kind: 'circle', cx, cy, r: 40 };
  }
}

export function distPointSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

export function pointInTriangle(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): boolean {
  const sign = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = sign(px, py, x1, y1, x2, y2);
  const d2 = sign(px, py, x2, y2, x3, y3);
  const d3 = sign(px, py, x3, y3, x1, y1);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Point-in-rotated-rect; rotation in degrees, CW (canvas convention). */
export function pointInRotatedSquare(
  px: number,
  py: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rotationDeg: number,
): boolean {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

export function squareCornersWorld(x: number, y: number, w: number, h: number, rotationDeg: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const hw = w / 2;
  const hh = h / 2;
  const local = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return local.map(([lx, ly]) => {
    const wx = cx + lx * Math.cos(rad) + ly * Math.sin(rad);
    const wy = cy - lx * Math.sin(rad) + ly * Math.cos(rad);
    return { x: wx, y: wy };
  });
}

/** World position of rotate handle: local top-mid + 28px along local -Y (same as draw in rotated local space). */
export function squareRotateHandleWorld(x: number, y: number, w: number, h: number, rotationDeg: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotationDeg * Math.PI) / 180;
  const hh = h / 2;
  const ly = -(hh + 28);
  return {
    x: cx + ly * Math.sin(rad),
    y: cy + ly * Math.cos(rad),
  };
}

/** Composition overlays for the compositor canvas (modal preview only; not baked into export). */
export type CompositorGuideOptions = {
  ruleOfThirds?: boolean;
  grid2080?: boolean;
  cross?: boolean;
  goldenRatio?: boolean;
};

const PHI = (1 + Math.sqrt(5)) / 2;

/** Draw composition guides in canvas pixel space (after world×scale). */
export function drawCompositorGuides(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  s: number,
  guides: CompositorGuideOptions,
) {
  const anyOn =
    guides.ruleOfThirds || guides.grid2080 || guides.cross || guides.goldenRatio;
  if (!anyOn) return;

  const stroke = (fn: () => void) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.max(1, s * 0.35);
    ctx.setLineDash([4 * s, 3 * s]);
    fn();
    ctx.restore();
  };

  const lineW = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1 * s, y1 * s);
    ctx.lineTo(x2 * s, y2 * s);
    ctx.stroke();
  };

  if (guides.ruleOfThirds) {
    stroke(() => {
      const x1 = cw / 3,
        x2 = (2 * cw) / 3;
      const y1 = ch / 3,
        y2 = (2 * ch) / 3;
      lineW(x1, 0, x1, ch);
      lineW(x2, 0, x2, ch);
      lineW(0, y1, cw, y1);
      lineW(0, y2, cw, y2);
    });
  }

  if (guides.grid2080) {
    stroke(() => {
      lineW(cw * 0.2, 0, cw * 0.2, ch);
      lineW(cw * 0.8, 0, cw * 0.8, ch);
      lineW(0, ch * 0.2, cw, ch * 0.2);
      lineW(0, ch * 0.8, cw, ch * 0.8);
    });
  }

  if (guides.cross) {
    stroke(() => {
      lineW(0, 0, cw, ch);
      lineW(cw, 0, 0, ch);
    });
  }

  if (guides.goldenRatio) {
    stroke(() => {
      const gx1 = cw / PHI ** 2;
      const gx2 = cw - gx1;
      const gy1 = ch / PHI ** 2;
      const gy2 = ch - gy1;
      lineW(gx1, 0, gx1, ch);
      lineW(gx2, 0, gx2, ch);
      lineW(0, gy1, cw, gy1);
      lineW(0, gy2, cw, gy2);
    });
  }
}

export function drawCompositorLayers(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  s: number,
  layers: Record<string, any>[],
  bgImg: HTMLImageElement | null,
  options?: {
    selectedIndex?: number | null;
    showHandles?: boolean;
    guides?: CompositorGuideOptions;
  },
) {
  const vw = Math.round(cw * s);
  const vh = Math.round(ch * s);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, vw, vh);

  if (bgImg && bgImg.complete && bgImg.naturalWidth > 0) {
    ctx.drawImage(bgImg, 0, 0, vw, vh);
  } else {
    ctx.fillStyle = COMPOSITOR_GREY;
    ctx.fillRect(0, 0, vw, vh);
  }

  const sel = options?.selectedIndex ?? null;
  const showH = options?.showHandles ?? true;

  layers.forEach((layer, idx) => {
    if (!layer || typeof layer !== 'object') return;
    const kind = String(layer.kind || '').toLowerCase();
    const color = String(layer.color || '#6366f1');
    const isSel = sel === idx;
    ctx.save();
    try {
      if (kind === 'line') {
        const sw = Math.max(1, Number(layer.strokeWidth) || 2) * s;
        ctx.strokeStyle = color;
        ctx.lineWidth = sw;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(Number(layer.x1 || 0) * s, Number(layer.y1 || 0) * s);
        ctx.lineTo(Number(layer.x2 || 0) * s, Number(layer.y2 || 0) * s);
        ctx.stroke();
        if (isSel && showH) {
          drawHandle(ctx, Number(layer.x1 || 0) * s, Number(layer.y1 || 0) * s);
          drawHandle(ctx, Number(layer.x2 || 0) * s, Number(layer.y2 || 0) * s);
        }
      } else if (kind === 'circle') {
        const cx = Number(layer.cx || 0) * s;
        const cy = Number(layer.cy || 0) * s;
        const r = Math.max(0.5, Number(layer.r || 0) * s);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        if (isSel && showH) {
          drawHandle(ctx, cx, cy);
          drawHandle(ctx, cx + r, cy);
        }
      } else if (kind === 'square') {
        const x = Number(layer.x || 0);
        const y = Number(layer.y || 0);
        const w = Math.max(1, Number(layer.w || 0));
        const h = Math.max(1, Number(layer.h || 0));
        const rot = Number(layer.rotation) || 0;
        const cx = (x + w / 2) * s;
        const cy = (y + h / 2) * s;
        const hw = (w / 2) * s;
        const hh = (h / 2) * s;
        const rOff = 28 * s;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.fillStyle = color;
        ctx.fillRect(-hw, -hh, w * s, h * s);
        if (isSel && showH) {
          drawHandle(ctx, -hw, -hh);
          drawHandle(ctx, hw, -hh);
          drawHandle(ctx, hw, hh);
          drawHandle(ctx, -hw, hh);
          ctx.strokeStyle = '#6366f1';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -hh);
          ctx.lineTo(0, -hh - rOff);
          ctx.stroke();
          drawHandle(ctx, 0, -hh - rOff, true);
        }
        ctx.restore();
      } else if (kind === 'triangle') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(Number(layer.x1 || 0) * s, Number(layer.y1 || 0) * s);
        ctx.lineTo(Number(layer.x2 || 0) * s, Number(layer.y2 || 0) * s);
        ctx.lineTo(Number(layer.x3 || 0) * s, Number(layer.y3 || 0) * s);
        ctx.closePath();
        ctx.fill();
        if (isSel && showH) {
          drawHandle(ctx, Number(layer.x1 || 0) * s, Number(layer.y1 || 0) * s);
          drawHandle(ctx, Number(layer.x2 || 0) * s, Number(layer.y2 || 0) * s);
          drawHandle(ctx, Number(layer.x3 || 0) * s, Number(layer.y3 || 0) * s);
        }
      } else if (kind === 'text') {
        const fs = Math.max(8, Math.min(256, Number(layer.fontSize) || 16)) * s;
        const tx = Number(layer.x || 0) * s;
        const ty = Number(layer.y || 0) * s;
        const rot = Number(layer.rotation) || 0;
        const txt = String(layer.text ?? '');
        ctx.font = `${fs}px system-ui, sans-serif`;
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        const tw = ctx.measureText(txt).width;
        const th = fs;
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate((rot * Math.PI) / 180);
        ctx.fillText(txt, 0, 0);
        ctx.restore();
        if (isSel && showH) {
          ctx.save();
          ctx.translate(tx, ty);
          ctx.rotate((rot * Math.PI) / 180);
          const pad = 4 * s;
          drawHandle(ctx, -pad, -pad);
          drawHandle(ctx, tw + pad, th + pad, false, true);
          ctx.restore();
        }
      }
    } finally {
      ctx.restore();
    }
  });

  if (options?.guides) {
    drawCompositorGuides(ctx, cw, ch, s, options.guides);
  }
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rotationStyle = false,
  scaleStyle = false,
) {
  const r = rotationStyle ? 5 : 6;
  ctx.beginPath();
  ctx.fillStyle = scaleStyle ? '#f59e0b' : '#fff';
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 1.5;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
