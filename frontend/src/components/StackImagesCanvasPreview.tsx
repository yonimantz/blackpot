import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';
import { encodeCanvasPreview } from '../utils/previewEncoding';
import { MAX_STACK_IMAGES } from '../types/nodeTypes';

type Direction = 'horizontal' | 'vertical';

/** One image loaded with its natural dimensions; ``null`` means "slot empty". */
interface LoadedSlot {
  img: HTMLImageElement;
  w: number;
  h: number;
}

/** Cheap FNV-1a so we can tell whether the input images have actually changed. */
function hashSources(srcs: (string | null)[]): string {
  let h = 2166136261;
  for (const s of srcs) {
    const str = s || '';
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    h ^= 0xff;
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * Compute the composed canvas size and per-image placement for a given set
 * of images, direction, and stretch mode. Mirrors ``_execute_stack_images``
 * in the backend so the on-canvas preview matches what the workflow bakes.
 */
function layoutStack(
  slots: LoadedSlot[],
  direction: Direction,
  stretch: boolean,
): {
  canvasW: number;
  canvasH: number;
  placements: { slot: LoadedSlot; x: number; y: number; dw: number; dh: number }[];
} | null {
  if (slots.length === 0) return null;
  const first = slots[0];
  const fw = first.w;
  const fh = first.h;

  if (stretch) {
    if (direction === 'horizontal') {
      const cw = fw * slots.length;
      const ch = fh;
      const placements = slots.map((slot, i) => ({
        slot,
        x: i * fw,
        y: 0,
        dw: fw,
        dh: fh,
      }));
      return { canvasW: cw, canvasH: ch, placements };
    }
    const cw = fw;
    const ch = fh * slots.length;
    const placements = slots.map((slot, i) => ({
      slot,
      x: 0,
      y: i * fh,
      dw: fw,
      dh: fh,
    }));
    return { canvasW: cw, canvasH: ch, placements };
  }

  if (direction === 'horizontal') {
    const targetH = fh;
    const sized = slots.map((slot, i) => {
      if (i === 0) return { slot, dw: slot.w, dh: slot.h };
      const ratio = targetH / slot.h;
      return { slot, dw: Math.max(1, Math.round(slot.w * ratio)), dh: targetH };
    });
    const cw = sized.reduce((acc, s) => acc + s.dw, 0);
    const placements: {
      slot: LoadedSlot;
      x: number;
      y: number;
      dw: number;
      dh: number;
    }[] = [];
    let x = 0;
    for (const s of sized) {
      const y = Math.floor((targetH - s.dh) / 2);
      placements.push({ slot: s.slot, x, y, dw: s.dw, dh: s.dh });
      x += s.dw;
    }
    return { canvasW: cw, canvasH: targetH, placements };
  }

  const targetW = fw;
  const sized = slots.map((slot, i) => {
    if (i === 0) return { slot, dw: slot.w, dh: slot.h };
    const ratio = targetW / slot.w;
    return { slot, dw: targetW, dh: Math.max(1, Math.round(slot.h * ratio)) };
  });
  const ch = sized.reduce((acc, s) => acc + s.dh, 0);
  const placements: {
    slot: LoadedSlot;
    x: number;
    y: number;
    dw: number;
    dh: number;
  }[] = [];
  let y = 0;
  for (const s of sized) {
    const x = Math.floor((targetW - s.dw) / 2);
    placements.push({ slot: s.slot, x, y, dw: s.dw, dh: s.dh });
    y += s.dh;
  }
  return { canvasW: targetW, canvasH: ch, placements };
}

export default function StackImagesCanvasPreview({
  nodeId,
  data,
}: {
  nodeId: string;
  data: Record<string, any>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const direction: Direction = data.direction === 'vertical' ? 'vertical' : 'horizontal';
  const stretch = Boolean(data.stretch);
  const count = Math.max(
    1,
    Math.min(MAX_STACK_IMAGES, (data.imageCount as number) || 2),
  );

  const srcs = useMemo(() => {
    const out: (string | null)[] = [];
    for (let i = 1; i <= count; i++) {
      out.push(getConnectedImageDataUrl(nodeId, `image${i}`, edges, allNodes));
    }
    return out;
  }, [nodeId, count, edges, allNodes]);

  const [slots, setSlots] = useState<LoadedSlot[]>([]);
  const srcsHash = useMemo(() => hashSources(srcs), [srcs]);
  const lastHashRef = useRef<string>('');

  useEffect(() => {
    if (lastHashRef.current === srcsHash) return;
    lastHashRef.current = srcsHash;

    let cancelled = false;
    (async () => {
      const loaded: LoadedSlot[] = [];
      for (const s of srcs) {
        if (!s) continue;
        try {
          const img = await loadImage(s);
          if (cancelled) return;
          loaded.push({ img, w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
        } catch {
          /* skip broken source */
        }
      }
      if (!cancelled) setSlots(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [srcs, srcsHash]);

  const layout = useMemo(
    () => layoutStack(slots, direction, stretch),
    [slots, direction, stretch],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (!layout) {
      canvas.width = 180;
      canvas.height = 100;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1e1e21';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#71717a';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Connect images', canvas.width / 2, canvas.height / 2 + 4);
      return;
    }

    canvas.width = layout.canvasW;
    canvas.height = layout.canvasH;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of layout.placements) {
      ctx.drawImage(p.slot.img, p.x, p.y, p.dw, p.dh);
    }
  }, [layout]);

  // Bake a data URL into node state so downstream nodes (preview, vignette,
  // etc.) can display the stacked result before a full workflow run.
  useEffect(() => {
    if (!layout) {
      if (data._stackPreview) updateNodeData(nodeId, { _stackPreview: '' });
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dataUrl: string;
    try {
      dataUrl = encodeCanvasPreview(canvas);
    } catch {
      return;
    }
    if (dataUrl !== data._stackPreview) {
      updateNodeData(nodeId, { _stackPreview: dataUrl });
    }
    // `data._stackPreview` is intentionally excluded from deps — we only want
    // to re-bake when the layout (images / options) changes, not when our own
    // write bounces back through props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, nodeId, updateNodeData]);

  return (
    <canvas
      ref={canvasRef}
      className="node-preview-img stack-node-canvas"
      style={{
        width: 'calc(100% - 12px)',
        maxHeight: 160,
        objectFit: 'contain',
        margin: '6px auto 0',
        display: 'block',
        borderRadius: 4,
        background: '#0f0f12',
      }}
    />
  );
}
