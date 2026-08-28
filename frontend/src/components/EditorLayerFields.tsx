import { useWorkflowStore } from '../store/workflowStore';
import { getConnectedImageDataUrl } from '../utils/upstreamImage';
import { fitLayerToBg, resetLayerToOriginalSize } from '../utils/editorComposite';
import Icon from '../icons/Icon';

function loadImageEl(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export default function EditorLayerFields({
  nodeId,
  data,
  updateNodeData,
  disabled = false,
  selectedLayer = null,
  onSelectLayer,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  disabled?: boolean;
  selectedLayer?: number | null;
  onSelectLayer?: (layer: number | null) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
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
    onSelectLayer?.(newCount);
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
    if (selectedLayer !== null && selectedLayer >= layerCount) onSelectLayer?.(null);
  };

  const handleFitLayer = async (id: string) => {
    if (disabled) return;
    const bgSrc = getConnectedImageDataUrl(nodeId, 'bgLayer', edges, allNodes);
    const layerSrc = getConnectedImageDataUrl(nodeId, id, edges, allNodes);
    if (!bgSrc || !layerSrc) return;
    const [bgImg, layerImg] = await Promise.all([loadImageEl(bgSrc), loadImageEl(layerSrc)]);
    if (!bgImg || !layerImg) return;
    const updated = {
      ...layers,
      [id]: fitLayerToBg(layers[id] || {}, layerImg, bgImg.naturalWidth, bgImg.naturalHeight),
    };
    updateNodeData(nodeId, { layers: updated });
  };

  const handleResetLayer = async (id: string) => {
    if (disabled) return;
    const layerSrc = getConnectedImageDataUrl(nodeId, id, edges, allNodes);
    if (!layerSrc) return;
    const layerImg = await loadImageEl(layerSrc);
    if (!layerImg) return;
    const updated = {
      ...layers,
      [id]: resetLayerToOriginalSize(layers[id] || {}, layerImg),
    };
    updateNodeData(nodeId, { layers: updated });
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
          <Icon name="add-line" size={11} />
          Add
        </button>
        <button
          type="button"
          className="inspector-btn-small danger"
          disabled={disabled || layerCount <= 0}
          onClick={handleRemoveLayer}
        >
          <Icon name="minus-circle-line" size={11} />
          Remove
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
        const isSelected = selectedLayer === i + 1;
        return (
          <div
            key={id}
            className={isSelected ? 'editor-layer-card selected' : 'editor-layer-card'}
            onClick={() => onSelectLayer?.(i + 1)}
          >
            <div className="editor-layer-card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <span>Layer {i + 1}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="inspector-btn-small"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleFitLayer(id);
                  }}
                  title="Scale this layer to fit inside the BG"
                >
                  <Icon name="fullscreen-line" size={10} />
                  Fit
                </button>
                <button
                  type="button"
                  className="inspector-btn-small"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleResetLayer(id);
                  }}
                  title="Reset this layer to its original image size and ratio"
                >
                  <Icon name="scale-line" size={10} />
                  Reset
                </button>
                <label
                  className="inspector-label"
                  style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 400 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={!cfg.hidden}
                    disabled={disabled}
                    onChange={(e) => updateLayer(id, 'hidden', !e.target.checked)}
                  />
                  Output
                </label>
              </div>
            </div>
            <div className="editor-layer-fields">
              <div className="editor-field-row">
                <label>X</label>
                <input
                  className="inspector-input"
                  type="number"
                  value={Math.round(cfg.x)}
                  disabled={disabled}
                  onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateLayer(id, 'rotation', parseFloat(e.target.value) || 0)}
                />
              </div>
              <div className="editor-field-row" style={{ alignItems: 'center' }}>
                <label
                  className="inspector-label"
                  style={{ margin: 0, whiteSpace: 'nowrap', fontSize: 10 }}
                  onClick={(e) => e.stopPropagation()}
                >
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
            <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
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
