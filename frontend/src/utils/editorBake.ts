import { useEffect, useRef } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from './upstreamImage';
import { encodeCanvasPreview } from './previewEncoding';

interface LayerCfg {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  flipH?: boolean;
  opacity?: number;
  hidden?: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Bake the editor composite at the BG image's natural resolution and store it
 * on the node as `_editorPreview`. Runs whenever `data.bgHidden`, `data.layers`,
 * `data.layerCount`, or any upstream image source changes — independent of
 * whether the editor modal is open. This keeps downstream nodes (Preview,
 * Export, etc.) and the inline node thumbnail in sync with visibility toggles
 * before the user runs the workflow.
 */
export function useEditorPreviewBake(nodeId: string, data: Record<string, any>): void {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const layerCount = (data.layerCount as number) || 0;
  const layers = (data.layers as Record<string, LayerCfg>) || {};
  const bgHidden = Boolean(data.bgHidden);

  const lastUrlRef = useRef<string | null>(null);
  const cancelRef = useRef(false);

  const bgSrc = getConnectedImageDataUrl(nodeId, 'bgLayer', edges, allNodes);
  const layerSrcs: (string | null)[] = [];
  for (let i = 1; i <= layerCount; i++) {
    layerSrcs.push(getConnectedImageDataUrl(nodeId, `layer${i}`, edges, allNodes));
  }

  const layerSig = JSON.stringify(
    Array.from({ length: layerCount }, (_, i) => {
      const cfg = layers[`layer${i + 1}`] || {};
      return [
        cfg.x ?? 0,
        cfg.y ?? 0,
        cfg.width ?? 0,
        cfg.height ?? 0,
        cfg.rotation ?? 0,
        Boolean(cfg.flipH),
        cfg.opacity ?? 1,
        Boolean(cfg.hidden),
      ];
    }),
  );

  useEffect(() => {
    cancelRef.current = false;
    if (!bgSrc) return;

    let aborted = false;
    (async () => {
      const bg = await loadImage(bgSrc);
      if (!bg || aborted) return;

      const layerImages: (HTMLImageElement | null)[] = await Promise.all(
        layerSrcs.map((s) => (s ? loadImage(s) : Promise.resolve(null))),
      );
      if (aborted) return;

      const cw = bg.naturalWidth;
      const ch = bg.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (!bgHidden) {
        ctx.drawImage(bg, 0, 0, cw, ch);
      }

      for (let i = 0; i < layerCount; i++) {
        const img = layerImages[i];
        if (!img) continue;
        const cfg = layers[`layer${i + 1}`] || {};
        if (cfg.hidden) continue;
        const w = (cfg.width ?? 0) > 0 ? (cfg.width as number) : img.naturalWidth;
        const h = (cfg.height ?? 0) > 0 ? (cfg.height as number) : img.naturalHeight;
        const rad = ((cfg.rotation ?? 0) * Math.PI) / 180;
        const opacity = Math.max(0, Math.min(1, Number(cfg.opacity ?? 1)));
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate((cfg.x ?? 0), (cfg.y ?? 0));
        ctx.rotate(rad);
        if (cfg.flipH) ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      }

      let url: string;
      try {
        url = encodeCanvasPreview(canvas);
      } catch {
        return;
      }
      if (aborted) return;
      if (lastUrlRef.current === url) return;
      lastUrlRef.current = url;
      updateNodeData(nodeId, { _editorPreview: url });
    })();

    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, bgSrc, bgHidden, layerCount, layerSig, layerSrcs.join('|')]);
}
