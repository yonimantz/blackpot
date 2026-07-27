import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';
import {
  applyKeyColor,
  type KeyColorSettings,
} from '../utils/keyColor';

type BrushMode = 'keep' | 'remove';
type ToolMode = 'brush' | 'pick';

interface DragState {
  active: boolean;
  lastIx: number;
  lastIy: number;
}

const NEUTRAL_GREY = 128;

function makeNeutralCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = `rgb(${NEUTRAL_GREY},${NEUTRAL_GREY},${NEUTRAL_GREY})`;
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

function clientToDisplay(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  dw: number,
  dh: number,
) {
  const r = canvas.getBoundingClientRect();
  const u = (clientX - r.left) / Math.max(1, r.width);
  const v = (clientY - r.top) / Math.max(1, r.height);
  return { dx: u * dw, dy: v * dh };
}

function displayToImage(dx: number, dy: number, iw: number, ih: number, dw: number, dh: number) {
  return { ix: (dx / dw) * iw, iy: (dy / dh) * ih };
}

function formatAspectRatio(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '—';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  const rw = w / g;
  const rh = h / g;
  if (rw <= 64 && rh <= 64) return `${rw} : ${rh}`;
  return `${(w / h).toFixed(2)} : 1`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => {
    const v = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return v.length === 1 ? '0' + v : v;
  };
  return `#${h(r)}${h(g)}${h(b)}`;
}

