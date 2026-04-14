import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { MAX_VIGNETTE_LAYERS } from '../types/nodeTypes';
import VignetteCanvasPreview from './VignetteCanvasPreview';
import {
  defaultVignetteLayer,
  newVignetteLayerId,
  type VignetteBlendMode,
  type VignetteLayerData,
  type VignetteShape,
} from '../utils/vignetteMath';

function asLayers(data: Record<string, any>): VignetteLayerData[] {
  const raw = data.vignetteLayers;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((item: any) => ({
    id: String(item.id || newVignetteLayerId()),
    shape: item.shape === 'square' ? 'square' : 'circle',
    color: typeof item.color === 'string' ? item.color : '#000000',
    opacity: Math.min(1, Math.max(0, Number(item.opacity) ?? 0.5)),
    blendMode:
      item.blendMode === 'multiply' || item.blendMode === 'screen'
        ? item.blendMode
        : 'normal',
    size: Math.min(1, Math.max(0, Number(item.size) ?? 0.5)),
    feather: Math.min(1, Math.max(0, Number(item.feather) ?? 0.5)),
  }));
}

function toHexColor(raw: string): string {
  const s = (raw || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  if (/^[0-9A-Fa-f]{6}$/.test(s)) return `#${s}`;
  return '#000000';
}

export default function VignetteModal({
  open,
  onClose,
  nodeId,
}: {
  open: boolean;
  onClose: () => void;
  nodeId: string;
}) {
  const nodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const node = nodes.find((n) => n.id === nodeId);
  const data = node?.data ?? {};

  const layers = useMemo(() => asLayers(data), [data.vignetteLayers]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const effectiveSelected =
    selectedId && layers.some((l) => l.id === selectedId) ? selectedId : layers[0]?.id ?? null;

  const sel = layers.find((l) => l.id === effectiveSelected);

  const [colorDraft, setColorDraft] = useState('#000000');
  const colorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingColorRef = useRef<{ id: string; color: string } | null>(null);

  const applyPendingColorToStore = useCallback(() => {
    const p = pendingColorRef.current;
    if (!p) return;
    pendingColorRef.current = null;
    const st = useWorkflowStore.getState();
    const n = st.nodes.find((x) => x.id === nodeId);
    const L = asLayers(n?.data ?? {});
    const next = L.map((l) => (l.id === p.id ? { ...l, color: p.color } : l));
    st.updateNodeData(nodeId, { vignetteLayers: next });
  }, [nodeId]);

  const flushPendingColor = useCallback(() => {
    if (colorTimerRef.current) {
      clearTimeout(colorTimerRef.current);
      colorTimerRef.current = null;
    }
    applyPendingColorToStore();
  }, [applyPendingColorToStore]);

  const scheduleColorPersist = useCallback(
    (id: string, color: string) => {
      pendingColorRef.current = { id, color };
      if (colorTimerRef.current) clearTimeout(colorTimerRef.current);
      colorTimerRef.current = window.setTimeout(() => {
        colorTimerRef.current = null;
        applyPendingColorToStore();
      }, 120);
    },
    [applyPendingColorToStore],
  );

  useEffect(() => {
    if (!sel) return;
    setColorDraft(toHexColor(sel.color));
  }, [sel?.id, sel?.color]);

  useEffect(() => {
    if (!open) flushPendingColor();
  }, [open, flushPendingColor]);

  useEffect(() => {
    return () => flushPendingColor();
  }, [flushPendingColor]);

  const previewLayers = useMemo(() => {
    if (!effectiveSelected) return layers;
    return layers.map((l) =>
      l.id === effectiveSelected ? { ...l, color: colorDraft } : l,
    );
  }, [layers, effectiveSelected, colorDraft]);

  const selectLayerTab = useCallback(
    (id: string) => {
      flushPendingColor();
      setSelectedId(id);
    },
    [flushPendingColor],
  );

  if (!open || !node) return null;

  const maxPreviewWidth = Math.min(960, Math.max(200, window.innerWidth - 120 - 280));
  /* Fit full image in modal: cap height so portrait / tall images are not clipped (92vh modal − chrome). */
  const maxPreviewHeight = Math.max(
    180,
    Math.floor(window.innerHeight * 0.92 - 168),
  );

  const persistLayers = (next: VignetteLayerData[]) => {
    updateNodeData(nodeId, { vignetteLayers: next });
  };

  const updateLayer = (id: string, patch: Partial<VignetteLayerData>) => {
    const next = layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
    persistLayers(next);
  };

  const addLayer = () => {
    if (layers.length >= MAX_VIGNETTE_LAYERS) return;
    const nl = defaultVignetteLayer();
    persistLayers([...layers, nl]);
    setSelectedId(nl.id);
  };

  const removeLayer = (id: string) => {
    flushPendingColor();
    const next = layers.filter((l) => l.id !== id);
    persistLayers(next);
    if (effectiveSelected === id) setSelectedId(next[0]?.id ?? null);
  };

  return (
    <div
      className="compositor-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compositor-modal" role="dialog" aria-labelledby="vignette-modal-title">
        <div className="compositor-modal-header">
          <h2 id="vignette-modal-title">Vignette</h2>
          <button type="button" className="compositor-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Stack up to {MAX_VIGNETTE_LAYERS} vignette layers. Circle uses radial falloff; square uses a box-shaped
              falloff. Size controls how far the effect reaches toward the center; feather softens the transition.
            </p>

            <label className="inspector-label">Layers</label>
            <div className="vignette-layer-tabs" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {layers.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  className="inspector-btn-small"
                  style={
                    effectiveSelected === l.id
                      ? { background: '#6366f1', color: '#fff' }
                      : undefined
                  }
                  disabled={isRunning}
                  onClick={() => selectLayerTab(l.id)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                className="inspector-btn-small"
                disabled={isRunning || layers.length >= MAX_VIGNETTE_LAYERS}
                onClick={() => {
                  flushPendingColor();
                  addLayer();
                }}
              >
                + Add layer
              </button>
              <button
                type="button"
                className="inspector-btn-small danger"
                disabled={isRunning || layers.length === 0 || !effectiveSelected}
                onClick={() => effectiveSelected && removeLayer(effectiveSelected)}
              >
                Remove
              </button>
            </div>

            {layers.length === 0 && (
              <p className="inspector-empty-small" style={{ marginBottom: 12 }}>
                No vignette layers — output matches input. Add a layer to darken or tint the edges.
              </p>
            )}

            {sel && (
              <div className="vignette-layer-fields">
                <label className="inspector-label">Shape</label>
                <select
                  className="inspector-select"
                  value={sel.shape}
                  disabled={isRunning}
                  onChange={(e) =>
                    updateLayer(sel.id, { shape: e.target.value as VignetteShape })
                  }
                >
                  <option value="circle">Circle</option>
                  <option value="square">Square</option>
                </select>

                <label className="inspector-label">Color</label>
                <input
                  className="inspector-input"
                  type="color"
                  value={toHexColor(colorDraft)}
                  disabled={isRunning}
                  onChange={(e) => {
                    const v = e.target.value;
                    setColorDraft(v);
                    scheduleColorPersist(sel.id, v);
                  }}
                  onBlur={() => flushPendingColor()}
                />

                <label className="inspector-label">Opacity ({sel.opacity.toFixed(2)})</label>
                <input
                  className="inspector-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={sel.opacity}
                  disabled={isRunning}
                  onChange={(e) => updateLayer(sel.id, { opacity: parseFloat(e.target.value) })}
                />

                <label className="inspector-label">Blend</label>
                <select
                  className="inspector-select"
                  value={sel.blendMode}
                  disabled={isRunning}
                  onChange={(e) =>
                    updateLayer(sel.id, { blendMode: e.target.value as VignetteBlendMode })
                  }
                >
                  <option value="normal">Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                </select>

                <label className="inspector-label">Size — reach toward center ({sel.size.toFixed(2)})</label>
                <input
                  className="inspector-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={sel.size}
                  disabled={isRunning}
                  onChange={(e) => updateLayer(sel.id, { size: parseFloat(e.target.value) })}
                />

                <label className="inspector-label">Feather — smoothness ({sel.feather.toFixed(2)})</label>
                <input
                  className="inspector-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={sel.feather}
                  disabled={isRunning}
                  onChange={(e) => updateLayer(sel.id, { feather: parseFloat(e.target.value) })}
                />
              </div>
            )}
          </aside>
          <div className="compositor-modal-canvas-wrap vignette-modal-canvas-wrap">
            <VignetteCanvasPreview
              nodeId={nodeId}
              data={data}
              maxPreviewWidth={maxPreviewWidth}
              maxPreviewHeight={maxPreviewHeight}
              layersForPreview={previewLayers}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
