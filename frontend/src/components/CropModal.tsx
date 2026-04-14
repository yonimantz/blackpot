import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';

const HANDLE_PX = 10;

type CropHandle =
  | 'move'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

function clampCrop(x: number, y: number, w: number, h: number, iw: number, ih: number) {
  let cx = Math.max(0, Math.min(Math.floor(x), Math.max(0, iw - 1)));
  let cy = Math.max(0, Math.min(Math.floor(y), Math.max(0, ih - 1)));
  let cw = Math.max(1, Math.floor(w));
  let ch = Math.max(1, Math.floor(h));
  cw = Math.min(cw, iw - cx);
  ch = Math.min(ch, ih - cy);
  return { x: cx, y: cy, w: Math.max(1, cw), h: Math.max(1, ch) };
}

function hitTestCrop(
  dx: number,
  dy: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  hit: number,
): CropHandle | null {
  const midX = sx + sw / 2;
  const midY = sy + sh / 2;
  const corners: { h: CropHandle; px: number; py: number }[] = [
    { h: 'nw', px: sx, py: sy },
    { h: 'ne', px: sx + sw, py: sy },
    { h: 'se', px: sx + sw, py: sy + sh },
    { h: 'sw', px: sx, py: sy + sh },
  ];
  for (const c of corners) {
    if (Math.hypot(dx - c.px, dy - c.py) <= hit) return c.h;
  }
  if (Math.abs(dx - midX) <= hit && dy >= sy - hit && dy <= sy + hit) return 'n';
  if (Math.abs(dx - midX) <= hit && dy >= sy + sh - hit && dy <= sy + sh + hit) return 's';
  if (Math.abs(dy - midY) <= hit && dx >= sx - hit && dx <= sx + hit) return 'w';
  if (Math.abs(dy - midY) <= hit && dx >= sx + sw - hit && dx <= sx + sw + hit) return 'e';
  if (dx >= sx && dx <= sx + sw && dy >= sy && dy <= sy + sh) return 'move';
  return null;
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

type DragState =
  | { kind: 'none' }
  | {
      kind: 'active';
      handle: CropHandle;
      startIx: number;
      startIy: number;
      startX: number;
      startY: number;
      startW: number;
      startH: number;
      ratio: number;
    };

function computeResizeRect(
  handle: CropHandle,
  ix: number,
  iy: number,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  iw: number,
  ih: number,
  shift: boolean,
  ratio: number,
): { x: number; y: number; w: number; h: number } {
  const bottom0 = sy + sh;
  const right0 = sx + sw;
  const r = shift && ratio > 0 ? ratio : 0;

  const enforceEdgeRatio = (x0: number, y0: number, w0: number, h0: number, edge: 'h' | 'v') => {
    let x = x0;
    let y = y0;
    let w = Math.max(1, w0);
    let h = Math.max(1, h0);
    if (r <= 0) return { x, y, w, h };
    if (edge === 'h') {
      h = Math.max(1, Math.round(w / r));
      y = Math.round(sy + sh / 2 - h / 2);
    } else {
      w = Math.max(1, Math.round(h * r));
      x = Math.round(sx + sw / 2 - w / 2);
    }
    return { x, y, w, h };
  };

  switch (handle) {
    case 'se': {
      let w = Math.max(1, Math.round(ix - sx));
      let h = Math.max(1, Math.round(iy - sy));
      if (r > 0) {
        if (w / r > h) w = Math.max(1, Math.round(h * r));
        else h = Math.max(1, Math.round(w / r));
      }
      return clampCrop(sx, sy, w, h, iw, ih);
    }
    case 'nw': {
      let left = Math.min(Math.round(ix), right0 - 1);
      let top = Math.min(Math.round(iy), bottom0 - 1);
      let w = right0 - left;
      let h = bottom0 - top;
      if (r > 0) {
        if (w / r > h) w = Math.max(1, Math.round(h * r));
        else h = Math.max(1, Math.round(w / r));
        left = right0 - w;
        top = bottom0 - h;
      }
      return clampCrop(left, top, w, h, iw, ih);
    }
    case 'ne': {
      const left = sx;
      const bottom = bottom0;
      let top = Math.min(Math.round(iy), bottom - 1);
      let right = Math.max(Math.round(ix), left + 1);
      let w = right - left;
      let h = bottom - top;
      if (r > 0) {
        if (w / r > h) w = Math.max(1, Math.round(h * r));
        else h = Math.max(1, Math.round(w / r));
        top = bottom - h;
      }
      return clampCrop(left, top, w, h, iw, ih);
    }
    case 'sw': {
      const top = sy;
      const right = right0;
      let left = Math.min(Math.round(ix), right - 1);
      let bottom = Math.max(Math.round(iy), top + 1);
      let w = right - left;
      let h = bottom - top;
      if (r > 0) {
        if (w / r > h) w = Math.max(1, Math.round(h * r));
        else h = Math.max(1, Math.round(w / r));
        left = right - w;
        bottom = top + h;
      }
      return clampCrop(left, top, w, h, iw, ih);
    }
    case 'e': {
      const w = Math.max(1, Math.round(ix - sx));
      const base = enforceEdgeRatio(sx, sy, w, sh, 'h');
      return clampCrop(base.x, base.y, base.w, base.h, iw, ih);
    }
    case 'w': {
      const right = right0;
      const left = Math.min(Math.round(ix), right - 1);
      const w = right - left;
      const base = enforceEdgeRatio(left, sy, w, sh, 'h');
      return clampCrop(base.x, base.y, base.w, base.h, iw, ih);
    }
    case 's': {
      const h = Math.max(1, Math.round(iy - sy));
      const base = enforceEdgeRatio(sx, sy, sw, h, 'v');
      return clampCrop(base.x, base.y, base.w, base.h, iw, ih);
    }
    case 'n': {
      const bottom = bottom0;
      const top = Math.min(Math.round(iy), bottom - 1);
      const h = bottom - top;
      const base = enforceEdgeRatio(sx, top, sw, h, 'v');
      return clampCrop(base.x, base.y, base.w, base.h, iw, ih);
    }
    default:
      return clampCrop(sx, sy, sw, sh, iw, ih);
  }
}

export default function CropModal({
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
    if (!node || node.type !== 'crop') onClose();
  }, [open, node, onClose]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState>({ kind: 'none' });
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  const imageSrc = useMemo(
    () => getConnectedImageDataUrl(nodeId, 'image', edges, nodes),
    [nodeId, edges, nodes],
  );

  useEffect(() => {
    if (!open || !imageSrc) {
      setImg(null);
      return;
    }
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = imageSrc;
  }, [open, imageSrc]);

  const iw = img?.naturalWidth ?? 0;
  const ih = img?.naturalHeight ?? 0;

  const maxPreviewWidth = Math.min(960, Math.max(200, typeof window !== 'undefined' ? window.innerWidth - 380 : 600));
  const maxPreviewHeight = Math.min(720, typeof window !== 'undefined' ? window.innerHeight - 160 : 520);

  const { dw, dh } = useMemo(() => {
    if (iw <= 0 || ih <= 0) return { dw: 0, dh: 0 };
    const s = Math.min(maxPreviewWidth / iw, maxPreviewHeight / ih, 1);
    return { dw: Math.round(iw * s), dh: Math.round(ih * s) };
  }, [iw, ih, maxPreviewWidth, maxPreviewHeight]);

  const cx = Math.max(0, Math.floor(Number(data.x) || 0));
  const cy = Math.max(0, Math.floor(Number(data.y) || 0));
  const cw = Math.max(1, Math.floor(Number(data.width) || 1));
  const ch = Math.max(1, Math.floor(Number(data.height) || 1));

  const persistCrop = useCallback(
    (x: number, y: number, w: number, h: number) => {
      if (iw <= 0 || ih <= 0) {
        updateNodeData(nodeId, { x, y, width: w, height: h });
        return;
      }
      const c = clampCrop(x, y, w, h, iw, ih);
      updateNodeData(nodeId, { x: c.x, y: c.y, width: c.w, height: c.h });
    },
    [nodeId, updateNodeData, iw, ih],
  );

  useEffect(() => {
    if (!open || !img || iw <= 0 || ih <= 0) return;
    const c = clampCrop(cx, cy, cw, ch, iw, ih);
    if (c.x !== cx || c.y !== cy || c.w !== cw || c.h !== ch) {
      updateNodeData(nodeId, { x: c.x, y: c.y, width: c.w, height: c.h });
    }
  }, [open, img, iw, ih, cx, cy, cw, ch, nodeId, updateNodeData]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
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

    if (img && iw > 0 && ih > 0) {
      ctx.drawImage(img, 0, 0, dw, dh);
    } else {
      ctx.fillStyle = '#2a2a2e';
      ctx.fillRect(0, 0, dw, dh);
      ctx.fillStyle = '#888';
      ctx.font = '14px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(imageSrc ? 'Could not load image' : 'Connect an image to the Image input', dw / 2, dh / 2);
    }

    if (iw <= 0 || ih <= 0) return;

    const sx = (cx / iw) * dw;
    const sy = (cy / ih) * dh;
    const sw = (cw / iw) * dw;
    const sh = (ch / ih) * dh;

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, dw, dh);
    ctx.rect(sx, sy, sw, sh);
    ctx.fill('evenodd');

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, sw, sh);

    const hh = 6;
    const handles: [number, number][] = [
      [sx, sy],
      [sx + sw, sy],
      [sx + sw, sy + sh],
      [sx, sy + sh],
      [sx + sw / 2, sy],
      [sx + sw / 2, sy + sh],
      [sx, sy + sh / 2],
      [sx + sw, sy + sh / 2],
    ];
    ctx.fillStyle = '#fff';
    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - hh / 2, hy - hh / 2, hh, hh);
    }
  }, [img, iw, ih, dw, dh, cx, cy, cw, ch, imageSrc]);

  useEffect(() => {
    draw();
  }, [draw]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isRunning || iw <= 0 || ih <= 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { dx, dy } = clientToDisplay(e.clientX, e.clientY, canvas, dw, dh);
      const sx = (cx / iw) * dw;
      const sy = (cy / ih) * dh;
      const sw = (cw / iw) * dw;
      const sh = (ch / ih) * dh;
      const hit = hitTestCrop(dx, dy, sx, sy, sw, sh, HANDLE_PX);
      if (!hit) {
        dragRef.current = { kind: 'none' };
        return;
      }
      const { ix, iy } = displayToImage(dx, dy, iw, ih, dw, dh);
      const ratio = cw / Math.max(1, ch);
      dragRef.current = {
        kind: 'active',
        handle: hit,
        startIx: ix,
        startIy: iy,
        startX: cx,
        startY: cy,
        startW: cw,
        startH: ch,
        ratio,
      };
      e.preventDefault();
    },
    [isRunning, iw, ih, dw, dh, cx, cy, cw, ch],
  );

  useEffect(() => {
    if (!open) return;

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (d.kind !== 'active') return;
      const canvas = canvasRef.current;
      if (!canvas || iw <= 0 || ih <= 0) return;

      const { dx, dy } = clientToDisplay(e.clientX, e.clientY, canvas, dw, dh);
      const { ix, iy } = displayToImage(dx, dy, iw, ih, dw, dh);
      const shift = e.shiftKey;

      if (d.handle === 'move') {
        const dxI = ix - d.startIx;
        const dyI = iy - d.startIy;
        let nx = Math.round(d.startX + dxI);
        let ny = Math.round(d.startY + dyI);
        nx = Math.max(0, Math.min(nx, iw - d.startW));
        ny = Math.max(0, Math.min(ny, ih - d.startH));
        persistCrop(nx, ny, d.startW, d.startH);
        return;
      }

      const next = computeResizeRect(
        d.handle,
        ix,
        iy,
        d.startX,
        d.startY,
        d.startW,
        d.startH,
        iw,
        ih,
        shift,
        d.ratio,
      );
      persistCrop(next.x, next.y, next.w, next.h);
    };

    const onUp = () => {
      dragRef.current = { kind: 'none' };
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [open, iw, ih, dw, dh, persistCrop]);

  if (!open || !node || node.type !== 'crop') return null;

  const updateField = (key: string, v: number) => {
    if (iw > 0 && ih > 0) {
      const nx = key === 'x' ? v : cx;
      const ny = key === 'y' ? v : cy;
      const nw = key === 'width' ? v : cw;
      const nh = key === 'height' ? v : ch;
      persistCrop(nx, ny, nw, nh);
    } else {
      updateNodeData(nodeId, { [key]: v });
    }
  };

  return (
    <div
      className="compositor-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compositor-modal" role="dialog" aria-labelledby="crop-modal-title">
        <div className="compositor-modal-header">
          <h2 id="crop-modal-title">Crop</h2>
          <button type="button" className="compositor-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Drag inside the crop to move. Drag edges or corners to resize. Hold Shift while resizing to keep aspect
              ratio. You can also type exact pixel values below.
            </p>
            <label className="inspector-label">Crop (px)</label>
            <div className="editor-field-row" style={{ marginBottom: 8 }}>
              <label style={{ minWidth: 14 }}>X</label>
              <input
                className="inspector-input"
                type="number"
                min={0}
                value={cx}
                disabled={isRunning}
                onChange={(e) => updateField('x', parseInt(e.target.value, 10) || 0)}
              />
              <label style={{ minWidth: 14 }}>Y</label>
              <input
                className="inspector-input"
                type="number"
                min={0}
                value={cy}
                disabled={isRunning}
                onChange={(e) => updateField('y', parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div className="editor-field-row" style={{ marginBottom: 8 }}>
              <label style={{ minWidth: 14 }}>W</label>
              <input
                className="inspector-input"
                type="number"
                min={1}
                value={cw}
                disabled={isRunning}
                onChange={(e) => updateField('width', Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
              <label style={{ minWidth: 14 }}>H</label>
              <input
                className="inspector-input"
                type="number"
                min={1}
                value={ch}
                disabled={isRunning}
                onChange={(e) => updateField('height', Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
            {iw > 0 && ih > 0 && (
              <div className="inspector-empty-small" style={{ marginTop: 4 }}>
                Source {iw} × {ih} px
              </div>
            )}
          </aside>
          <div className="compositor-modal-canvas-wrap">
            {dw > 0 && dh > 0 ? (
              <canvas
                ref={canvasRef}
                className="compositor-modal-canvas editor-canvas-interactive"
                style={{ cursor: isRunning ? 'not-allowed' : 'crosshair', maxWidth: '100%' }}
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
