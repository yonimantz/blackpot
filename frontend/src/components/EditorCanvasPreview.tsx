import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useWorkflowStore } from '../store/workflowStore';

function _getConnectedImageSrc(
  nodeId: string,
  handleId: string,
  edges: { source: string; target: string; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
): string | null {
  const edge = edges.find((e) => e.target === nodeId && e.targetHandle === handleId);
  if (!edge) return null;
  const sourceNode = allNodes.find((n) => n.id === edge.source);
  if (!sourceNode) return null;
  const d = sourceNode.data;
  return (
    d?.fileData ||
    d?._result?.image ||
    d?.previewData ||
    d?._editorPreview ||
    d?._compositorPreview ||
    d?._vignettePreview ||
    null
  );
}

const HANDLE_ANCHORS: Record<string, { lx: number; ly: number; sw: boolean; sh: boolean }> = {
  'scale-tl': { lx: 1, ly: 1, sw: true, sh: true },
  'scale-tr': { lx: -1, ly: 1, sw: true, sh: true },
  'scale-br': { lx: -1, ly: -1, sw: true, sh: true },
  'scale-bl': { lx: 1, ly: -1, sw: true, sh: true },
  'scale-t': { lx: 0, ly: 1, sw: false, sh: true },
  'scale-b': { lx: 0, ly: -1, sw: false, sh: true },
  'scale-l': { lx: 1, ly: 0, sw: true, sh: false },
  'scale-r': { lx: -1, ly: 0, sw: true, sh: false },
};

function _rotPt(x: number, y: number, rad: number) {
  return { x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) };
}

function _getLayerCorners(cfg: any, w: number, h: number, s: number) {
  const rad = (cfg.rotation || 0) * Math.PI / 180;
  const cx = cfg.x * s;
  const cy = cfg.y * s;
  const hw = (w * s) / 2;
  const hh = (h * s) / 2;
  const pts = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return pts.map(([lx, ly]) => {
    const r = _rotPt(lx, ly, rad);
    return { x: cx + r.x, y: cy + r.y };
  });
}

