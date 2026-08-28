import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';
import { encodeCanvasPreview } from '../utils/previewEncoding';
import {
  applyAdjustmentsToRgba,
  isIdentity,
  normalizeAdjustments,
  type AdjustmentsParams,
} from '../utils/adjustmentsMath';

export default function AdjustmentsCanvasPreview({
  nodeId,
  data,
  maxPreviewWidth = 520,
  maxPreviewHeight = 560,
  /** When set, used instead of `data` (e.g. modal draft params without store churn). */
  paramsForPreview,
  /** Called after each paint with the encoded canvas, deduped against the last value. */
  onBake,
}: {
  nodeId: string;
  data: Record<string, any>;
  maxPreviewWidth?: number;
  /** Max drawn size (px); image is scaled uniformly to fit inside width × height. */
  maxPreviewHeight?: number;
  paramsForPreview?: AdjustmentsParams;
  onBake?: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null);
  const lastBakedRef = useRef<string | null>(null);

  const src = getConnectedImageDataUrl(nodeId, 'image', edges, allNodes);
  const params = useMemo(
    () => paramsForPreview ?? normalizeAdjustments(data),
    [paramsForPreview, data.hue, data.saturation, data.value, data.levels],
  );

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
        ctx.font = '12px Fredoka, sans-serif';
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

      if (!isIdentity(params)) {
        const imageData = ctx.getImageData(0, 0, cw, ch);
        const copy = new Uint8ClampedArray(imageData.data);
        applyAdjustmentsToRgba(copy, params);
        imageData.data.set(copy);
        ctx.putImageData(imageData, 0, 0);
      }

      if (onBake) {
        const encoded = encodeCanvasPreview(canvas);
        if (encoded !== lastBakedRef.current) {
          lastBakedRef.current = encoded;
          onBake(encoded);
        }
      }
    };

    raf = requestAnimationFrame(paint);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [baseImg, params, maxPreviewWidth, maxPreviewHeight, onBake]);

  return (
    <canvas
      ref={canvasRef}
      className="compositor-modal-canvas"
      style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }}
    />
  );
}
