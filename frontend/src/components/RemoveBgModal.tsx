import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';
import { imageSrcToDataUrl } from '../utils/imageObjectUrl';
import { API_BASE, authFetch } from '../utils/api';
import Icon from '../icons/Icon';

type RemoveBgResponse = {
  rawImage: string;
  rawMask: string;
};

/** BiRefNet v2 variants. Keep in sync with `REMOVE_BG_MODELS` in backend/nodes/tool_nodes.py. */
const MODELS: { id: string; label: string }[] = [
  { id: 'General Use (Heavy)', label: 'General Use — Heavy (best quality)' },
  { id: 'General Use (Light)', label: 'General Use — Light (faster)' },
  { id: 'General Use (Light 2K)', label: 'General Use — Light 2K' },
  { id: 'Matting', label: 'Matting (soft edges, hair, fur)' },
  { id: 'Portrait', label: 'Portrait (people)' },
];

const DEFAULT_MODEL = 'General Use (Heavy)';

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}

function parseBgFill(fillRaw: string): [number, number, number, number] | null {
  if (!fillRaw || fillRaw === 'transparent') return null;
  let s = fillRaw.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = `${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  if (s.length !== 6) return null;
  const r = Number.parseInt(s.slice(0, 2), 16);
  const g = Number.parseInt(s.slice(2, 4), 16);
  const b = Number.parseInt(s.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b, 255];
}

async function loadImageData(url: string): Promise<ImageData> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not load image'));
    el.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function featherMask(
  mask: Uint8ClampedArray<ArrayBufferLike>,
  w: number,
  h: number,
  radius: number,
): Uint8ClampedArray<ArrayBufferLike> {
  if (radius <= 0) return mask;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return mask;

  const img = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i += 1) {
    const j = i * 4;
    const v = mask[i];
    img.data[j] = v;
    img.data[j + 1] = v;
    img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = w;
  blurCanvas.height = h;
  const blurCtx = blurCanvas.getContext('2d');
  if (!blurCtx) return mask;
  blurCtx.filter = `blur(${Math.max(0.1, radius)}px)`;
  blurCtx.drawImage(canvas, 0, 0);
  blurCtx.filter = 'none';

  const out = blurCtx.getImageData(0, 0, w, h).data;
  const result = new Uint8ClampedArray(mask.length);
  for (let i = 0; i < result.length; i += 1) result[i] = out[i * 4];
  return result;
}

function morphMask(
  mask: Uint8ClampedArray<ArrayBufferLike>,
  w: number,
  h: number,
  radius: number,
  dilate: boolean,
): Uint8ClampedArray<ArrayBufferLike> {
  if (radius <= 0) return mask;
  const out = new Uint8ClampedArray(mask.length);
  const r = clampInt(radius, 1, 20);

  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      let best = dilate ? 0 : 255;
      for (let yy = y0; yy <= y1; yy += 1) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx += 1) {
          const v = mask[row + xx];
          if (dilate) best = Math.max(best, v);
          else best = Math.min(best, v);
        }
      }
      out[y * w + x] = best;
    }
  }
  return out;
}

function buildOutputImageData(
  src: ImageData,
  rawMask: Uint8ClampedArray<ArrayBufferLike>,
  options: {
    threshold: number;
    feather: number;
    erode: number;
    dilate: number;
    invert: boolean;
    bgFill: string;
  },
): { output: ImageData; mask: Uint8ClampedArray<ArrayBufferLike> } {
  const { width: w, height: h } = src;
  let mask: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(rawMask);
  const threshold = clampInt(options.threshold, 0, 255);
  const erode = clampInt(options.erode, 0, 20);
  const dilate = clampInt(options.dilate, 0, 20);
  const feather = Math.max(0, Math.min(20, Number(options.feather) || 0));

  if (threshold > 0) {
    for (let i = 0; i < mask.length; i += 1) {
      mask[i] = mask[i] >= threshold ? 255 : 0;
    }
  }
  if (erode > 0) mask = morphMask(mask, w, h, erode, false);
  if (dilate > 0) mask = morphMask(mask, w, h, dilate, true);
  if (feather > 0) mask = featherMask(mask, w, h, feather);
  if (options.invert) {
    for (let i = 0; i < mask.length; i += 1) mask[i] = 255 - mask[i];
  }

  const bg = parseBgFill(options.bgFill);
  const out = new ImageData(w, h);
  const srcData = src.data;
  const outData = out.data;

  for (let i = 0; i < mask.length; i += 1) {
    const p = i * 4;
    const srcA = srcData[p + 3];
    const alpha = Math.round((srcA * mask[i]) / 255);
    if (bg == null) {
      outData[p] = srcData[p];
      outData[p + 1] = srcData[p + 1];
      outData[p + 2] = srcData[p + 2];
      outData[p + 3] = alpha;
      continue;
    }

    const aNorm = alpha / 255;
    outData[p] = Math.round(bg[0] * (1 - aNorm) + srcData[p] * aNorm);
    outData[p + 1] = Math.round(bg[1] * (1 - aNorm) + srcData[p + 1] * aNorm);
    outData[p + 2] = Math.round(bg[2] * (1 - aNorm) + srcData[p + 2] * aNorm);
    outData[p + 3] = 255;
  }

  return { output: out, mask };
}

function resizeMask(
  mask: Uint8ClampedArray<ArrayBufferLike>,
  srcW: number,
  srcH: number,
  destW: number,
  destH: number,
): Uint8ClampedArray<ArrayBufferLike> {
  if (srcW === destW && srcH === destH) return mask;
  const src = document.createElement('canvas');
  src.width = srcW;
  src.height = srcH;
  const sctx = src.getContext('2d');
  if (!sctx) return mask;
  const img = sctx.createImageData(srcW, srcH);
  for (let i = 0; i < mask.length; i += 1) {
    const j = i * 4;
    const v = mask[i];
    img.data[j] = v;
    img.data[j + 1] = v;
    img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);

  const dest = document.createElement('canvas');
  dest.width = destW;
  dest.height = destH;
  const dctx = dest.getContext('2d');
  if (!dctx) return mask;
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(src, 0, 0, destW, destH);
  const out = dctx.getImageData(0, 0, destW, destH).data;
  const result = new Uint8ClampedArray(destW * destH);
  for (let i = 0; i < result.length; i += 1) result[i] = out[i * 4];
  return result;
}

function formatApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) =>
        item && typeof item === 'object' && 'msg' in item
          ? String((item as { msg: unknown }).msg)
          : String(item),
      )
      .join('; ');
  }
  return fallback;
}

export default function RemoveBgModal({
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

  const node = useMemo(() => nodes.find((n) => n.id === nodeId), [nodes, nodeId]);
  const data = (node?.data || {}) as Record<string, any>;
  const imageSrc = useMemo(
    () => getConnectedImageDataUrl(nodeId, 'image', edges, nodes),
    [edges, nodeId, nodes],
  );

  const [model, setModel] = useState(DEFAULT_MODEL);
  const [operatingResolution, setOperatingResolution] = useState('1024x1024');
  const [refineForeground, setRefineForeground] = useState(true);
  const [threshold, setThreshold] = useState(0);
  const [feather, setFeather] = useState(0);
  const [erode, setErode] = useState(0);
  const [dilate, setDilate] = useState(0);
  const [invert, setInvert] = useState(false);
  const [bgFill, setBgFill] = useState('transparent');

  const [sourceImageData, setSourceImageData] = useState<ImageData | null>(null);
  const [rawMask, setRawMask] = useState<Uint8ClampedArray<ArrayBufferLike> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const saved = typeof data.model === 'string' ? data.model : '';
    setModel(MODELS.some((m) => m.id === saved) ? saved : DEFAULT_MODEL);
    setOperatingResolution(data.operatingResolution === '2048x2048' ? '2048x2048' : '1024x1024');
    setRefineForeground(data.refineForeground !== false);
    setThreshold(clampInt(Number(data.threshold) || 0, 0, 255));
    setFeather(Math.max(0, Math.min(20, Number(data.feather) || 0)));
    setErode(clampInt(Number(data.erode) || 0, 0, 20));
    setDilate(clampInt(Number(data.dilate) || 0, 0, 20));
    setInvert(Boolean(data.invert));
    setBgFill(typeof data.bgFill === 'string' && data.bgFill ? data.bgFill : 'transparent');
    setError('');
  }, [data, open]);

  useEffect(() => {
    if (!open || !imageSrc) {
      setSourceImageData(null);
      setRawMask(null);
      return;
    }
    let cancelled = false;
    loadImageData(imageSrc)
      .then((imgData) => {
        if (cancelled) return;
        setSourceImageData(imgData);
        setRawMask(null);
      })
      .catch(() => {
        if (cancelled) return;
        setSourceImageData(null);
        setRawMask(null);
        setError('Could not load input image.');
      });
    return () => {
      cancelled = true;
    };
  }, [imageSrc, open]);

  const runModel = useCallback(async () => {
    if (!imageSrc) {
      setError('Connect an image to the Image input first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Saved imports/previews resolve to `/api/upload/{id}`, not a data URL.
      // fal's upload path only accepts real image bytes — same as a workflow
      // run, which reloads the file from disk inside `importImage`.
      const imageDataUrl = await imageSrcToDataUrl(imageSrc);
      const srcPixels = sourceImageData || (await loadImageData(imageDataUrl));
      if (!sourceImageData) setSourceImageData(srcPixels);

      const res = await authFetch(`${API_BASE}/tools/remove-bg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl,
          model,
          operatingResolution,
          refineForeground,
        }),
      });
      const payload = (await res.json().catch(() => null)) as RemoveBgResponse | { detail?: unknown } | null;
      if (!res.ok) throw new Error(formatApiError(payload, 'remove-bg failed'));
      if (!payload || typeof (payload as RemoveBgResponse).rawMask !== 'string') {
        throw new Error('Invalid remove-bg response');
      }

      const rawMaskData = await loadImageData((payload as RemoveBgResponse).rawMask);
      let mask = new Uint8ClampedArray(rawMaskData.width * rawMaskData.height);
      for (let i = 0; i < mask.length; i += 1) mask[i] = rawMaskData.data[i * 4];
      if (rawMaskData.width !== srcPixels.width || rawMaskData.height !== srcPixels.height) {
        mask = resizeMask(
          mask,
          rawMaskData.width,
          rawMaskData.height,
          srcPixels.width,
          srcPixels.height,
        );
      }
      setRawMask(mask);
    } catch (e: any) {
      setError(e?.message || 'Failed to run background removal.');
    } finally {
      setLoading(false);
    }
  }, [imageSrc, model, operatingResolution, refineForeground, sourceImageData]);

  const processed = useMemo(() => {
    if (!sourceImageData || !rawMask) return null;
    return buildOutputImageData(sourceImageData, rawMask, {
      threshold,
      feather,
      erode,
      dilate,
      invert,
      bgFill,
    });
  }, [bgFill, dilate, erode, feather, invert, rawMask, sourceImageData, threshold]);

  useEffect(() => {
    if (!processed || !previewCanvasRef.current || !outputCanvasRef.current) return;
    const preview = previewCanvasRef.current;
    const output = outputCanvasRef.current;
    preview.width = processed.output.width;
    preview.height = processed.output.height;
    output.width = processed.output.width;
    output.height = processed.output.height;

    const pctx = preview.getContext('2d');
    const octx = output.getContext('2d');
    if (!pctx || !octx) return;
    pctx.putImageData(processed.output, 0, 0);
    octx.putImageData(processed.output, 0, 0);
  }, [processed]);

  const handleBake = useCallback(() => {
    if (!outputCanvasRef.current || !processed) return;
    const baked = outputCanvasRef.current.toDataURL('image/png');
    updateNodeData(nodeId, {
      _removeBgBaked: baked,
      model,
      operatingResolution,
      refineForeground,
      threshold,
      feather,
      erode,
      dilate,
      invert,
      bgFill,
    });
    onClose();
  }, [
    bgFill,
    dilate,
    erode,
    feather,
    invert,
    model,
    operatingResolution,
    refineForeground,
    nodeId,
    onClose,
    processed,
    threshold,
    updateNodeData,
  ]);

  const handleReset = useCallback(() => {
    updateNodeData(nodeId, { _removeBgBaked: '' });
  }, [nodeId, updateNodeData]);

  if (!open || !node || node.type !== 'removeBg') return null;

  const width = sourceImageData?.width ?? 0;
  const height = sourceImageData?.height ?? 0;
  const bgTransparent = bgFill === 'transparent' || !bgFill;

  return (
    <div
      className="compositor-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compositor-modal editor-modal" role="dialog" aria-labelledby="removebg-modal-title">
        <div className="compositor-modal-header">
          <h2 id="removebg-modal-title">Remove Background</h2>
          <button type="button" className="compositor-modal-close" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="close-line" size={18} />
          </button>
        </div>
        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Run the cutout once on fal.ai, then tweak threshold and edge controls live —
              those are local, so only the initial run costs anything.
              Click <strong>Bake</strong> to store the final transparent output on this node.
            </p>

            <label className="inspector-label">Model</label>
            <select
              className="inspector-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isRunning || loading}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>

            <label className="inspector-label">Detail Resolution</label>
            <select
              className="inspector-select"
              value={operatingResolution}
              onChange={(e) => setOperatingResolution(e.target.value)}
              disabled={isRunning || loading}
            >
              <option value="1024x1024">1024 — faster</option>
              <option value="2048x2048">2048 — finer edges, slower</option>
            </select>

            <label className="inspector-label" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={refineForeground}
                onChange={(e) => setRefineForeground(e.target.checked)}
                disabled={isRunning || loading}
              />
              Refine foreground
            </label>

            <button
              type="button"
              className="inspector-btn"
              style={{ marginTop: 10, marginBottom: 10 }}
              onClick={runModel}
              disabled={isRunning || loading || !imageSrc}
            >
              {loading ? 'Running model...' : 'Run Model'}
            </button>

            <label className="inspector-label">Threshold ({threshold})</label>
            <input
              className="inspector-range"
              type="range"
              min={0}
              max={255}
              value={threshold}
              onChange={(e) => setThreshold(clampInt(Number(e.target.value), 0, 255))}
              disabled={isRunning || !rawMask}
            />

            <label className="inspector-label">Feather ({feather.toFixed(1)} px)</label>
            <input
              className="inspector-range"
              type="range"
              min={0}
              max={20}
              step={0.1}
              value={feather}
              onChange={(e) => setFeather(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
              disabled={isRunning || !rawMask}
            />

            <label className="inspector-label">Erode ({erode})</label>
            <input
              className="inspector-range"
              type="range"
              min={0}
              max={20}
              value={erode}
              onChange={(e) => setErode(clampInt(Number(e.target.value), 0, 20))}
              disabled={isRunning || !rawMask}
            />

            <label className="inspector-label">Dilate ({dilate})</label>
            <input
              className="inspector-range"
              type="range"
              min={0}
              max={20}
              value={dilate}
              onChange={(e) => setDilate(clampInt(Number(e.target.value), 0, 20))}
              disabled={isRunning || !rawMask}
            />

            <label className="inspector-label">
              <input
                type="checkbox"
                checked={invert}
                onChange={(e) => setInvert(e.target.checked)}
                disabled={isRunning || !rawMask}
              />
              Invert mask
            </label>

            <label className="inspector-label">Background Fill</label>
            <select
              className="inspector-select"
              value={bgTransparent ? 'transparent' : 'color'}
              onChange={(e) => setBgFill(e.target.value === 'transparent' ? 'transparent' : '#ffffff')}
              disabled={isRunning}
            >
              <option value="transparent">Transparent</option>
              <option value="color">Solid color</option>
            </select>
            {!bgTransparent ? (
              <input
                className="inspector-color"
                type="color"
                value={bgFill}
                onChange={(e) => setBgFill(e.target.value)}
                disabled={isRunning}
              />
            ) : null}

            {width > 0 && height > 0 ? (
              <div className="inspector-empty-small" style={{ marginTop: 10 }}>
                Source {width} × {height}px
              </div>
            ) : null}

            {error ? (
              <div className="inspector-empty-small" style={{ marginTop: 10, color: '#f87171' }}>
                {error}
              </div>
            ) : null}

            <div className="editor-field-row" style={{ gap: 8, marginTop: 16 }}>
              <button type="button" className="inspector-btn" style={{ flex: 1 }} onClick={handleReset} disabled={isRunning}>
                Reset baked
              </button>
              <button
                type="button"
                className="inspector-btn"
                style={{ flex: 1, background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' }}
                onClick={handleBake}
                disabled={isRunning || !processed}
              >
                Bake
              </button>
            </div>
          </aside>

          <div className="compositor-modal-canvas-wrap">
            {processed ? (
              <canvas
                ref={previewCanvasRef}
                className="compositor-modal-canvas editor-canvas-interactive editor-canvas-no-round"
                style={{
                  width: '100%',
                  height: '100%',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div className="inspector-empty-small" style={{ padding: 24 }}>
                {imageSrc ? 'Run model to generate mask preview.' : 'Connect an image input first.'}
              </div>
            )}
            <canvas ref={outputCanvasRef} style={{ display: 'none' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
