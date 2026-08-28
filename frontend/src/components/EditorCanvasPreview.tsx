import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';
import {
  drawEditorComposite,
  fitLayerToBg,
  resetLayerToOriginalSize,
  resolveLayerBox,
} from '../utils/editorComposite';
import Icon from '../icons/Icon';

/** Canvas-space gutter around the BG frame so handles stay reachable when a transform goes outside it. */
const PAD = 56;
const MIN_SCALE = 0.02;
const MAX_SCALE = 8;

function _getConnectedImageSrc(
  nodeId: string,
  handleId: string,
  edges: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
): string | null {
  return getConnectedImageDataUrl(nodeId, handleId, edges, allNodes);
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

/** Layer corners in canvas space, i.e. already including the viewport offset/scale. */
function _getLayerCorners(cfg: any, w: number, h: number, s: number, ox: number, oy: number) {
  const rad = ((cfg.rotation || 0) * Math.PI) / 180;
  const cx = ox + cfg.x * s;
  const cy = oy + cfg.y * s;
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

function _drawCheckerboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell = 12) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#27272a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3f3f46';
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 === 0) continue;
      ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
    }
  }
  ctx.restore();
}

export default function EditorCanvasPreview({
  nodeId,
  data,
  selectedLayer: selectedLayerProp,
  onSelectLayer,
  maxPreviewWidth = 252,
  maxPreviewHeight = 560,
  disabled = false,
  className,
}: {
  nodeId: string;
  data: Record<string, any>;
  selectedLayer?: number | null;
  onSelectLayer?: (layer: number | null) => void;
  maxPreviewWidth?: number;
  maxPreviewHeight?: number;
  disabled?: boolean;
  className?: string;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportElRef = useRef<HTMLDivElement>(null);

  const layerCount = (data.layerCount as number) || 0;
  const layers = (data.layers as Record<string, any>) || {};
  const bgHidden = Boolean(data.bgHidden);

  const isControlled = selectedLayerProp !== undefined;
  const [uncontrolledSel, _setUncontrolledSel] = useState<number | null>(null);
  const selectedLayer = isControlled ? (selectedLayerProp as number | null) : uncontrolledSel;
  const selRef = useRef<number | null>(selectedLayer);
  selRef.current = selectedLayer;
  const setSel = useCallback(
    (v: number | null) => {
      selRef.current = v;
      if (onSelectLayer) onSelectLayer(v);
      if (!isControlled) _setUncontrolledSel(v);
    },
    [isControlled, onSelectLayer],
  );

  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [zoomPercent, setZoomPercent] = useState(100);
  const viewportRef = useRef({ s: 1, ox: PAD, oy: PAD });
  const modsRef = useRef({ shift: false, alt: false });

  // The `maxPreviewWidth/Height` props are only an initial guess (the parent's own
  // resize observer). We measure the actual viewport box ourselves so canvas sizing
  // is exact regardless of how much room the toolbar row above it ends up taking.
  const [measured, setMeasured] = useState({ w: maxPreviewWidth, h: maxPreviewHeight });
  useEffect(() => {
    const el = viewportElRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setMeasured({ w: rect.width, h: rect.height });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dragRef = useRef({
    active: false,
    mode: 'none',
    startMx: 0,
    startMy: 0,
    lastMx: 0,
    lastMy: 0,
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

  // Auto-fit on connect also runs headlessly in `useEditorPreviewBake` (so the node
  // thumbnail is correct even with the modal closed). This modal has its own
  // `images` state loaded independently, so if it renders before that bake commits
  // the fitted values, fall back to `resolveLayerBox`'s live contain-fit for drawing
  // — the store is authoritative once the bake writes real width/height.

  const draw = useCallback(
    (lc: Record<string, any>, sel: number | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const bgImg = images.bgLayer;
      // The canvas always fills the whole available pane, so the area around the
      // BG frame stays part of the canvas: a layer dragged outside the frame is
      // clipped out of the composite, but its transform box (and its click/drag
      // hit area) remains on-canvas and usable out here.
      const cw = Math.max(80, Math.floor(measured.w));
      const ch = Math.max(80, Math.floor(measured.h));
      canvas.width = cw;
      canvas.height = ch;

      if (!bgImg) {
        ctx.fillStyle = '#1e1e21';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = '#71717a';
        ctx.font = '12px Fredoka, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Connect a BG Layer', cw / 2, ch / 2 + 4);
        return;
      }
      const bgW = bgImg.naturalWidth;
      const bgH = bgImg.naturalHeight;
      const s = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min((cw - 2 * PAD) / bgW, (ch - 2 * PAD) / bgH)),
      );
      const frameW = bgW * s;
      const frameH = bgH * s;
      const ox = Math.round((cw - frameW) / 2);
      const oy = Math.round((ch - frameH) / 2);
      viewportRef.current = { s, ox, oy };
      setZoomPercent(Math.round(s * 100));

      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, cw, ch);

      if (bgHidden) {
        _drawCheckerboard(ctx, ox, oy, frameW, frameH);
      }

      drawEditorComposite(ctx, {
        bgImg,
        bgW,
        bgH,
        bgHidden,
        layerCount,
        layers: lc,
        images,
        scale: s,
        offsetX: ox,
        offsetY: oy,
      });

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(ox + 0.5, oy + 0.5, frameW - 1, frameH - 1);
      ctx.restore();

      if (sel !== null && images[`layer${sel}`]) {
        const key = `layer${sel}`;
        const img = images[key]!;
        const cfg = lc[key] || { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false };
        if (!cfg.hidden) {
          const box = resolveLayerBox(cfg, img, bgW, bgH);
          const corners = _getLayerCorners(box, box.w, box.h, s, ox, oy);
          const rad = (box.rotation * Math.PI) / 180;

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
      }
    },
    [images, layerCount, measured.w, measured.h, bgHidden],
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
      if (cfg.hidden) return false;
      const { s, ox, oy } = viewportRef.current;
      const box = resolveLayerBox(cfg, img, images.bgLayer?.naturalWidth || 0, images.bgLayer?.naturalHeight || 0);
      const rad = (box.rotation * Math.PI) / 180;
      const dx = px - (ox + box.x * s);
      const dy = py - (oy + box.y * s);
      const lx = dx * Math.cos(-rad) - dy * Math.sin(-rad);
      const ly = dx * Math.sin(-rad) + dy * Math.cos(-rad);
      return Math.abs(lx) <= (box.w * s) / 2 && Math.abs(ly) <= (box.h * s) / 2;
    },
    [images, layers],
  );

  const handleFitSelected = useCallback(() => {
    const sel = selRef.current;
    if (sel === null) return;
    const key = `layer${sel}`;
    const img = images[key];
    const bgImg = images.bgLayer;
    if (!img || !bgImg) return;
    const updated = { ...layers, [key]: fitLayerToBg(layers[key] || {}, img, bgImg.naturalWidth, bgImg.naturalHeight) };
    updateNodeData(nodeId, { layers: updated });
  }, [images, layers, nodeId, updateNodeData]);

  const handleResetSelected = useCallback(() => {
    const sel = selRef.current;
    if (sel === null) return;
    const key = `layer${sel}`;
    const img = images[key];
    if (!img) return;
    const updated = { ...layers, [key]: resetLayerToOriginalSize(layers[key] || {}, img) };
    updateNodeData(nodeId, { layers: updated });
  }, [images, layers, nodeId, updateNodeData]);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      const { x, y } = getCoords(e.clientX, e.clientY);
      const { s, ox, oy } = viewportRef.current;
      const sel = selRef.current;

      if (sel !== null && images[`layer${sel}`]) {
        const key = `layer${sel}`;
        const img = images[key]!;
        const cfg = layers[key] || {};
        if (!cfg.hidden) {
          const box = resolveLayerBox(cfg, img, images.bgLayer?.naturalWidth || 0, images.bgLayer?.naturalHeight || 0);
          const corners = _getLayerCorners(box, box.w, box.h, s, ox, oy);
          const rad = (box.rotation * Math.PI) / 180;

          const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
          const rh = { x: topMid.x + 18 * Math.sin(rad), y: topMid.y - 18 * Math.cos(rad) };
          if (near(x, y, rh.x, rh.y, 10)) {
            startDrag('rotate', { ...cfg, x: box.x, y: box.y, width: box.w, height: box.h }, x, y);
            return;
          }

          const cNames = ['scale-tl', 'scale-tr', 'scale-br', 'scale-bl'];
          for (let j = 0; j < 4; j++) {
            if (near(x, y, corners[j].x, corners[j].y)) {
              startDrag(cNames[j], { ...cfg, x: box.x, y: box.y, width: box.w, height: box.h }, x, y);
              return;
            }
          }

          const eNames = ['scale-t', 'scale-r', 'scale-b', 'scale-l'];
          for (let j = 0; j < 4; j++) {
            const n = (j + 1) % 4;
            const mx = (corners[j].x + corners[n].x) / 2;
            const my = (corners[j].y + corners[n].y) / 2;
            if (near(x, y, mx, my)) {
              startDrag(eNames[j], { ...cfg, x: box.x, y: box.y, width: box.w, height: box.h }, x, y);
              return;
            }
          }
        }
      }

      for (let i = layerCount; i >= 1; i--) {
        if (ptInLayer(x, y, i)) {
          setSel(i);
          const img = images[`layer${i}`]!;
          const cfg = layers[`layer${i}`] || {};
          const box = resolveLayerBox(cfg, img, images.bgLayer?.naturalWidth || 0, images.bgLayer?.naturalHeight || 0);
          startDrag('move', { ...cfg, x: box.x, y: box.y, width: box.w, height: box.h }, x, y);
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
        d.lastMx = mx;
        d.lastMy = my;
        d.startCfg = { ...cfg };
        d.localLayers = { ...layers };
        modsRef.current = { shift: e.shiftKey, alt: e.altKey };

        const runTransform = (cx: number, cy: number) => {
          const { s: s2, ox: ox2, oy: oy2 } = viewportRef.current;
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
          const { shift, alt } = modsRef.current;

          if (d.mode === 'move') {
            newCfg.x = sc.x + (cx - d.startMx) / s2;
            newCfg.y = sc.y + (cy - d.startMy) / s2;
          } else if (d.mode === 'rotate') {
            const centerX = ox2 + sc.x * s2;
            const centerY = oy2 + sc.y * s2;
            const a0 = Math.atan2(d.startMy - centerY, d.startMx - centerX);
            const a1 = Math.atan2(cy - centerY, cx - centerX);
            let rotation = ((sc.rotation || 0) + ((a1 - a0) * 180) / Math.PI + 360) % 360;
            if (shift) rotation = (Math.round(rotation / 45) * 45 + 360) % 360;
            newCfg.rotation = rotation;
          } else if (d.mode.startsWith('scale-')) {
            const rad2 = ((sc.rotation || 0) * Math.PI) / 180;
            const anchor = HANDLE_ANCHORS[d.mode];
            if (!anchor) return;

            let aImgX: number;
            let aImgY: number;
            if (alt) {
              aImgX = sc.x;
              aImgY = sc.y;
            } else {
              const alx = (anchor.lx * startW) / 2;
              const aly = (anchor.ly * startH) / 2;
              const aRot = _rotPt(alx, aly, rad2);
              aImgX = sc.x + aRot.x;
              aImgY = sc.y + aRot.y;
            }

            // World-space mouse in image coords (undo the viewport's scale + gutter offset).
            const mImgX = (cx - ox2) / s2;
            const mImgY = (cy - oy2) / s2;

            const dx = mImgX - aImgX;
            const dy = mImgY - aImgY;
            const ldx = dx * Math.cos(-rad2) - dy * Math.sin(-rad2);
            const ldy = dx * Math.sin(-rad2) + dy * Math.cos(-rad2);

            // Alt anchors at the center, so the anchor-to-mouse distance is only half
            // the new size (vs. a full edge-to-edge distance for the normal anchor).
            const altMul = alt ? 2 : 1;
            let rawW = anchor.sw ? Math.max(10, Math.abs(ldx) * altMul) : startW;
            let rawH = anchor.sh ? Math.max(10, Math.abs(ldy) * altMul) : startH;

            if (shift) {
              if (anchor.sw && anchor.sh) {
                const kk = Math.max(rawW / startW, rawH / startH);
                rawW = startW * kk;
                rawH = startH * kk;
              } else if (anchor.sw) {
                rawH = startH * (rawW / startW);
              } else if (anchor.sh) {
                rawW = startW * (rawH / startH);
              }
            }

            const nw = Math.max(10, Math.round(rawW));
            const nh = Math.max(10, Math.round(rawH));

            if (alt) {
              newCfg.x = Math.round(aImgX);
              newCfg.y = Math.round(aImgY);
            } else {
              const nlx = anchor.lx !== 0 ? (Math.sign(anchor.lx) * nw) / 2 : 0;
              const nly = anchor.ly !== 0 ? (Math.sign(anchor.ly) * nh) / 2 : 0;
              const nRot = _rotPt(nlx, nly, rad2);
              newCfg.x = Math.round(aImgX - nRot.x);
              newCfg.y = Math.round(aImgY - nRot.y);
            }
            newCfg.width = nw;
            newCfg.height = nh;
          }

          updated[k] = newCfg;
          d.localLayers = updated;
          draw(updated, selI);
        };

        const onMove = (ev: MouseEvent) => {
          if (!d.active) return;
          const { x: cx, y: cy } = getCoords(ev.clientX, ev.clientY);
          d.lastMx = cx;
          d.lastMy = cy;
          modsRef.current = { shift: ev.shiftKey, alt: ev.altKey };
          runTransform(cx, cy);
        };

        const onKeyChange = (ev: KeyboardEvent) => {
          if (!d.active) return;
          if (ev.key !== 'Shift' && ev.key !== 'Alt') return;
          const down = ev.type === 'keydown';
          if (ev.key === 'Shift') modsRef.current.shift = down;
          if (ev.key === 'Alt') {
            modsRef.current.alt = down;
            ev.preventDefault();
          }
          runTransform(d.lastMx, d.lastMy);
        };

        const onUp = () => {
          if (d.active) {
            d.active = false;
            updateNodeData(nodeId, { layers: d.localLayers });
          }
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('keydown', onKeyChange);
          window.removeEventListener('keyup', onKeyChange);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('keydown', onKeyChange);
        window.addEventListener('keyup', onKeyChange);
      }
    },
    [disabled, getCoords, images, layers, layerCount, ptInLayer, draw, updateNodeData, nodeId, setSel],
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
      const { s, ox, oy } = viewportRef.current;
      const sel = selRef.current;

      if (sel !== null && images[`layer${sel}`]) {
        const key = `layer${sel}`;
        const img = images[key]!;
        const cfg = layers[key] || {};
        if (!cfg.hidden) {
          const box = resolveLayerBox(cfg, img, images.bgLayer?.naturalWidth || 0, images.bgLayer?.naturalHeight || 0);
          const corners = _getLayerCorners(box, box.w, box.h, s, ox, oy);
          const rad = (box.rotation * Math.PI) / 180;

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

  const hasSelection = selectedLayer !== null && selectedLayer !== undefined;

  return (
    <div className="editor-canvas-outer">
      <div className="editor-canvas-toolbar">
        <div className="editor-canvas-toolbar-actions">
          <button
            type="button"
            className="editor-canvas-fit-btn"
            disabled={disabled || !hasSelection}
            onClick={handleFitSelected}
            title="Scale the selected layer to fit inside the BG"
          >
            <Icon name="fullscreen-line" size={12} />
            Fit to BG
          </button>
          <button
            type="button"
            className="editor-canvas-fit-btn"
            disabled={disabled || !hasSelection}
            onClick={handleResetSelected}
            title="Reset the selected layer to its original image size and ratio"
          >
            <Icon name="scale-line" size={12} />
            Reset
          </button>
        </div>
        <span className="editor-canvas-zoom">{zoomPercent}%</span>
      </div>
      <div className="editor-canvas-viewport" ref={viewportElRef}>
        <canvas
          ref={canvasRef}
          className={canvasClass}
          onMouseDown={handleMouseDown}
          onMouseMove={handleHover}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            verticalAlign: 'top',
            ...(disabled ? { cursor: 'not-allowed' } : {}),
          }}
        />
      </div>
    </div>
  );
}
