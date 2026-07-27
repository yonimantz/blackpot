import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getUploadFileUrl } from '../utils/api';
import {
  applyVignetteLayersToRgba,
  type VignetteLayerData,
} from '../utils/vignetteMath';

function getConnectedImageSrc(
  nodeId: string,
  edges: { source: string; target: string; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
): string | null {
  const edge = edges.find((e) => e.target === nodeId && e.targetHandle === 'image');
  if (!edge) return null;
  const sourceNode = allNodes.find((n) => n.id === edge.source);
  if (!sourceNode) return null;
  const d = sourceNode.data;
  if (typeof d?.fileAssetId === 'string' && d.fileAssetId) {
    return getUploadFileUrl(d.fileAssetId);
  }
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

function normalizeLayers(raw: unknown): VignetteLayerData[] {
  if (!Array.isArray(raw)) return [];
  const out: VignetteLayerData[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const shape = o.shape === 'square' ? 'square' : 'circle';
    const blendMode =
      o.blendMode === 'multiply' || o.blendMode === 'screen' ? o.blendMode : 'normal';
    out.push({
      id: String(o.id || ''),
      shape,
      color: typeof o.color === 'string' ? o.color : '#000000',
      opacity: Math.min(1, Math.max(0, Number(o.opacity) || 0)),
      blendMode,
      size: Math.min(1, Math.max(0, Number(o.size) || 0)),
      feather: Math.min(1, Math.max(0, Number(o.feather) || 0)),
    });
  }
  return out;
}

export default function VignetteCanvasPreview({
  nodeId,
  data,
  maxPreviewWidth = 520,
  maxPreviewHeight = 560,
  /** When set, used instead of `data.vignetteLayers` (e.g. modal draft color without store churn). */
  layersForPreview,
}: {
  nodeId: string;
  data: Record<string, any>;
  maxPreviewWidth?: number;
  /** Max drawn size (px); image is scaled uniformly to fit inside width × height. */
  maxPreviewHeight?: number;
  layersForPreview?: VignetteLayerData[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null);

  const src = getConnectedImageSrc(nodeId, edges, allNodes);
  const layers = useMemo(() => {
    if (layersForPreview !== undefined) return layersForPreview;
    return normalizeLayers(data.vignetteLayers);
  }, [data.vignetteLayers, layersForPreview]);

  useEffect(() => {
    if (!src) {
      setBaseImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBaseImg(img);
    img.onerror = () => setBaseImg(null);
    img.src = src;
  }, [src]);

  useEffect(() => {
    let raf = 0;
    let cancelled = false;

    const paint = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const mw = Math.max(120, maxPreviewWidth);
      const mh = Math.max(120, maxPreviewHeight);
      if (!baseImg || !baseImg.naturalWidth) {
        let ew = mw;
        let eh = Math.round((mw * 9) / 16);
        if (eh > mh) {
          eh = mh;
          ew = Math.round((mh * 16) / 9);
        }
        if (ew > mw) {
          ew = mw;
          eh = Math.round((mw * 9) / 16);
        }
        canvas.width = ew;
        canvas.height = eh;
        ctx.fillStyle = '#1e1e21';
        ctx.fillRect(0, 0, ew, eh);
        ctx.fillStyle = '#71717a';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Connect an image input', ew / 2, eh / 2 + 4);
        return;
      }

      const natW = baseImg.naturalWidth;
      const natH = baseImg.naturalHeight;
      const sc = Math.min(1, mw / natW, mh / natH);
      const cw = Math.round(natW * sc);
      const ch = Math.round(natH * sc);
      canvas.width = cw;
      canvas.height = ch;
      ctx.drawImage(baseImg, 0, 0, cw, ch);

      if (layers.length === 0) return;

      const imageData = ctx.getImageData(0, 0, cw, ch);
      const copy = new Uint8ClampedArray(imageData.data);
      applyVignetteLayersToRgba(copy, cw, ch, layers);
      imageData.data.set(copy);
      ctx.putImageData(imageData, 0, 0);
    };

    raf = requestAnimationFrame(paint);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [baseImg, layers, maxPreviewWidth, maxPreviewHeight]);

  return (
    <canvas
      ref={canvasRef}
      className="compositor-modal-canvas vignette-modal-canvas"
      style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }}
    />
  );
}