export default function EditorCanvasPreview({
  nodeId,
  data,
  maxPreviewWidth = 252,
  disabled = false,
  className,
}: {
  nodeId: string;
  data: Record<string, any>;
  maxPreviewWidth?: number;
  disabled?: boolean;
  className?: string;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const layerCount = (data.layerCount as number) || 0;
  const layers = (data.layers as Record<string, any>) || {};

  const [selectedLayer, _setSel] = useState<number | null>(null);
  const selRef = useRef<number | null>(null);
  const setSel = (v: number | null) => {
    selRef.current = v;
    _setSel(v);
  };

  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const scaleRef = useRef(1);
  const autoFittedRef = useRef<Set<string>>(new Set());

  const dragRef = useRef({
    active: false,
    mode: 'none',
    startMx: 0,
    startMy: 0,
    startCfg: null as any,
    localLayers: {} as Record<string, any>,
  });

  useEffect(() => {
    const toLoad: Record<string, string> = {};
    const bgSrc = _getConnectedImageSrc(nodeId, 'bgLayer', edges, allNodes);
    if (bgSrc) toLoad['bgLayer'] = bgSrc;
    for (let i = 1; i <= layerCount; i++) {
      const src = _getConnectedImageSrc(nodeId, `layer${i}`, edges, allNodes);
      if (src) toLoad[`layer${i}`] = src;
    }
    const keys = Object.keys(toLoad);
    if (keys.length === 0) {
      setImages({});
      return;
    }
    let loaded = 0;
    const result: Record<string, HTMLImageElement> = {};
    for (const key of keys) {
      const img = new Image();
      img.onload = () => {
        result[key] = img;
        loaded++;
        if (loaded === keys.length) setImages({ ...result });
      };
      img.onerror = () => {
        loaded++;
        if (loaded === keys.length) setImages({ ...result });
      };
      img.src = toLoad[key];
    }
  }, [edges, allNodes, nodeId, layerCount]);

  useEffect(() => {
    const bgImg = images.bgLayer;
    if (!bgImg) return;
    const bgW = bgImg.naturalWidth;
    const bgH = bgImg.naturalHeight;
    let changed = false;
    const newLayers = { ...layers };
    for (let i = 1; i <= layerCount; i++) {
      const key = `layer${i}`;
      const img = images[key];
      if (!img || autoFittedRef.current.has(key)) continue;
      const cfg = newLayers[key] || { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false };
      if (cfg.width === 0 && cfg.height === 0) {
        const fitS = Math.min(bgW / img.naturalWidth, bgH / img.naturalHeight);
        newLayers[key] = {
          ...cfg,
          width: Math.round(img.naturalWidth * fitS),
          height: Math.round(img.naturalHeight * fitS),
          x: Math.round(bgW / 2),
          y: Math.round(bgH / 2),
        };
        autoFittedRef.current.add(key);
        changed = true;
      }
    }
    if (changed) updateNodeData(nodeId, { layers: newLayers });
  }, [images, layerCount, layers, nodeId, updateNodeData]);

  const draw = useCallback(
    (lc: Record<string, any>, sel: number | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const bgImg = images.bgLayer;
      const mw = Math.max(80, maxPreviewWidth);
      if (!bgImg) {
        const ew = mw;
        const eh = Math.round((mw * 160) / 252);
        canvas.width = ew;
        canvas.height = eh;
        ctx.fillStyle = '#1e1e21';
        ctx.fillRect(0, 0, ew, eh);
        ctx.fillStyle = '#71717a';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Connect a BG Layer', ew / 2, eh / 2 + 4);
        return;
      }
      const s = Math.min(1, mw / bgImg.naturalWidth);
      scaleRef.current = s;
      const cw = Math.round(bgImg.naturalWidth * s);
      const ch = Math.round(bgImg.naturalHeight * s);
      canvas.width = cw;
      canvas.height = ch;
      ctx.drawImage(bgImg, 0, 0, cw, ch);

      for (let i = 1; i <= layerCount; i++) {
        const key = `layer${i}`;
        const img = images[key];
        if (!img) continue;
        const cfg = lc[key] || { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false };
        const w = cfg.width > 0 ? cfg.width : img.naturalWidth;
        const h = cfg.height > 0 ? cfg.height : img.naturalHeight;
        const rad = ((cfg.rotation || 0) * Math.PI) / 180;
        ctx.save();
        ctx.translate(cfg.x * s, cfg.y * s);
        ctx.rotate(rad);
        if (cfg.flipH) ctx.scale(-1, 1);
        ctx.drawImage(img, (-w * s) / 2, (-h * s) / 2, w * s, h * s);
        ctx.restore();
      }

      if (sel !== null && images[`layer${sel}`]) {
        const key = `layer${sel}`;
        const img = images[key]!;
        const cfg = lc[key] || { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false };
        const w = cfg.width > 0 ? cfg.width : img.naturalWidth;
        const h = cfg.height > 0 ? cfg.height : img.naturalHeight;
        const corners = _getLayerCorners(cfg, w, h, s);
        const rad = ((cfg.rotation || 0) * Math.PI) / 180;

        ctx.save();
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let j = 1; j < 4; j++) ctx.lineTo(corners[j].x, corners[j].y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        const hs = 6;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1.5;
        for (const c of corners) {
          ctx.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
          ctx.strokeRect(c.x - hs / 2, c.y - hs / 2, hs, hs);
        }

        const ehs = 4;
        for (let j = 0; j < 4; j++) {
          const n = (j + 1) % 4;
          const mx = (corners[j].x + corners[n].x) / 2;
          const my = (corners[j].y + corners[n].y) / 2;
          ctx.fillRect(mx - ehs / 2, my - ehs / 2, ehs, ehs);
          ctx.strokeRect(mx - ehs / 2, my - ehs / 2, ehs, ehs);
        }

        const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
        const rDist = 18;
        const rh = { x: topMid.x + rDist * Math.sin(rad), y: topMid.y - rDist * Math.cos(rad) };
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(topMid.x, topMid.y);
        ctx.lineTo(rh.x, rh.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rh.x, rh.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#6366f1';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rh.x, rh.y, 3, -2.2, 1);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
      }
    },
    [images, layerCount, maxPreviewWidth],
  );

  useEffect(() => {
    draw(layers, selectedLayer);
  }, [layers, draw, selectedLayer]);

  const getCoords = useCallback((cx: number, cy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (cx - rect.left) * (canvas.width / rect.width),
      y: (cy - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const near = (x1: number, y1: number, x2: number, y2: number, t = 8) => Math.hypot(x1 - x2, y1 - y2) < t;

  const ptInLayer = useCallback(
    (px: number, py: number, idx: number) => {
      const key = `layer${idx}`;
      const img = images[key];
      if (!img) return false;
      const cfg = layers[key] || {};
      const s = scaleRef.current;
      const w = cfg.width > 0 ? cfg.width : img.naturalWidth;
      const h = cfg.height > 0 ? cfg.height : img.naturalHeight;
      const rad = ((cfg.rotation || 0) * Math.PI) / 180;
      const dx = px - cfg.x * s;
      const dy = py - cfg.y * s;
      const lx = dx * Math.cos(-rad) - dy * Math.sin(-rad);
      const ly = dx * Math.sin(-rad) + dy * Math.cos(-rad);
      return Math.abs(lx) <= (w * s) / 2 && Math.abs(ly) <= (h * s) / 2;
    },
    [images, layers],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      const { x, y } = getCoords(e.clientX, e.clientY);
      const s = scaleRef.current;
      const sel = selRef.current;

      if (sel !== null && images[`layer${sel}`]) {
        const key = `layer${sel}`;
        const img = images[key]!;
        const cfg = layers[key] || {};
        const w = cfg.width > 0 ? cfg.width : img.naturalWidth;
        const h = cfg.height > 0 ? cfg.height : img.naturalHeight;
        const corners = _getLayerCorners(cfg, w, h, s);
        const rad = ((cfg.rotation || 0) * Math.PI) / 180;

        const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
        const rh = { x: topMid.x + 18 * Math.sin(rad), y: topMid.y - 18 * Math.cos(rad) };
        if (near(x, y, rh.x, rh.y, 10)) {
          startDrag('rotate', cfg, x, y);
          return;
        }

        const cNames = ['scale-tl', 'scale-tr', 'scale-br', 'scale-bl'];
        for (let j = 0; j < 4; j++) {
          if (near(x, y, corners[j].x, corners[j].y)) {
            startDrag(cNames[j], cfg, x, y);
            return;
          }
        }

        const eNames = ['scale-t', 'scale-r', 'scale-b', 'scale-l'];
        for (let j = 0; j < 4; j++) {
          const n = (j + 1) % 4;
          const mx = (corners[j].x + corners[n].x) / 2;
          const my = (corners[j].y + corners[n].y) / 2;
          if (near(x, y, mx, my)) {
            startDrag(eNames[j], cfg, x, y);
            return;
          }
        }
      }

      for (let i = layerCount; i >= 1; i--) {
        if (ptInLayer(x, y, i)) {
          setSel(i);
          const cfg = layers[`layer${i}`] || {};
          startDrag('move', cfg, x, y);
          return;
        }
      }
      setSel(null);

      function startDrag(mode: string, cfg: any, mx: number, my: number) {
        const d = dragRef.current;
        d.active = true;
        d.mode = mode;
        d.startMx = mx;
        d.startMy = my;
        d.startCfg = { ...cfg };
        d.localLayers = { ...layers };

        const onMove = (ev: MouseEvent) => {
          if (!d.active) return;
          const { x: cx, y: cy } = getCoords(ev.clientX, ev.clientY);
          const s2 = scaleRef.current;
          const selI = selRef.current;
          if (selI === null) return;
          const k = `layer${selI}`;
          const sc = d.startCfg;
          const img = images[k];
          if (!sc || !img) return;
          const startW = sc.width > 0 ? sc.width : img.naturalWidth;
          const startH = sc.height > 0 ? sc.height : img.naturalHeight;
          const updated = { ...d.localLayers };
          const newCfg = { ...sc };

          if (d.mode === 'move') {
            newCfg.x = sc.x + (cx - d.startMx) / s2;
            newCfg.y = sc.y + (cy - d.startMy) / s2;
          } else if (d.mode === 'rotate') {
            const centerX = sc.x * s2;
            const centerY = sc.y * s2;
            const a0 = Math.atan2(d.startMy - centerY, d.startMx - centerX);
            const a1 = Math.atan2(cy - centerY, cx - centerX);
            newCfg.rotation = ((sc.rotation || 0) + ((a1 - a0) * 180) / Math.PI + 360) % 360;
          } else if (d.mode.startsWith('scale-')) {
            const rad2 = ((sc.rotation || 0) * Math.PI) / 180;
            const anchor = HANDLE_ANCHORS[d.mode];
            if (!anchor) return;
            const alx = (anchor.lx * startW) / 2;
            const aly = (anchor.ly * startH) / 2;
            const aRot = _rotPt(alx, aly, rad2);
            const aImgX = sc.x + aRot.x;
            const aImgY = sc.y + aRot.y;
            // World-space mouse on canvas (same coords as layer x/y). Must not use center + delta —
            // that equals the layer center at drag start and shrinks the box on the first move.
            const mImgX = cx / s2;
            const mImgY = cy / s2;

            const dx = mImgX - aImgX;
            const dy = mImgY - aImgY;
            const ldx = dx * Math.cos(-rad2) - dy * Math.sin(-rad2);
            const ldy = dx * Math.sin(-rad2) + dy * Math.cos(-rad2);

            const nw = anchor.sw ? Math.max(10, Math.abs(ldx)) : startW;
            const nh = anchor.sh ? Math.max(10, Math.abs(ldy)) : startH;

            const nlx = anchor.lx !== 0 ? Math.sign(anchor.lx) * nw / 2 : 0;
            const nly = anchor.ly !== 0 ? Math.sign(anchor.ly) * nh / 2 : 0;
            const nRot = _rotPt(nlx, nly, rad2);
            newCfg.x = Math.round(aImgX - nRot.x);
            newCfg.y = Math.round(aImgY - nRot.y);
            newCfg.width = Math.round(nw);
            newCfg.height = Math.round(nh);
          }

          updated[k] = newCfg;
          d.localLayers = updated;
          draw(updated, selI);
        };

        const onUp = () => {
          if (d.active) {
            d.active = false;
            updateNodeData(nodeId, { layers: d.localLayers });
          }
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }
    },
    [disabled, getCoords, images, layers, layerCount, ptInLayer, draw, updateNodeData, nodeId],
  );

  const handleHover = useCallback(
    (e: ReactMouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (disabled) {
        canvas.style.cursor = 'not-allowed';
        return;
      }
      if (dragRef.current.active) return;
      const { x, y } = getCoords(e.clientX, e.clientY);
      const s = scaleRef.current;
      const sel = selRef.current;

      if (sel !== null && images[`layer${sel}`]) {
        const key = `layer${sel}`;
        const img = images[key]!;
        const cfg = layers[key] || {};
        const w = cfg.width > 0 ? cfg.width : img.naturalWidth;
        const h = cfg.height > 0 ? cfg.height : img.naturalHeight;
        const corners = _getLayerCorners(cfg, w, h, s);
        const rad = ((cfg.rotation || 0) * Math.PI) / 180;

        const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
        const rh = { x: topMid.x + 18 * Math.sin(rad), y: topMid.y - 18 * Math.cos(rad) };
        if (near(x, y, rh.x, rh.y, 10)) {
          canvas.style.cursor = 'grab';
          return;
        }

        for (let j = 0; j < 4; j++) {
          if (near(x, y, corners[j].x, corners[j].y)) {
            canvas.style.cursor = j % 2 === 0 ? 'nwse-resize' : 'nesw-resize';
            return;
          }
        }
        for (let j = 0; j < 4; j++) {
          const n = (j + 1) % 4;
          const mx = (corners[j].x + corners[n].x) / 2;
          const my = (corners[j].y + corners[n].y) / 2;
          if (near(x, y, mx, my)) {
            canvas.style.cursor = j % 2 === 0 ? 'ns-resize' : 'ew-resize';
            return;
          }
        }
      }

      for (let i = layerCount; i >= 1; i--) {
        if (ptInLayer(x, y, i)) {
          canvas.style.cursor = 'move';
          return;
        }
      }
      canvas.style.cursor = 'default';
    },
    [disabled, getCoords, images, layers, layerCount, ptInLayer],
  );

  const canvasClass =
    [className || 'editor-canvas-preview editor-canvas-interactive'].filter(Boolean).join(' ');

  return (
    <canvas
      ref={canvasRef}
      className={canvasClass}
      onMouseDown={handleMouseDown}
      onMouseMove={handleHover}
      style={disabled ? { cursor: 'not-allowed' } : undefined}
    />
  );
}
