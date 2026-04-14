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

  const updateLayer = (layerId: string, key: string, value: any) => {
    const updated = { ...layers };
    updated[layerId] = { ...(updated[layerId] || {}), [key]: value };
    updateNodeData(nodeId, { layers: updated });
  };

  const handleAddLayer = () => {
    if (disabled) return;
    const newCount = layerCount + 1;
    const updated = { ...layers };
    updated[`layer${newCount}`] = { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false };
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
        const cfg = layers[id] || { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false };
        return (
          <div key={id} className="editor-layer-card">
            <div className="editor-layer-card-header">Layer {i + 1}</div>
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
          </div>
        );
      })}
    </>
  );
}
