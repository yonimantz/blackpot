import { useWorkflowStore } from '../store/workflowStore';

export default function EditorLayerFields({
  nodeId,
  data,
  updateNodeData,
  disabled = false,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  disabled?: boolean;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);
  const layerCount = (data.layerCount as number) || 0;
  const layers = (data.layers as Record<string, any>) || {};
  const bgHidden = Boolean(data.bgHidden);

  const updateLayer = (layerId: string, key: string, value: any) => {
    const updated = { ...layers };
    updated[layerId] = { ...(updated[layerId] || {}), [key]: value };
    updateNodeData(nodeId, { layers: updated });
  };

  const handleAddLayer = () => {
    if (disabled) return;
    const newCount = layerCount + 1;
    const updated = { ...layers };
    updated[`layer${newCount}`] = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      flipH: false,
      opacity: 1.0,
      hidden: false,
    };
    updateNodeData(nodeId, { layerCount: newCount, layers: updated });
  };

  const handleRemoveLayer = () => {
    if (disabled || layerCount <= 0) return;
    const handleToRemove = `layer${layerCount}`;
    const edgesToRemove = edges
      .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
      .map((e) => e.id);
    if (edgesToRemove.length > 0) {
      removeEdgesByIds(edgesToRemove);
    }
    const updated = { ...layers };
    delete updated[handleToRemove];
    updateNodeData(nodeId, { layerCount: layerCount - 1, layers: updated });
  };

  return (
    <>
      <div className="editor-layer-card" style={{ marginBottom: 10 }}>
        <div className="editor-layer-card-header">BG Layer</div>
        <label className="inspector-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={!bgHidden}
            disabled={disabled}
            onChange={(e) => updateNodeData(nodeId, { bgHidden: !e.target.checked })}
          />
          Show in output
        </label>
        <div className="inspector-empty-small" style={{ marginTop: 6 }}>
          When off, the background is not composited (canvas size still follows the BG image).
        </div>
      </div>

      <label className="inspector-label">Layers</label>
      <div className="combine-input-controls">
        <span className="combine-input-count">
          {layerCount} layer{layerCount !== 1 ? 's' : ''}
        </span>
        <button type="button" className="inspector-btn-small" disabled={disabled} onClick={handleAddLayer}>
          + Add
        </button>
        <button
          type="button"
          className="inspector-btn-small danger"
          disabled={disabled || layerCount <= 0}
          onClick={handleRemoveLayer}
        >
          − Remove
        </button>
      </div>

      {Array.from({ length: layerCount }, (_, i) => {
        const id = `layer${i + 1}`;
        const cfg = layers[id] || {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
          flipH: false,
          opacity: 1.0,
          hidden: false,
        };
        const opacity = Math.max(0, Math.min(1, Number(cfg.opacity ?? 1)));
        return (
          <div key={id} className="editor-layer-card">
            <div className="editor-layer-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span>Layer {i + 1}</span>
              <label className="inspector-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={!cfg.hidden}
                  disabled={disabled}
                  onChange={(e) => updateLayer(id, 'hidden', !e.target.checked)}
                />
                Output
              </label>
            </div>
            <div className="editor-layer-fields">
              <div className="editor-field-row">
                <label>X</label>
                <input
                  className="inspector-input"
                  type="number"
                  value={Math.round(cfg.x)}
                  disabled={disabled}
                  onChange={(e) => updateLayer(id, 'x', parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div className="editor-field-row">
                <label>Y</label>
                <input
                  className="inspector-input"
                  type="number"
                  value={Math.round(cfg.y)}
                  disabled={disabled}
                  onChange={(e) => updateLayer(id, 'y', parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div className="editor-field-row">
                <label>W</label>
                <input
                  className="inspector-input"
                  type="number"
                  value={Math.round(cfg.width)}
                  disabled={disabled}
                  onChange={(e) => updateLayer(id, 'width', parseInt(e.target.value, 10) || 0)}
                  placeholder="auto"
                />
              </div>
              <div className="editor-field-row">
                <label>H</label>
                <input
                  className="inspector-input"
                  type="number"
                  value={Math.round(cfg.height)}
                  disabled={disabled}
                  onChange={(e) => updateLayer(id, 'height', parseInt(e.target.value, 10) || 0)}
                  placeholder="auto"
                />
              </div>
            </div>
            <div className="editor-layer-fields" style={{ marginTop: 4 }}>
              <div className="editor-field-row">
                <label style={{ fontSize: 9 }}>Rot</label>
                <input
                  className="inspector-input"
                  type="number"
                  value={Math.round(cfg.rotation || 0)}
                  disabled={disabled}
                  onChange={(e) => updateLayer(id, 'rotation', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="editor-field-row" style={{ alignItems: 'center' }}>
                <label className="inspector-label" style={{ margin: 0, whiteSpace: 'nowrap', fontSize: 10 }}>
                  <input
                    type="checkbox"
                    checked={cfg.flipH || false}
                    disabled={disabled}
                    onChange={(e) => updateLayer(id, 'flipH', e.target.checked)}
                  />
                  Flip H
                </label>
              </div>
            </div>
            <div style={{ marginTop: 6 }}>
              <label className="inspector-label" style={{ marginBottom: 2 }}>
                Opacity (0-1)
              </label>
              <input
                className="inspector-range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                disabled={disabled}
                onChange={(e) => updateLayer(id, 'opacity', parseFloat(e.target.value))}
              />
              <span className="range-value">{opacity.toFixed(2)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}
