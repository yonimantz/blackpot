import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { MAX_COMPOSITOR_LAYERS } from '../types/nodeTypes';
import {
  createCompositorLayer,
  distPointSegment,
  drawCompositorLayers,
  pointInRotatedSquare,
  pointInTriangle,
  squareCornersWorld,
  squareRotateHandleWorld,
} from '../compositor/compositorUtils';

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

function worldToSquareLocal(px: number, py: number, cx: number, cy: number, rotDeg: number) {
  const rad = (rotDeg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return {
    lx: dx * Math.cos(rad) - dy * Math.sin(rad),
    ly: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** Shortest turn from prevRad to currRad (both from Math.atan2); avoids ±π jumps when dragging. */
function deltaAngleRad(prevRad: number, currRad: number): number {
  let d = currRad - prevRad;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

const HIT = 12;

function pointInRotatedTextBox(
  px: number,
  py: number,
  x: number,
  y: number,
  tw: number,
  th: number,
  rotDeg: number,
  pad: number,
) {
  const rad = (rotDeg * Math.PI) / 180;
  const pts = [
    { lx: -pad, ly: -pad },
    { lx: tw + pad, ly: -pad },
    { lx: tw + pad, ly: th + pad },
    { lx: -pad, ly: th + pad },
  ];
  const wxy = pts.map(({ lx, ly }) => ({
    x: x + lx * Math.cos(rad) + ly * Math.sin(rad),
    y: y - lx * Math.sin(rad) + ly * Math.cos(rad),
  }));
  return (
    pointInTriangle(px, py, wxy[0].x, wxy[0].y, wxy[1].x, wxy[1].y, wxy[2].x, wxy[2].y) ||
    pointInTriangle(px, py, wxy[0].x, wxy[0].y, wxy[2].x, wxy[2].y, wxy[3].x, wxy[3].y)
  );
}

type DragState =
  | { kind: 'none' }
  | { kind: 'line_p1'; idx: number; ox: number; oy: number }
  | { kind: 'line_p2'; idx: number; ox: number; oy: number }
  | { kind: 'line_body'; idx: number; sx1: number; sy1: number; sx2: number; sy2: number; gx: number; gy: number }
  | { kind: 'circle_center'; idx: number; ocx: number; ocy: number; gx: number; gy: number }
  | { kind: 'circle_radius'; idx: number; ocx: number; ocy: number; or: number }
  | {
      kind: 'square_move';
      idx: number;
      ox: number;
      oy: number;
      gx: number;
      gy: number;
    }
  | { kind: 'square_corner'; idx: number; corner: number; ocx: number; ocy: number; ow: number; oh: number; rot: number }
  | {
      kind: 'square_rotate';
      idx: number;
      ocx: number;
      ocy: number;
      lastMx: number;
      lastMy: number;
      accDeg: number;
      baseRot: number;
    }
  | { kind: 'tri_v'; idx: number; v: 0 | 1 | 2 }
  | { kind: 'tri_body'; idx: number; ox1: number; oy1: number; ox2: number; oy2: number; ox3: number; oy3: number; gx: number; gy: number }
  | { kind: 'text_move'; idx: number; ox: number; oy: number; gx: number; gy: number }
  | { kind: 'text_scale'; idx: number; ofs: number; osize: number }
  | {
      kind: 'text_rotate';
      idx: number;
      ox: number;
      oy: number;
      lastAng: number;
      accDeg: number;
      baseRot: number;
    };

export default function CompositorModal({
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
  const cw = Math.max(1, Math.min(8192, Number(data.width) || 512));
  const ch = Math.max(1, Math.min(8192, Number(data.height) || 512));
  const layers = (Array.isArray(data.layers) ? data.layers : []) as Record<string, any>[];
  const guideOpts = useMemo(
    () => ({
      ruleOfThirds: Boolean(data.guideRuleOfThirds),
      grid2080: Boolean(data.guideGrid2080),
      cross: Boolean(data.guideCross),
      goldenRatio: Boolean(data.guideGoldenRatio),
    }),
    [data.guideRuleOfThirds, data.guideGrid2080, data.guideCross, data.guideGoldenRatio],
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scaleRef = useRef(1);
  const dragRef = useRef<DragState>({ kind: 'none' });
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [localLayers, setLocalLayers] = useState<Record<string, any>[]>(layers);
  const localLayersRef = useRef(localLayers);

  useEffect(() => {
    localLayersRef.current = localLayers;
  }, [localLayers]);

  useEffect(() => {
    if (!open) return;
    setLocalLayers(Array.isArray(data.layers) ? [...(data.layers as any[])] : []);
    setSelectedIndex(null);
  }, [open, nodeId]);

  useEffect(() => {
    if (!open) return;
    const src = _getConnectedImageSrc(nodeId, 'background', edges, nodes);
    if (!src) {
      setBgImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.onerror = () => setBgImg(null);
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [open, edges, nodes, nodeId, data.width, data.height]);

  const commitLayers = useCallback(
    (next: Record<string, any>[]) => {
      setLocalLayers(next);
      updateNodeData(nodeId, { layers: next });
    },
    [nodeId, updateNodeData],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const maxDim = Math.min(960, typeof window !== 'undefined' ? window.innerWidth - 120 : 960, typeof window !== 'undefined' ? window.innerHeight - 220 : 960);
    const s = Math.min(maxDim / cw, maxDim / ch);
    scaleRef.current = s;
    drawCompositorLayers(ctx, cw, ch, s, localLayers, bgImg, {
      selectedIndex,
      showHandles: true,
      guides: guideOpts,
    });
  }, [cw, ch, localLayers, bgImg, selectedIndex, guideOpts]);

  useEffect(() => {
    if (!open) return;
    draw();
  }, [open, draw]);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * cw,
        y: ((clientY - rect.top) / rect.height) * ch,
      };
    },
    [cw, ch],
  );

  const hitTest = useCallback(
    (wx: number, wy: number): { idx: number; part: string; corner?: number } | null => {
      const L = localLayersRef.current;
      for (let idx = L.length - 1; idx >= 0; idx--) {
        const layer = L[idx];
        if (!layer) continue;
        const kind = String(layer.kind || '').toLowerCase();

        if (kind === 'line') {
          const x1 = Number(layer.x1),
            y1 = Number(layer.y1),
            x2 = Number(layer.x2),
            y2 = Number(layer.y2);
          if (Math.hypot(wx - x1, wy - y1) <= HIT) return { idx, part: 'p1' };
          if (Math.hypot(wx - x2, wy - y2) <= HIT) return { idx, part: 'p2' };
          const d = distPointSegment(wx, wy, x1, y1, x2, y2);
          const sw = Math.max(1, Number(layer.strokeWidth) || 2);
          if (d <= Math.max(HIT, sw + 6)) return { idx, part: 'body' };
        }

        if (kind === 'circle') {
          const cx = Number(layer.cx),
            cy = Number(layer.cy),
            r = Number(layer.r) || 1;
          if (Math.hypot(wx - (cx + r), wy - cy) <= HIT) return { idx, part: 'radius' };
          if (Math.hypot(wx - cx, wy - cy) <= HIT) return { idx, part: 'center' };
          if (Math.hypot(wx - cx, wy - cy) <= r) return { idx, part: 'body' };
        }

        if (kind === 'square') {
          const x = Number(layer.x),
            y = Number(layer.y),
            w = Math.max(1, Number(layer.w) || 1),
            h = Math.max(1, Number(layer.h) || 1),
            rot = Number(layer.rotation) || 0;
          const corners = squareCornersWorld(x, y, w, h, rot);
          for (let c = 0; c < 4; c++) {
            if (Math.hypot(wx - corners[c].x, wy - corners[c].y) <= HIT) return { idx, part: 'corner', corner: c };
          }
          const rh = squareRotateHandleWorld(x, y, w, h, rot);
          if (Math.hypot(wx - rh.x, wy - rh.y) <= HIT) return { idx, part: 'rotate' };
          if (pointInRotatedSquare(wx, wy, x, y, w, h, rot)) return { idx, part: 'body' };
        }

        if (kind === 'triangle') {
          const x1 = Number(layer.x1),
            y1 = Number(layer.y1),
            x2 = Number(layer.x2),
            y2 = Number(layer.y2),
            x3 = Number(layer.x3),
            y3 = Number(layer.y3);
          if (Math.hypot(wx - x1, wy - y1) <= HIT) return { idx, part: 'v0' };
          if (Math.hypot(wx - x2, wy - y2) <= HIT) return { idx, part: 'v1' };
          if (Math.hypot(wx - x3, wy - y3) <= HIT) return { idx, part: 'v2' };
          if (pointInTriangle(wx, wy, x1, y1, x2, y2, x3, y3)) return { idx, part: 'body' };
        }

        if (kind === 'text') {
          const x = Number(layer.x),
            y = Number(layer.y),
            fs = Math.max(8, Math.min(256, Number(layer.fontSize) || 16)),
            rot = Number(layer.rotation) || 0,
            txt = String(layer.text ?? '');
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.font = `${fs}px system-ui, sans-serif`;
            const tw = ctx.measureText(txt).width;
            const th = fs;
            const pad = 4;
            const corners = [
              { lx: -pad, ly: -pad },
              { lx: tw + pad, ly: -pad },
              { lx: tw + pad, ly: th + pad },
              { lx: -pad, ly: th + pad },
            ];
            const rad = (rot * Math.PI) / 180;
            for (let i = 0; i < corners.length; i++) {
              const { lx, ly } = corners[i];
              const hx = x + lx * Math.cos(rad) + ly * Math.sin(rad);
              const hy = y - lx * Math.sin(rad) + ly * Math.cos(rad);
              if (Math.hypot(wx - hx, wy - hy) <= HIT) {
                if (i === 0) return { idx, part: 'text_rot' };
                if (i === 2) return { idx, part: 'text_scale' };
              }
            }
            if (pointInRotatedTextBox(wx, wy, x, y, tw, th, rot, pad)) return { idx, part: 'body' };
          }
        }
      }
      return null;
    },
    [],
  );

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      if (isRunning) return;
      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);
      const hit = hitTest(wx, wy);
      if (!hit) {
        setSelectedIndex(null);
        dragRef.current = { kind: 'none' };
        return;
      }
      setSelectedIndex(hit.idx);
      const L = localLayersRef.current;
      const layer = L[hit.idx];
      const kind = String(layer.kind || '').toLowerCase();

      if (kind === 'line') {
        if (hit.part === 'p1')
          dragRef.current = { kind: 'line_p1', idx: hit.idx, ox: wx, oy: wy };
        else if (hit.part === 'p2')
          dragRef.current = { kind: 'line_p2', idx: hit.idx, ox: wx, oy: wy };
        else
          dragRef.current = {
            kind: 'line_body',
            idx: hit.idx,
            sx1: Number(layer.x1),
            sy1: Number(layer.y1),
            sx2: Number(layer.x2),
            sy2: Number(layer.y2),
            gx: wx,
            gy: wy,
          };
      } else if (kind === 'circle') {
        if (hit.part === 'radius')
          dragRef.current = {
            kind: 'circle_radius',
            idx: hit.idx,
            ocx: Number(layer.cx),
            ocy: Number(layer.cy),
            or: Number(layer.r) || 1,
          };
        else
          dragRef.current = {
            kind: 'circle_center',
            idx: hit.idx,
            ocx: Number(layer.cx),
            ocy: Number(layer.cy),
            gx: wx,
            gy: wy,
          };
      } else if (kind === 'square') {
        const x = Number(layer.x),
          y = Number(layer.y),
          w = Math.max(1, Number(layer.w) || 1),
          h = Math.max(1, Number(layer.h) || 1),
          rot = Number(layer.rotation) || 0;
        const cx = x + w / 2,
          cy = y + h / 2;
        if (hit.part === 'corner' && hit.corner !== undefined)
          dragRef.current = {
            kind: 'square_corner',
            idx: hit.idx,
            corner: hit.corner,
            ocx: cx,
            ocy: cy,
            ow: w,
            oh: h,
            rot,
          };
        else if (hit.part === 'rotate') {
          dragRef.current = {
            kind: 'square_rotate',
            idx: hit.idx,
            ocx: cx,
            ocy: cy,
            lastMx: wx,
            lastMy: wy,
            accDeg: 0,
            baseRot: rot,
          };
        } else
          dragRef.current = {
            kind: 'square_move',
            idx: hit.idx,
            ox: x,
            oy: y,
            gx: wx,
            gy: wy,
          };
      } else if (kind === 'triangle') {
        if (hit.part === 'v0') dragRef.current = { kind: 'tri_v', idx: hit.idx, v: 0 };
        else if (hit.part === 'v1') dragRef.current = { kind: 'tri_v', idx: hit.idx, v: 1 };
        else if (hit.part === 'v2') dragRef.current = { kind: 'tri_v', idx: hit.idx, v: 2 };
        else
          dragRef.current = {
            kind: 'tri_body',
            idx: hit.idx,
            ox1: Number(layer.x1),
            oy1: Number(layer.y1),
            ox2: Number(layer.x2),
            oy2: Number(layer.y2),
            ox3: Number(layer.x3),
            oy3: Number(layer.y3),
            gx: wx,
            gy: wy,
          };
      } else if (kind === 'text') {
        if (hit.part === 'text_scale') {
          const fs = Math.max(8, Math.min(256, Number(layer.fontSize) || 16));
          const rot = Number(layer.rotation) || 0;
          const txt = String(layer.text ?? '');
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          let tw = fs * 4;
          if (ctx) {
            ctx.font = `${fs}px system-ui, sans-serif`;
            tw = ctx.measureText(txt).width;
          }
          const th = fs;
          const pad = 4;
          const rad = (rot * Math.PI) / 180;
          const lx = tw + pad,
            ly = th + pad;
          const bx = Number(layer.x) + lx * Math.cos(rad) + ly * Math.sin(rad);
          const by = Number(layer.y) - lx * Math.sin(rad) + ly * Math.cos(rad);
          dragRef.current = {
            kind: 'text_scale',
            idx: hit.idx,
            ofs: Math.hypot(bx - Number(layer.x), by - Number(layer.y)) || 1,
            osize: fs,
          };
        } else if (hit.part === 'text_rot') {
          const ox = Number(layer.x),
            oy = Number(layer.y);
          const ang = Math.atan2(wy - oy, wx - ox);
          dragRef.current = {
            kind: 'text_rotate',
            idx: hit.idx,
            ox,
            oy,
            lastAng: ang,
            accDeg: 0,
            baseRot: Number(layer.rotation) || 0,
          };
        } else
          dragRef.current = {
            kind: 'text_move',
            idx: hit.idx,
            ox: Number(layer.x),
            oy: Number(layer.y),
            gx: wx,
            gy: wy,
          };
      }

      const onMove = (ev: MouseEvent) => {
        const d = dragRef.current;
        if (d.kind === 'none') return;
        const { x: mx, y: my } = clientToWorld(ev.clientX, ev.clientY);
        const next = [...localLayersRef.current];

        if (d.kind === 'line_p1') {
          next[d.idx] = { ...next[d.idx], x1: mx, y1: my };
        } else if (d.kind === 'line_p2') {
          next[d.idx] = { ...next[d.idx], x2: mx, y2: my };
        } else if (d.kind === 'line_body') {
          const dx = mx - d.gx,
            dy = my - d.gy;
          next[d.idx] = {
            ...next[d.idx],
            x1: d.sx1 + dx,
            y1: d.sy1 + dy,
            x2: d.sx2 + dx,
            y2: d.sy2 + dy,
          };
        } else if (d.kind === 'circle_center') {
          const dx = mx - d.gx,
            dy = my - d.gy;
          next[d.idx] = { ...next[d.idx], cx: d.ocx + dx, cy: d.ocy + dy };
        } else if (d.kind === 'circle_radius') {
          const r = Math.max(4, Math.hypot(mx - d.ocx, my - d.ocy));
          next[d.idx] = { ...next[d.idx], cx: d.ocx, cy: d.ocy, r };
        } else if (d.kind === 'square_move') {
          const dx = mx - d.gx,
            dy = my - d.gy;
          next[d.idx] = { ...next[d.idx], x: d.ox + dx, y: d.oy + dy };
        } else if (d.kind === 'square_corner') {
          const { lx, ly } = worldToSquareLocal(mx, my, d.ocx, d.ocy, d.rot);
          const signs: [number, number][] = [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ];
          const [sx, sy] = signs[d.corner];
          const newHw = Math.max(4, sx * lx);
          const newHh = Math.max(4, sy * ly);
          const w2 = 2 * newHw,
            h2 = 2 * newHh;
          next[d.idx] = {
            ...next[d.idx],
            x: d.ocx - newHw,
            y: d.ocy - newHh,
            w: w2,
            h: h2,
          };
        } else if (d.kind === 'square_rotate') {
          const vx0 = d.lastMx - d.ocx;
          const vy0 = d.lastMy - d.ocy;
          const vx1 = mx - d.ocx;
          const vy1 = my - d.ocy;
          const cross = vx0 * vy1 - vy0 * vx1;
          const dot = vx0 * vx1 + vy0 * vy1;
          const dRad = Math.atan2(cross, dot);
          const accDeg = d.accDeg + (dRad * 180) / Math.PI;
          dragRef.current = { ...d, lastMx: mx, lastMy: my, accDeg };
          let rot = d.baseRot + accDeg;
          rot = ((rot % 360) + 360) % 360;
          const cur = next[d.idx];
          const w = Number(cur.w) || 1,
            h = Number(cur.h) || 1;
          next[d.idx] = { ...cur, rotation: rot, x: d.ocx - w / 2, y: d.ocy - h / 2 };
        } else if (d.kind === 'tri_v') {
          const k = d.v === 0 ? 'x1' : d.v === 1 ? 'x2' : 'x3';
          const ky = d.v === 0 ? 'y1' : d.v === 1 ? 'y2' : 'y3';
          next[d.idx] = { ...next[d.idx], [k]: mx, [ky]: my };
        } else if (d.kind === 'tri_body') {
          const dx = mx - d.gx,
            dy = my - d.gy;
          next[d.idx] = {
            ...next[d.idx],
            x1: d.ox1 + dx,
            y1: d.oy1 + dy,
            x2: d.ox2 + dx,
            y2: d.oy2 + dy,
            x3: d.ox3 + dx,
            y3: d.oy3 + dy,
          };
        } else if (d.kind === 'text_move') {
          const dx = mx - d.gx,
            dy = my - d.gy;
          next[d.idx] = { ...next[d.idx], x: d.ox + dx, y: d.oy + dy };
        } else         if (d.kind === 'text_scale') {
          const ox = Number(next[d.idx].x),
            oy = Number(next[d.idx].y);
          const dist = Math.hypot(mx - ox, my - oy);
          const ratio = dist / Math.max(1e-6, d.ofs);
          const fs = Math.max(8, Math.min(256, Math.round(d.osize * ratio)));
          next[d.idx] = { ...next[d.idx], fontSize: fs };
        } else if (d.kind === 'text_rotate') {
          const ang = Math.atan2(my - d.oy, mx - d.ox);
          const dRad = deltaAngleRad(d.lastAng, ang);
          const accDeg = d.accDeg + (dRad * 180) / Math.PI;
          dragRef.current = { ...d, lastAng: ang, accDeg };
          let rot = d.baseRot + accDeg;
          rot = ((rot % 360) + 360) % 360;
          next[d.idx] = { ...next[d.idx], rotation: rot };
        }

        localLayersRef.current = next;
        setLocalLayers(next);
        const c = canvasRef.current;
        const ctx = c?.getContext('2d');
        if (ctx)
          drawCompositorLayers(ctx, cw, ch, scaleRef.current, next, bgImg, {
            selectedIndex: d.idx,
            showHandles: true,
            guides: guideOpts,
          });
      };

      const onUp = () => {
        dragRef.current = { kind: 'none' };
        commitLayers(localLayersRef.current);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [clientToWorld, hitTest, isRunning, cw, ch, bgImg, commitLayers, guideOpts],
  );

  const addKind = (kind: string) => {
    if (isRunning || localLayers.length >= MAX_COMPOSITOR_LAYERS) return;
    commitLayers([...localLayers, createCompositorLayer(kind, cw, ch)]);
  };

  const removeAt = (idx: number) => {
    if (isRunning) return;
    const next = localLayers.filter((_, i) => i !== idx);
    commitLayers(next);
    if (selectedIndex === idx) setSelectedIndex(null);
    else if (selectedIndex !== null && selectedIndex > idx) setSelectedIndex(selectedIndex - 1);
  };

  const patchLayer = (idx: number, patch: Record<string, any>) => {
    const next = localLayers.map((L, i) => (i === idx ? { ...L, ...patch } : L));
    commitLayers(next);
  };

  if (!open || !node) return null;

  const maxDim = Math.min(960, window.innerWidth - 120, window.innerHeight - 220);
  const s = Math.min(maxDim / cw, maxDim / ch);
  const vw = Math.round(cw * s);
  const vh = Math.round(ch * s);

  return (
    <div
      className="compositor-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compositor-modal" role="dialog" aria-labelledby="compositor-modal-title">
        <div className="compositor-modal-header">
          <h2 id="compositor-modal-title">Compositor</h2>
          <button type="button" className="compositor-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Drag shapes on the canvas. Line: endpoints. Square: corners, rotate handle. Text: top-left rotate, bottom-right scale.
            </p>
            <label className="inspector-label">Canvas (px)</label>
            <div className="editor-field-row" style={{ marginBottom: 10 }}>
              <input
                className="inspector-input"
                type="number"
                min={1}
                max={8192}
                value={cw}
                disabled={isRunning}
                onChange={(e) =>
                  updateNodeData(nodeId, { width: Math.max(1, Math.min(8192, parseInt(e.target.value, 10) || 1)) })
                }
              />
              <span style={{ opacity: 0.6 }}>×</span>
              <input
                className="inspector-input"
                type="number"
                min={1}
                max={8192}
                value={ch}
                disabled={isRunning}
                onChange={(e) =>
                  updateNodeData(nodeId, { height: Math.max(1, Math.min(8192, parseInt(e.target.value, 10) || 1)) })
                }
              />
            </div>
            <label className="inspector-label">Add shape</label>
            <div className="compositor-modal-add-row">
              {(['line', 'circle', 'square', 'triangle', 'text'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="inspector-btn-small"
                  disabled={isRunning || localLayers.length >= MAX_COMPOSITOR_LAYERS}
                  onClick={() => addKind(k)}
                >
                  + {k}
                </button>
              ))}
            </div>
            <div className="inspector-empty-small">{localLayers.length}/{MAX_COMPOSITOR_LAYERS} layers</div>
            <label className="inspector-label">Composition guides</label>
            <div className="compositor-guide-toggles">
              {(
                [
                  ['guideRuleOfThirds', 'Rule of thirds'],
                  ['guideGrid2080', '20:80 grid'],
                  ['guideCross', 'Cross (diagonals)'],
                  ['guideGoldenRatio', 'Golden ratio'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="compositor-guide-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(data[key])}
                    disabled={isRunning}
                    onChange={(e) => updateNodeData(nodeId, { [key]: e.target.checked })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <label className="inspector-label">Layers</label>
            <ul className="compositor-modal-layer-list">
              {localLayers.map((layer, idx) => {
                const kind = String(layer.kind || '?');
                const colorVal = /^#[0-9a-fA-F]{6}$/.test(String(layer.color)) ? String(layer.color) : '#6366f1';
                return (
                  <li
                    key={String(layer.id ?? idx)}
                    className={`compositor-modal-layer-item ${selectedIndex === idx ? 'selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="compositor-modal-layer-select"
                      onClick={() => setSelectedIndex(idx)}
                    >
                      {kind}
                    </button>
                    <input
                      type="color"
                      value={colorVal}
                      disabled={isRunning}
                      onChange={(e) => patchLayer(idx, { color: e.target.value })}
                      title="Color"
                      className="compositor-modal-color"
                    />
                    {kind === 'text' && (
                      <input
                        className="inspector-input compositor-modal-text-input"
                        type="text"
                        value={String(layer.text ?? '')}
                        disabled={isRunning}
                        onChange={(e) => patchLayer(idx, { text: e.target.value })}
                        placeholder="Text"
                      />
                    )}
                    {kind === 'line' && (
                      <label className="compositor-modal-stroke">
                        stroke
                        <input
                          type="number"
                          min={1}
                          className="inspector-input"
                          style={{ width: 48 }}
                          value={Math.max(1, Math.round(Number(layer.strokeWidth) || 2))}
                          disabled={isRunning}
                          onChange={(e) =>
                            patchLayer(idx, { strokeWidth: Math.max(1, parseInt(e.target.value, 10) || 2) })
                          }
                        />
                      </label>
                    )}
                    <button
                      type="button"
                      className="inspector-btn-small danger"
                      disabled={isRunning}
                      onClick={() => removeAt(idx)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          <div className="compositor-modal-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={vw}
              height={vh}
              className="compositor-modal-canvas"
              style={{ width: vw, height: vh, cursor: isRunning ? 'not-allowed' : 'crosshair' }}
              onMouseDown={onMouseDown}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
