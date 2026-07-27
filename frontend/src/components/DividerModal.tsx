import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_DIVIDER_OUTPUTS } from '../types/nodeTypes';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';
import { remapDividerSourceEdges, type DividerSelection } from '../utils/dividerEdges';

type DividerTool = 'box' | 'lasso';

type DrawingState =
  | { kind: 'none' }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'lasso'; points: Array<[number, number]> };

const MAX_DISPLAY_W = 1040;
const MAX_DISPLAY_H = 680;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function makeSelectionId(): string {
  return `sel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toImageCoords(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  iw: number,
  ih: number,
): [number, number] {
  const r = canvas.getBoundingClientRect();
  const u = (clientX - r.left) / Math.max(1, r.width);
  const v = (clientY - r.top) / Math.max(1, r.height);
  return [clamp(u * iw, 0, iw), clamp(v * ih, 0, ih)];
}

function normalizeSelection(sel: DividerSelection): DividerSelection | null {
  if (sel.kind === 'box') {
    const x0 = Math.round(Math.min(sel.x, sel.x + sel.w));
    const y0 = Math.round(Math.min(sel.y, sel.y + sel.h));
    const x1 = Math.round(Math.max(sel.x, sel.x + sel.w));
    const y1 = Math.round(Math.max(sel.y, sel.y + sel.h));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return null;
    return { id: sel.id, kind: 'box', x: x0, y: y0, w, h };
  }
  const pts = sel.points.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]);
  if (pts.length < 3) return null;
  return { id: sel.id, kind: 'lasso', points: pts };
}

function getSelectionBounds(sel: DividerSelection): { x: number; y: number; w: number; h: number } | null {
  if (sel.kind === 'box') {
    const x0 = Math.min(sel.x, sel.x + sel.w);
    const y0 = Math.min(sel.y, sel.y + sel.h);
    const x1 = Math.max(sel.x, sel.x + sel.w);
    const y1 = Math.max(sel.y, sel.y + sel.h);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return null;
    return { x: x0, y: y0, w, h };
  }

  if (sel.points.length < 3) return null;
  const xs = sel.points.map((p) => p[0]);
  const ys = sel.points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  return { x: x0, y: y0, w, h };
}

function detectAlpha(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(1, img.naturalWidth);
    c.height = Math.max(1, img.naturalHeight);
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0);
    const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] < 255) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  sel: DividerSelection,
  sx: number,
  sy: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  if (sel.kind === 'box') {
    ctx.strokeRect(sel.x * sx, sel.y * sy, sel.w * sx, sel.h * sy);
  } else if (sel.points.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(sel.points[0][0] * sx, sel.points[0][1] * sy);
    for (let i = 1; i < sel.points.length; i += 1) {
      ctx.lineTo(sel.points[i][0] * sx, sel.points[i][1] * sy);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function bakeSelectionPreview(
  img: HTMLImageElement,
  sel: DividerSelection,
  sourceHasAlpha: boolean,
): string | null {
  const b = getSelectionBounds(sel);
  if (!b) return null;

  const x = Math.round(Math.max(0, b.x));
  const y = Math.round(Math.max(0, b.y));
  const w = Math.max(1, Math.round(b.w));
  const h = Math.max(1, Math.round(b.h));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  if (sel.kind === 'box') {
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    return c.toDataURL('image/png');
  }

  if (!sourceHasAlpha) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
  }

  ctx.save();
  ctx.beginPath();
  const first = sel.points[0];
  ctx.moveTo(first[0] - x, first[1] - y);
  for (let i = 1; i < sel.points.length; i += 1) {
    ctx.lineTo(sel.points[i][0] - x, sel.points[i][1] - y);
  }
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  ctx.restore();
  return c.toDataURL('image/png');
}

export default function DividerModal({
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

  const imageSrc = useMemo(
    () => getConnectedImageDataUrl(nodeId, 'image', edges, nodes),
    [nodeId, edges, nodes],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingActiveRef = useRef(false);
  /** Authoritative in-progress shape; never append inside a React state updater (Strict Mode runs updaters twice). */
  const drawSessionRef = useRef<DrawingState>({ kind: 'none' });
  /** Selections when the modal was opened; Cancel restores this snapshot. */
  const selectionsOnOpenRef = useRef<DividerSelection[]>([]);
  const wasOpenRef = useRef(false);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<DividerTool>('box');
  const [selections, setSelections] = useState<DividerSelection[]>([]);
  const [drawing, setDrawing] = useState<DrawingState>({ kind: 'none' });

  useEffect(() => {
    if (!open) return;
    if (!node || node.type !== 'divider') onClose();
  }, [open, node, onClose]);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    const raw = data.selections;
    const normalized = Array.isArray(raw)
      ? raw.filter((x): x is DividerSelection => !!x && typeof x === 'object').slice(0, MAX_DIVIDER_OUTPUTS)
      : [];
    if (!wasOpenRef.current) {
      selectionsOnOpenRef.current = normalized;
      wasOpenRef.current = true;
    }
    setSelections(normalized);
    drawSessionRef.current = { kind: 'none' };
    drawingActiveRef.current = false;
    setDrawing({ kind: 'none' });
  }, [open, data.selections]);

  useEffect(() => {
    if (!open || !imageSrc) {
      setImg(null);
      return;
    }
    let cancelled = false;
    const el = new Image();
    el.onload = () => {
      if (!cancelled) setImg(el);
    };
    el.onerror = () => {
      if (!cancelled) setImg(null);
    };
    el.src = imageSrc;
    return () => {
      cancelled = true;
    };
  }, [open, imageSrc]);

  const displaySize = useMemo(() => {
    if (!img) return { w: 800, h: 500, scaleX: 1, scaleY: 1 };
    const iw = Math.max(1, img.naturalWidth);
    const ih = Math.max(1, img.naturalHeight);
    // Fit to the modal canvas bounds while preserving ratio. Unlike before,
    // we allow upscaling so small images also fill the available window area.
    const fit = Math.max(0.0001, Math.min(MAX_DISPLAY_W / iw, MAX_DISPLAY_H / ih));
    const w = Math.max(1, Math.round(iw * fit));
    const h = Math.max(1, Math.round(ih * fit));
    return { w, h, scaleX: w / iw, scaleY: h / ih };
  }, [img]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = displaySize.w;
    canvas.height = displaySize.h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!img) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Connect an image to Divider', canvas.width / 2, canvas.height / 2);
      return;
    }

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const sx = displaySize.scaleX;
    const sy = displaySize.scaleY;

    selections.forEach((sel, i) => {
      const hue = (i * 47) % 360;
      drawSelectionOverlay(ctx, sel, sx, sy, `hsl(${hue} 90% 62%)`);
    });

    if (drawing.kind === 'box') {
      const draft: DividerSelection = {
        id: 'draft',
        kind: 'box',
        x: drawing.x0,
        y: drawing.y0,
        w: drawing.x1 - drawing.x0,
        h: drawing.y1 - drawing.y0,
      };
      drawSelectionOverlay(ctx, draft, sx, sy, '#fbbf24');
    } else if (drawing.kind === 'lasso' && drawing.points.length >= 2) {
      drawSelectionOverlay(ctx, { id: 'draft', kind: 'lasso', points: drawing.points }, sx, sy, '#fbbf24');
    }
  }, [open, img, selections, drawing, displaySize]);

  const commitSelectionsAndEdges = useCallback(
    (prevList: DividerSelection[], nextRaw: DividerSelection[]) => {
      const normalized = nextRaw
        .slice(0, MAX_DIVIDER_OUTPUTS)
        .map((s) => normalizeSelection(s))
        .filter((x): x is DividerSelection => x !== null);
      const edges = useWorkflowStore.getState().edges;
      const newEdges = remapDividerSourceEdges(nodeId, prevList, normalized, edges);
      useWorkflowStore.setState({ edges: newEdges, _dirty: true });

      const bakedOutputs: Record<string, string> = {};
      if (img) {
        const sourceHasAlpha = detectAlpha(img);
        normalized.forEach((sel, i) => {
          const preview = bakeSelectionPreview(img, sel, sourceHasAlpha);
          if (preview) bakedOutputs[`out${i + 1}`] = preview;
        });
      }
      updateNodeData(nodeId, { selections: normalized, _dividerOutputs: bakedOutputs });
      return normalized;
    },
    [img, nodeId, updateNodeData],
  );

  const appendSelection = useCallback(
    (sel: DividerSelection) => {
      setSelections((prev) => {
        if (prev.length >= MAX_DIVIDER_OUTPUTS) return prev;
        return commitSelectionsAndEdges(prev, [...prev, sel]);
      });
    },
    [commitSelectionsAndEdges],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!img || isRunning) return;
      if (selections.length >= MAX_DIVIDER_OUTPUTS) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [ix, iy] = toImageCoords(e.clientX, e.clientY, canvas, img.naturalWidth, img.naturalHeight);

      if (tool === 'box') {
        drawingActiveRef.current = true;
        const s = { kind: 'box' as const, x0: ix, y0: iy, x1: ix, y1: iy };
        drawSessionRef.current = s;
        setDrawing(s);
      } else {
        drawingActiveRef.current = true;
        const s = { kind: 'lasso' as const, points: [[ix, iy]] as [number, number][] };
        drawSessionRef.current = s;
        setDrawing(s);
      }
    },
    [img, isRunning, selections.length, tool],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!img) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const [ix, iy] = toImageCoords(e.clientX, e.clientY, canvas, img.naturalWidth, img.naturalHeight);

      setDrawing((prev) => {
        if (prev.kind === 'box') {
          const next = { ...prev, x1: ix, y1: iy };
          drawSessionRef.current = next;
          return next;
        }
        if (prev.kind === 'lasso') {
          const last = prev.points[prev.points.length - 1];
          if (!last || Math.hypot(ix - last[0], iy - last[1]) < 2.5) return prev;
          const next = { kind: 'lasso' as const, points: [...prev.points, [ix, iy] as [number, number]] };
          drawSessionRef.current = next;
          return next;
        }
        return prev;
      });
    },
    [img],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawingActiveRef.current) return;
    drawingActiveRef.current = false;
    const d = drawSessionRef.current;
    drawSessionRef.current = { kind: 'none' };

    if (d.kind === 'box') {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (Math.abs(w) >= 1 && Math.abs(h) >= 1) {
        appendSelection({
          id: makeSelectionId(),
          kind: 'box',
          x: d.x0,
          y: d.y0,
          w,
          h,
        });
      }
    } else if (d.kind === 'lasso' && d.points.length >= 3) {
      appendSelection({
        id: makeSelectionId(),
        kind: 'lasso',
        points: d.points.map((p) => [p[0], p[1]] as [number, number]),
      });
    }

    setDrawing({ kind: 'none' });
  }, [appendSelection]);

  const handleMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!drawingActiveRef.current) return;
      // Finalize only if the pointer is released outside the canvas.
      if (e.buttons === 0) {
        handleMouseUp();
      }
    },
    [handleMouseUp],
  );

  const removeSelection = useCallback(
    (id: string) => {
      setSelections((prev) => {
        const nextRaw = prev.filter((sel) => sel.id !== id);
        return commitSelectionsAndEdges(prev, nextRaw);
      });
    },
    [commitSelectionsAndEdges],
  );

  const handleApply = useCallback(() => {
    const clamped = selections
      .slice(0, MAX_DIVIDER_OUTPUTS)
      .map((sel) => normalizeSelection(sel))
      .filter((sel): sel is DividerSelection => sel !== null);

    const liveNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
    const prevSelections = Array.isArray(liveNode?.data?.selections)
      ? (liveNode!.data!.selections as DividerSelection[])
      : [];

    commitSelectionsAndEdges(prevSelections, clamped);
    onClose();
  }, [commitSelectionsAndEdges, nodeId, onClose, selections]);

  const handleCancel = useCallback(() => {
    const liveNode = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
    const prevSelections = Array.isArray(liveNode?.data?.selections)
      ? (liveNode!.data!.selections as DividerSelection[])
      : selections;
    commitSelectionsAndEdges(prevSelections, selectionsOnOpenRef.current);
    onClose();
  }, [commitSelectionsAndEdges, nodeId, onClose, selections]);

  if (!open) return null;

  return (
    <div
      className="compositor-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compositor-modal" role="dialog" aria-labelledby="divider-modal-title">
        <div className="compositor-modal-header">
          <h2 id="divider-modal-title">Divider</h2>
          <button type="button" className="compositor-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Draw multiple selections with Box or Lasso. Each selection becomes one output handle.
            </p>

            <label className="inspector-label">Tool</label>
            <div className="editor-field-row" style={{ gap: 6, marginBottom: 10 }}>
              <button
                type="button"
                className="inspector-btn"
                onClick={() => setTool('box')}
                style={tool === 'box' ? { borderColor: '#f59e0b' } : undefined}
              >
                Box
              </button>
              <button
                type="button"
                className="inspector-btn"
                onClick={() => setTool('lasso')}
                style={tool === 'lasso' ? { borderColor: '#f59e0b' } : undefined}
              >
                Lasso
              </button>
            </div>

            <label className="inspector-label">Selections ({selections.length}/{MAX_DIVIDER_OUTPUTS})</label>
            <div style={{ display: 'grid', gap: 6, maxHeight: 240, overflow: 'auto' }}>
              {selections.map((sel, i) => (
                <div
                  key={sel.id}
                  className="editor-field-row"
                  style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
                >
                  <span className="inspector-empty-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '999px',
                        background: `hsl(${(i * 47) % 360} 90% 62%)`,
                        border: '1px solid rgba(255,255,255,0.2)',
                      }}
                    />
                    {`Out ${i + 1} · ${sel.kind}`}
                  </span>
                  <button
                    type="button"
                    className="inspector-btn"
                    onClick={() => removeSelection(sel.id)}
                    disabled={isRunning}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {selections.length === 0 && (
                <div className="inspector-empty-small">No selections yet.</div>
              )}
            </div>

            <div className="editor-field-row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              <button
                type="button"
                className="inspector-btn"
                onClick={() =>
                  setSelections((prev) => commitSelectionsAndEdges(prev, []))
                }
                disabled={isRunning || selections.length === 0}
              >
                Clear All
              </button>
              <button type="button" className="inspector-btn" onClick={handleCancel}>
                Cancel
              </button>
              <button type="button" className="inspector-btn" onClick={handleApply} disabled={isRunning}>
                Apply
              </button>
            </div>
          </aside>

          <div className="compositor-modal-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="compositor-modal-canvas editor-canvas-interactive"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
