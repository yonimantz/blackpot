import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';
import AdjustmentsCanvasPreview from './AdjustmentsCanvasPreview';
import AdjustmentsHistogram, { computeAutoLevels } from './AdjustmentsHistogram';
import Icon from '../icons/Icon';
import {
  DEFAULT_ADJUSTMENTS,
  normalizeAdjustments,
  type AdjustmentsParams,
  type LevelsParams,
} from '../utils/adjustmentsMath';

/** Same debounce window as VignetteModal's color input, so dragging doesn't flood undo history. */
const PERSIST_DEBOUNCE_MS = 120;
/** Live-bake writes are throttled at roughly the same cadence, not debounced, so the node thumbnail keeps moving during a long drag. */
const BAKE_THROTTLE_MS = 120;

function clampNum(raw: string, lo: number, hi: number, fallback: number): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export default function AdjustmentsModal({
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

  const saved = useMemo(
    () => normalizeAdjustments(data),
    [data.hue, data.saturation, data.value, data.levels],
  );
  const [draft, setDraft] = useState<AdjustmentsParams>(saved);

  useEffect(() => {
    setDraft(saved);
  }, [
    nodeId,
    saved.hue,
    saved.saturation,
    saved.value,
    saved.levels.inBlack,
    saved.levels.inWhite,
    saved.levels.gamma,
    saved.levels.outBlack,
    saved.levels.outWhite,
  ]);

  // --- param persistence: local draft + debounced store write, flushed on blur/close/unmount ---
  const pendingParamsRef = useRef<AdjustmentsParams | null>(null);
  const paramsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushParams = useCallback(() => {
    if (paramsTimerRef.current) {
      clearTimeout(paramsTimerRef.current);
      paramsTimerRef.current = null;
    }
    const pending = pendingParamsRef.current;
    if (!pending) return;
    pendingParamsRef.current = null;
    updateNodeData(nodeId, {
      hue: pending.hue,
      saturation: pending.saturation,
      value: pending.value,
      levels: pending.levels,
    });
  }, [nodeId, updateNodeData]);

  const persistParamsNow = useCallback(
    (next: AdjustmentsParams) => {
      if (paramsTimerRef.current) {
        clearTimeout(paramsTimerRef.current);
        paramsTimerRef.current = null;
      }
      pendingParamsRef.current = null;
      updateNodeData(nodeId, {
        hue: next.hue,
        saturation: next.saturation,
        value: next.value,
        levels: next.levels,
      });
    },
    [nodeId, updateNodeData],
  );

  const scheduleParamsPersist = useCallback(
    (next: AdjustmentsParams) => {
      pendingParamsRef.current = next;
      if (paramsTimerRef.current) clearTimeout(paramsTimerRef.current);
      paramsTimerRef.current = window.setTimeout(() => {
        paramsTimerRef.current = null;
        flushParams();
      }, PERSIST_DEBOUNCE_MS);
    },
    [flushParams],
  );

  useEffect(() => {
    if (!open) flushParams();
  }, [open, flushParams]);

  useEffect(() => {
    return () => flushParams();
  }, [flushParams]);

  const updateHsv = (patch: Partial<Pick<AdjustmentsParams, 'hue' | 'saturation' | 'value'>>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    scheduleParamsPersist(next);
  };

  const resetHsv = () => {
    const next = { ...draft, hue: 0, saturation: 0, value: 0 };
    setDraft(next);
    persistParamsNow(next);
  };

  const updateLevels = (patch: Partial<LevelsParams>) => {
    const next = { ...draft, levels: { ...draft.levels, ...patch } };
    setDraft(next);
    scheduleParamsPersist(next);
  };

  const resetLevels = () => {
    const next = { ...draft, levels: { ...DEFAULT_ADJUSTMENTS.levels } };
    setDraft(next);
    persistParamsNow(next);
  };

  // --- live-bake throttling: at most one store write per BAKE_THROTTLE_MS while painting ---
  const pendingBakeRef = useRef<string | null>(null);
  const bakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushBake = useCallback(() => {
    if (bakeTimerRef.current) {
      clearTimeout(bakeTimerRef.current);
      bakeTimerRef.current = null;
    }
    const pending = pendingBakeRef.current;
    if (pending == null) return;
    pendingBakeRef.current = null;
    updateNodeData(nodeId, { _adjustmentsPreview: pending });
  }, [nodeId, updateNodeData]);

  const handleBake = useCallback(
    (dataUrl: string) => {
      pendingBakeRef.current = dataUrl;
      if (bakeTimerRef.current) return;
      bakeTimerRef.current = window.setTimeout(() => {
        bakeTimerRef.current = null;
        const pending = pendingBakeRef.current;
        pendingBakeRef.current = null;
        if (pending != null) updateNodeData(nodeId, { _adjustmentsPreview: pending });
      }, BAKE_THROTTLE_MS);
    },
    [updateNodeData, nodeId],
  );

  useEffect(() => {
    if (!open) flushBake();
  }, [open, flushBake]);

  useEffect(() => {
    return () => flushBake();
  }, [flushBake]);

  // --- shared base image for the histogram (canvas preview resolves its own copy independently) ---
  const src = useMemo(
    () => getConnectedImageDataUrl(nodeId, 'image', edges, nodes),
    [nodeId, edges, nodes],
  );
  const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null);

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

  const handleAuto = () => {
    const auto = computeAutoLevels(baseImg);
    if (!auto) return;
    const next = { ...draft, levels: { ...draft.levels, inBlack: auto.inBlack, inWhite: auto.inWhite } };
    setDraft(next);
    persistParamsNow(next);
  };

  if (!open || !node) return null;

  const maxPreviewWidth = Math.min(960, Math.max(200, window.innerWidth - 120 - 280));
  /* Fit full image in modal: cap height so portrait / tall images are not clipped (92vh modal − chrome). */
  const maxPreviewHeight = Math.max(180, Math.floor(window.innerHeight * 0.92 - 168));

  return (
    <div
      className="compositor-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compositor-modal" role="dialog" aria-labelledby="adjustments-modal-title">
        <div className="compositor-modal-header">
          <h2 id="adjustments-modal-title">Adjustments</h2>
          <button type="button" className="compositor-modal-close" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="close-line" size={18} />
          </button>
        </div>
        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Hue / Saturation / Value shifts the whole image; Levels remaps the input range through the
              histogram, with an optional gamma curve. Preview updates live; run the workflow to bake the
              full-resolution output.
            </p>

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <label className="inspector-label">Hue / Saturation / Value</label>
              <button type="button" className="inspector-btn-small" disabled={isRunning} onClick={resetHsv}>
                Reset
              </button>
            </div>

            <label className="inspector-label">Hue ({draft.hue.toFixed(0)}°)</label>
            <input
              className="inspector-range"
              type="range"
              min={-180}
              max={180}
              step={1}
              value={draft.hue}
              disabled={isRunning}
              onChange={(e) => updateHsv({ hue: parseFloat(e.target.value) })}
              onBlur={flushParams}
            />

            <label className="inspector-label">Saturation ({draft.saturation.toFixed(0)})</label>
            <input
              className="inspector-range"
              type="range"
              min={-100}
              max={100}
              step={1}
              value={draft.saturation}
              disabled={isRunning}
              onChange={(e) => updateHsv({ saturation: parseFloat(e.target.value) })}
              onBlur={flushParams}
            />

            <label className="inspector-label">Value ({draft.value.toFixed(0)})</label>
            <input
              className="inspector-range"
              type="range"
              min={-100}
              max={100}
              step={1}
              value={draft.value}
              disabled={isRunning}
              onChange={(e) => updateHsv({ value: parseFloat(e.target.value) })}
              onBlur={flushParams}
            />

            <div className="inspector-divider" />

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <label className="inspector-label">Levels</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="inspector-btn-small"
                  disabled={isRunning || !baseImg}
                  onClick={handleAuto}
                  title="Percentile-clip autolevel from the current image"
                >
                  Auto
                </button>
                <button type="button" className="inspector-btn-small" disabled={isRunning} onClick={resetLevels}>
                  Reset
                </button>
              </div>
            </div>

            <AdjustmentsHistogram
              baseImg={baseImg}
              levels={draft.levels}
              onChange={(patch) => updateLevels(patch)}
              disabled={isRunning}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label className="inspector-label">In black</label>
                <input
                  className="inspector-input"
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={Math.round(draft.levels.inBlack)}
                  disabled={isRunning}
                  onChange={(e) => updateLevels({ inBlack: clampNum(e.target.value, 0, 255, draft.levels.inBlack) })}
                  onBlur={flushParams}
                />
              </div>
              <div>
                <label className="inspector-label">In white</label>
                <input
                  className="inspector-input"
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={Math.round(draft.levels.inWhite)}
                  disabled={isRunning}
                  onChange={(e) => updateLevels({ inWhite: clampNum(e.target.value, 0, 255, draft.levels.inWhite) })}
                  onBlur={flushParams}
                />
              </div>
              <div>
                <label className="inspector-label">Gamma</label>
                <input
                  className="inspector-input"
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.01}
                  value={draft.levels.gamma}
                  disabled={isRunning}
                  onChange={(e) => updateLevels({ gamma: clampNum(e.target.value, 0.1, 10, draft.levels.gamma) })}
                  onBlur={flushParams}
                />
              </div>
              <div>
                <label className="inspector-label">Out black</label>
                <input
                  className="inspector-input"
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={Math.round(draft.levels.outBlack)}
                  disabled={isRunning}
                  onChange={(e) => updateLevels({ outBlack: clampNum(e.target.value, 0, 255, draft.levels.outBlack) })}
                  onBlur={flushParams}
                />
              </div>
              <div>
                <label className="inspector-label">Out white</label>
                <input
                  className="inspector-input"
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={Math.round(draft.levels.outWhite)}
                  disabled={isRunning}
                  onChange={(e) => updateLevels({ outWhite: clampNum(e.target.value, 0, 255, draft.levels.outWhite) })}
                  onBlur={flushParams}
                />
              </div>
            </div>
          </aside>
          <div className="compositor-modal-canvas-wrap">
            <AdjustmentsCanvasPreview
              nodeId={nodeId}
              data={data}
              maxPreviewWidth={maxPreviewWidth}
              maxPreviewHeight={maxPreviewHeight}
              paramsForPreview={draft}
              onBake={handleBake}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