export default function KeyColorModal({
  open,
  onClose,
  nodeId,
}: {
  open: boolean;
  onClose: () => void;
  nodeId: string;
}) {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const node = nodes.find((n) => n.id === nodeId);
  const data = node?.data ?? {};

  useEffect(() => {
    if (!open) return;
    if (!node || node.type !== 'keyColor') onClose();
  }, [open, node, onClose]);

  const keyColor = (data.keyColor as string) || '#00ff00';
  const threshold =
    typeof data.threshold === 'number' ? (data.threshold as number) : 0.3;
  const softness =
    typeof data.softness === 'number' ? (data.softness as number) : 0.15;
  const settings: KeyColorSettings = useMemo(
    () => ({ keyColor, threshold, softness }),
    [keyColor, threshold, softness],
  );

  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement | null>(null); // source-res keyed RGBA
  const sourcePxRef = useRef<Uint8ClampedArray | null>(null); // source-res RGBA px
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null); // source-res manual mask
  const dragRef = useRef<DragState>({ active: false, lastIx: 0, lastIy: 0 });
  const cursorRef = useRef<{ dx: number; dy: number } | null>(null);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<ToolMode>('brush');
  const [mode, setMode] = useState<BrushMode>('remove');
  const [brushSize, setBrushSize] = useState<number>(40);
  const [hardness, setHardness] = useState<number>(0.7);
  const [redrawTick, setRedrawTick] = useState(0);

  const update = useCallback(
    (patch: Record<string, any>) => updateNodeData(nodeId, patch),
    [nodeId, updateNodeData],
  );

  const imageSrc = useMemo(
    () => getConnectedImageDataUrl(nodeId, 'image', edges, nodes),
    [nodeId, edges, nodes],
  );

  // Load source image & cache its raw pixels at native resolution.
  useEffect(() => {
    if (!open || !imageSrc) {
      setImg(null);
      sourcePxRef.current = null;
      resultCanvasRef.current = null;
      return;
    }
    const el = new Image();
    el.onload = () => {
      const iw = el.naturalWidth;
      const ih = el.naturalHeight;
      const buf = document.createElement('canvas');
      buf.width = iw;
      buf.height = ih;
      const bctx = buf.getContext('2d');
      if (bctx) {
        bctx.drawImage(el, 0, 0);
        sourcePxRef.current = bctx.getImageData(0, 0, iw, ih).data;
      }
      const result = document.createElement('canvas');
      result.width = iw;
      result.height = ih;
      resultCanvasRef.current = result;
      setImg(el);
      setRedrawTick((t) => t + 1);
    };
    el.onerror = () => setImg(null);
    el.src = imageSrc;
  }, [open, imageSrc]);

  const iw = img?.naturalWidth ?? 0;
  const ih = img?.naturalHeight ?? 0;

  // Init / reload manual mask canvas when image size or stored data changes.
  useEffect(() => {
    if (!open || iw <= 0 || ih <= 0) return;
    const existing = maskCanvasRef.current;
    if (existing && existing.width === iw && existing.height === ih) return;
    const canvas = makeNeutralCanvas(iw, ih);
    const stored = (data.manualMaskData as string) || '';
    if (stored) {
      const el = new Image();
      el.onload = () => {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(el, 0, 0, iw, ih);
        maskCanvasRef.current = canvas;
        setRedrawTick((t) => t + 1);
      };
      el.onerror = () => {
        maskCanvasRef.current = canvas;
        setRedrawTick((t) => t + 1);
      };
      el.src = stored;
    } else {
      maskCanvasRef.current = canvas;
      setRedrawTick((t) => t + 1);
    }
  }, [open, iw, ih, data.manualMaskData]);

  const maxPreviewWidth = Math.min(
    1100,
    Math.max(200, typeof window !== 'undefined' ? window.innerWidth - 380 : 600),
  );
  const maxPreviewHeight = Math.min(
    800,
    typeof window !== 'undefined' ? window.innerHeight - 160 : 520,
  );

  const { dw, dh } = useMemo(() => {
    if (iw <= 0 || ih <= 0) return { dw: 0, dh: 0 };
    const s = Math.min(maxPreviewWidth / iw, maxPreviewHeight / ih, 1);
    return { dw: Math.round(iw * s), dh: Math.round(ih * s) };
  }, [iw, ih, maxPreviewWidth, maxPreviewHeight]);

  // Recompute the source-resolution keyed image whenever inputs change.
  // Persists in `resultCanvasRef`; the visible canvas reads from it during draw().
  const recomputeResult = useCallback(() => {
    const result = resultCanvasRef.current;
    const srcPx = sourcePxRef.current;
    if (!result || !srcPx || iw <= 0 || ih <= 0) return;
    const ctx = result.getContext('2d');
    if (!ctx) return;
    const id = ctx.createImageData(iw, ih);
    id.data.set(srcPx);
    let manualPx: Uint8ClampedArray | null = null;
    const mc = maskCanvasRef.current;
    if (mc && mc.width === iw && mc.height === ih) {
      const mctx = mc.getContext('2d');
      if (mctx) manualPx = mctx.getImageData(0, 0, iw, ih).data;
    }
    applyKeyColor(id.data, manualPx, settings);
    ctx.putImageData(id, 0, 0);
  }, [iw, ih, settings]);

  // Recompute result whenever settings or source change. The visible canvas
  // re-reads from `resultCanvasRef` during draw(), so this gives a live
  // preview inside the modal. The node-card output is only committed on
  // close (see commitBakedImage), not on every adjustment.
  useEffect(() => {
    recomputeResult();
    setRedrawTick((t) => t + 1);
  }, [recomputeResult]);

  const drawCheckerboard = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const size = 12;
    ctx.fillStyle = '#1f1f23';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a3a40';
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        if (((x / size) + (y / size)) % 2 === 0) {
          ctx.fillRect(x, y, size, size);
        }
      }
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas || dw <= 0 || dh <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(dw * dpr);
    canvas.height = Math.round(dh * dpr);
    canvas.style.width = `${dw}px`;
    canvas.style.height = `${dh}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dw, dh);

    if (!img) {
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(0, 0, dw, dh);
      ctx.fillStyle = '#888';
      ctx.font = '14px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        imageSrc ? 'Loading…' : 'Connect an image to the Image input',
        dw / 2,
        dh / 2,
      );
      return;
    }

    drawCheckerboard(ctx, dw, dh);
    const result = resultCanvasRef.current;
    if (result) ctx.drawImage(result, 0, 0, dw, dh);

    // Brush cursor preview ring.
    const cur = cursorRef.current;
    if (cur && iw > 0 && dw > 0 && tool === 'brush') {
      const radDisplay = (brushSize / 2) * (dw / iw);
      ctx.beginPath();
      ctx.arc(cur.dx, cur.dy, radDisplay, 0, Math.PI * 2);
      ctx.strokeStyle = mode === 'keep' ? '#22c55e' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cur.dx, cur.dy, radDisplay, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [img, dw, dh, iw, brushSize, mode, tool, imageSrc, drawCheckerboard, redrawTick]);

  useEffect(() => {
    draw();
  }, [draw]);

  const stamp = useCallback(
    (ix: number, iy: number) => {
      const c = maskCanvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const radius = brushSize / 2;
      const colour = mode === 'keep' ? 255 : 0;
      const alpha = Math.max(0.15, hardness);
      const grad = ctx.createRadialGradient(ix, iy, 0, ix, iy, radius);
      grad.addColorStop(0, `rgba(${colour},${colour},${colour},${alpha})`);
      const plateau = Math.max(0, hardness - 0.1);
      grad.addColorStop(plateau, `rgba(${colour},${colour},${colour},${alpha * 0.85})`);
      grad.addColorStop(1, `rgba(${colour},${colour},${colour},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ix, iy, radius, 0, Math.PI * 2);
      ctx.fill();
    },
    [brushSize, mode, hardness],
  );

  const stampLine = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(1, brushSize / 4);
      const steps = Math.max(1, Math.ceil(dist / step));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        stamp(x0 + dx * t, y0 + dy * t);
      }
    },
    [brushSize, stamp],
  );

  const persistMask = useCallback(() => {
    const c = maskCanvasRef.current;
    if (!c) return;
    const url = c.toDataURL('image/png');
    update({ manualMaskData: url });
  }, [update]);

  const sampleColorAt = useCallback(
    (ix: number, iy: number) => {
      const px = sourcePxRef.current;
      if (!px) return;
      const x = Math.max(0, Math.min(iw - 1, Math.round(ix)));
      const y = Math.max(0, Math.min(ih - 1, Math.round(iy)));
      const i = (y * iw + x) * 4;
      const hex = rgbToHex(px[i], px[i + 1], px[i + 2]);
      update({ keyColor: hex });
    },
    [iw, ih, update],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isRunning || iw <= 0 || ih <= 0) return;
      const canvas = displayCanvasRef.current;
      if (!canvas) return;
      const { dx, dy } = clientToDisplay(e.clientX, e.clientY, canvas, dw, dh);
      const { ix, iy } = displayToImage(dx, dy, iw, ih, dw, dh);

      if (tool === 'pick') {
        sampleColorAt(ix, iy);
        return;
      }

      stamp(ix, iy);
      dragRef.current = { active: true, lastIx: ix, lastIy: iy };
      recomputeResult();
      setRedrawTick((t) => t + 1);
      e.preventDefault();
    },
    [isRunning, iw, ih, dw, dh, tool, sampleColorAt, stamp, recomputeResult],
  );

  useEffect(() => {
    if (!open) return;

    const onMove = (e: MouseEvent) => {
      const canvas = displayCanvasRef.current;
      if (!canvas || iw <= 0 || ih <= 0) return;
      const { dx, dy } = clientToDisplay(e.clientX, e.clientY, canvas, dw, dh);
      cursorRef.current = { dx, dy };

      const d = dragRef.current;
      if (d.active) {
        const { ix, iy } = displayToImage(dx, dy, iw, ih, dw, dh);
        stampLine(d.lastIx, d.lastIy, ix, iy);
        dragRef.current = { active: true, lastIx: ix, lastIy: iy };
        recomputeResult();
      }
      setRedrawTick((t) => t + 1);
    };

    const onUp = () => {
      if (dragRef.current.active) {
        dragRef.current = { active: false, lastIx: 0, lastIy: 0 };
        persistMask();
      }
    };

    const onLeave = () => {
      cursorRef.current = null;
      setRedrawTick((t) => t + 1);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    const c = displayCanvasRef.current;
    c?.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      c?.removeEventListener('mouseleave', onLeave);
    };
  }, [open, iw, ih, dw, dh, stampLine, persistMask, recomputeResult]);

  const resetStrokes = useCallback(() => {
    if (iw > 0 && ih > 0) {
      maskCanvasRef.current = makeNeutralCanvas(iw, ih);
    } else {
      maskCanvasRef.current = null;
    }
    update({ manualMaskData: '' });
    recomputeResult();
    setRedrawTick((t) => t + 1);
  }, [iw, ih, update, recomputeResult]);

  // Bake the source-resolution keyed RGBA into _keyColorBaked, which the
  // backend hands back verbatim as the node's output. Returns true when a
  // bake actually happened so the Apply button can confirm.
  const commitBakedImage = useCallback((): boolean => {
    const result = resultCanvasRef.current;
    if (!result || !img || iw <= 0 || ih <= 0) return false;
    // Force a final pass so the bake reflects the latest settings even if
    // the user changed sliders between the last redraw and clicking Apply.
    recomputeResult();
    try {
      const url = result.toDataURL('image/png');
      if (!url || !url.startsWith('data:image/')) return false;
      updateNodeData(nodeId, { _keyColorBaked: url });
      return true;
    } catch {
      // Tainted canvas (foreign-origin source) — bake would silently fail.
      return false;
    }
  }, [img, iw, ih, nodeId, recomputeResult, updateNodeData]);

  const handleApply = useCallback(() => {
    const ok = commitBakedImage();
    if (!ok) {
      alert(
        'Could not bake the keyed image. Connect an image to the Image input first, then try again.',
      );
      return;
    }
    onClose();
  }, [commitBakedImage, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open || !node || node.type !== 'keyColor') return null;

  return (
    <div
      className="compositor-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div className="compositor-modal" role="dialog" aria-labelledby="keycolor-modal-title">
        <div className="compositor-modal-header">
          <h2 id="keycolor-modal-title">Key Color</h2>
          <button
            type="button"
            className="compositor-modal-close"
            onClick={handleCancel}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Pixels close to the <strong>Key Color</strong> become transparent. Use
              <strong> Threshold</strong> to widen the colour range and
              <strong> Softness</strong> for the edge falloff. Brush
              over the result to fix it manually — preview updates in real time.
            </p>

            <label className="inspector-label">Key Color</label>
            <div className="editor-field-row" style={{ gap: 6, marginBottom: 6 }}>
              <input
                className="inspector-color"
                type="color"
                value={keyColor}
                onChange={(e) => update({ keyColor: e.target.value })}
                disabled={isRunning}
              />
              <input
                className="inspector-input"
                value={keyColor}
                onChange={(e) => update({ keyColor: e.target.value })}
                disabled={isRunning}
                style={{ flex: 1 }}
              />
            </div>
            <button
              type="button"
              className="inspector-btn"
              style={{
                marginBottom: 12,
                background: tool === 'pick' ? '#6366f1' : undefined,
                color: tool === 'pick' ? '#fff' : undefined,
              }}
              onClick={() => setTool((t) => (t === 'pick' ? 'brush' : 'pick'))}
              disabled={isRunning}
            >
              {tool === 'pick' ? 'Picking… click image' : 'Pick from image'}
            </button>

            <label className="inspector-label">Threshold ({threshold.toFixed(2)})</label>
            <input
              className="inspector-range"
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={threshold}
              onChange={(e) => update({ threshold: parseFloat(e.target.value) })}
              disabled={isRunning}
            />

            <label className="inspector-label">Softness ({softness.toFixed(2)})</label>
            <input
              className="inspector-range"
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={softness}
              onChange={(e) => update({ softness: parseFloat(e.target.value) })}
              disabled={isRunning}
            />

            <div style={{ height: 1, background: 'var(--border)', margin: '14px 0 12px' }} />

            <label className="inspector-label">Brush Mode</label>
            <div className="editor-field-row" style={{ gap: 6, marginBottom: 10 }}>
              <button
                type="button"
                className="inspector-btn"
                style={{
                  flex: 1,
                  background: tool === 'brush' && mode === 'keep' ? '#16a34a' : undefined,
                  color: tool === 'brush' && mode === 'keep' ? '#fff' : undefined,
                }}
                onClick={() => {
                  setMode('keep');
                  setTool('brush');
                }}
                disabled={isRunning}
              >
                Keep
              </button>
              <button
                type="button"
                className="inspector-btn"
                style={{
                  flex: 1,
                  background: tool === 'brush' && mode === 'remove' ? '#dc2626' : undefined,
                  color: tool === 'brush' && mode === 'remove' ? '#fff' : undefined,
                }}
                onClick={() => {
                  setMode('remove');
                  setTool('brush');
                }}
                disabled={isRunning}
              >
                Remove
              </button>
            </div>

            <label className="inspector-label">Brush Size ({brushSize}px)</label>
            <input
              className="inspector-range"
              type="range"
              min={2}
              max={300}
              step={1}
              value={brushSize}
              onChange={(e) => setBrushSize(parseInt(e.target.value, 10) || 40)}
              disabled={isRunning}
            />

            <label className="inspector-label">Hardness ({hardness.toFixed(2)})</label>
            <input
              className="inspector-range"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={hardness}
              onChange={(e) => setHardness(parseFloat(e.target.value) || 0.7)}
              disabled={isRunning}
            />

            <button
              type="button"
              className="inspector-btn"
              style={{ marginTop: 14 }}
              onClick={resetStrokes}
              disabled={isRunning}
            >
              Reset strokes
            </button>

            {iw > 0 && ih > 0 && (
              <div className="inspector-empty-small" style={{ marginTop: 12, lineHeight: 1.5 }}>
                <div>
                  Source {iw} × {ih} px
                </div>
                <div>Aspect {formatAspectRatio(iw, ih)}</div>
              </div>
            )}

            <div
              className="editor-field-row"
              style={{ gap: 8, marginTop: 18 }}
            >
              <button
                type="button"
                className="inspector-btn"
                style={{ flex: 1 }}
                onClick={handleCancel}
                disabled={isRunning}
              >
                Cancel
              </button>
              <button
                type="button"
                className="inspector-btn"
                style={{
                  flex: 1,
                  background: '#4f46e5',
                  color: '#fff',
                  borderColor: '#4f46e5',
                }}
                onClick={handleApply}
                disabled={isRunning || !img}
              >
                Apply
              </button>
            </div>
          </aside>
          <div className="compositor-modal-canvas-wrap">
            {dw > 0 && dh > 0 ? (
              <canvas
                ref={displayCanvasRef}
                className="compositor-modal-canvas editor-canvas-interactive"
                style={{
                  cursor: isRunning ? 'not-allowed' : tool === 'pick' ? 'crosshair' : 'crosshair',
                  maxWidth: '100%',
                }}
                onMouseDown={onMouseDown}
              />
            ) : (
              <div className="inspector-empty-small" style={{ padding: 24 }}>
                {imageSrc ? 'Loading…' : 'Connect an image to preview'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
