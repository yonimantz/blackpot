import { useEffect, useRef } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from './upstreamImage';
import { encodeCanvasPreview } from './previewEncoding';
import { drawEditorComposite, fitLayerToBg, type EditorLayerCfg } from './editorComposite';

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
 *
 * Also owns "auto-fit on connect": a layer with no explicit width/height yet
 * (freshly wired up) is scaled/centered to contain-fit the BG here, on the
 * node itself, so the fitted values exist in the store before the editor
 * modal is ever opened. `EditorCanvasPreview` reads the same resolved values
 * (via `resolveLayerBox`/`drawEditorComposite`), so the modal can never show
 * something different from this thumbnail.
 */
export function useEditorPreviewBake(nodeId: string, data: Record<string, any>): void {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const layerCount = (data.layerCount as number) || 0;
  const layers = (data.layers as Record<string, EditorLayerCfg>) || {};
  const bgHidden = Boolean(data.bgHidden);

  const lastUrlRef = useRef<string | null>(null);
  const autoFittedRef = useRef<Set<string>>(new Set());

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
    if (!bgSrc) return;

    let aborted = false;
    (async () => {
      const bg = await loadImage(bgSrc);
      if (!bg || aborted) return;

      const layerImages: (HTMLImageElement | null)[] = await Promise.all(
        layerSrcs.map((s) => (s ? loadImage(s) : Promise.resolve(null))),
      );
      if (aborted) return;

      const bgW = bg.naturalWidth;
      const bgH = bg.naturalHeight;

      let fitChanged = false;
      const fittedLayers = { ...layers };
      for (let i = 1; i <= layerCount; i++) {
        const key = `layer${i}`;
        const img = layerImages[i - 1];
        const fitKey = `${nodeId}:${key}`;
        if (!img || autoFittedRef.current.has(fitKey)) continue;
        const cfg = fittedLayers[key] || {};
        if ((cfg.width ?? 0) === 0 && (cfg.height ?? 0) === 0) {
          fittedLayers[key] = fitLayerToBg(cfg, img, bgW, bgH);
          autoFittedRef.current.add(fitKey);
          fitChanged = true;
        }
      }
      if (fitChanged) {
        // The resulting data change re-triggers this effect with real sizes,
        // which is when the bake below actually runs.
        updateNodeData(nodeId, { layers: fittedLayers });
        return;
      }

      const images: Record<string, HTMLImageElement> = {};
      for (let i = 0; i < layerCount; i++) {
        const img = layerImages[i];
        if (img) images[`layer${i + 1}`] = img;
      }

      const canvas = document.createElement('canvas');
      canvas.width = bgW;
      canvas.height = bgH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      drawEditorComposite(ctx, {
        bgImg: bg,
        bgW,
        bgH,
        bgHidden,
        layerCount,
        layers,
        images,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      });

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
