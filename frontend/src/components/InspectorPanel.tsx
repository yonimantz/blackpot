import { useWorkflowStore, isNodeEffectivelyBypassed } from '../store/workflowStore';
import {
  NODE_TYPE_DEFINITIONS,
  NODE_CATEGORIES,
  MAX_COMPOSITOR_LAYERS,
  MAX_VIGNETTE_LAYERS,
  GPT_IMAGE_2_MAX_REFERENCE_IMAGES,
} from '../types/nodeTypes';
import {
  REFMAPPER_ATTRIBUTES_ORDERED,
  REFMAPPER_MAX_ENTRIES,
  REFMAPPER_MAX_IMAGE_INDEX,
  buildRefMapperOutputString,
  buildSketch2FinalOutputString,
  newRefMapperEntryId,
  normalizeRefMapperEntries,
  resolveUpstreamTextOutput,
  sketch2FinalLocalPrompt,
  type RefMapperEntry,
} from '../constants/refMapperAttributes';
import { useCallback, useRef, useMemo, useState } from 'react';
import CompositorModal from './CompositorModal';
import CropModal from './CropModal';
import EditorModal from './EditorModal';
import StudioFields from './StudioFields';
import VignetteModal from './VignetteModal';

export default function InspectorPanel() {
  const {
    nodes,
    selectedNodeId,
    updateNodeData,
    toggleBypass,
    edges,
    isRunning,
    focusedGroupId,
    groups,
  } = useWorkflowStore();

  const [compositorModalOpen, setCompositorModalOpen] = useState(false);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [vignetteModalOpen, setVignetteModalOpen] = useState(false);

  const cropEditorModalNodeId = useWorkflowStore((s) => s.cropEditorModalNodeId);
  const closeCropEditorModal = useWorkflowStore((s) => s.closeCropEditorModal);

  const cropModalEl =
    cropEditorModalNodeId != null ? (
      <CropModal
        key={cropEditorModalNodeId}
        open
        nodeId={cropEditorModalNodeId}
        onClose={closeCropEditorModal}
      />
    ) : null;

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <>
        {cropModalEl}
        <div className="inspector-panel">
          <div className="inspector-header">Inspector</div>
          <div className="inspector-empty">Select a node to inspect</div>
        </div>
      </>
    );
  }

  const def = NODE_TYPE_DEFINITIONS[selectedNode.type!];
  const category = NODE_CATEGORIES[def?.category];
  const data = selectedNode.data;
  const effectiveBypassed = isNodeEffectivelyBypassed(
    selectedNode.id,
    Boolean(data.bypassed),
    focusedGroupId,
    groups,
  );

  const connectedInputs = edges
    .filter((e) => e.target === selectedNode.id)
    .map((e) => ({ handle: e.targetHandle, sourceNode: e.source }));
  const connectedOutputs = edges
    .filter((e) => e.source === selectedNode.id)
    .map((e) => ({ handle: e.sourceHandle, targetNode: e.target }));

  return (
    <>
      {cropModalEl}
      <div className={`inspector-panel ${isRunning ? 'inspector-locked' : ''}`}>
      <div
        className="inspector-header"
        style={{ borderBottomColor: category?.color }}
      >
        <span
          className="inspector-dot"
          style={{ background: category?.color }}
        />
        {def?.label || selectedNode.type}
      </div>

      {isRunning && (
        <div className="inspector-running-notice">
          Workflow is running...
        </div>
      )}

      <div className="inspector-section">
        <label className="inspector-label">Name</label>
        <input
          className="inspector-input"
          value={(data.label as string) || ''}
          onChange={(e) =>
            updateNodeData(selectedNode.id, { label: e.target.value })
          }
          disabled={isRunning}
        />
      </div>

      <div className="inspector-section">
        <label className="inspector-label">
          <input
            type="checkbox"
            checked={effectiveBypassed}
            onChange={() => toggleBypass(selectedNode.id)}
            disabled={isRunning || !!focusedGroupId}
          />
          Bypass (M) · Alt+M clears
        </label>
        {focusedGroupId && (
          <p className="inspector-focus-note">
            Exit focus mode (F) to change bypass.
          </p>
        )}
      </div>

      <div className="inspector-divider" />

      <div className="inspector-section">
        <div className="inspector-section-title">Properties</div>
        <NodePropertyEditor
          nodeId={selectedNode.id}
          type={selectedNode.type!}
          data={data}
          updateNodeData={updateNodeData}
          openCompositorModal={
            selectedNode.type === 'compositor' ? () => setCompositorModalOpen(true) : undefined
          }
          openEditorModal={selectedNode.type === 'editor' ? () => setEditorModalOpen(true) : undefined}
          openVignetteModal={
            selectedNode.type === 'vignette' ? () => setVignetteModalOpen(true) : undefined
          }
          openCropModal={
            selectedNode.type === 'crop'
              ? () => useWorkflowStore.getState().openCropEditorModal(selectedNode.id)
              : undefined
          }
        />
      </div>

      <div className="inspector-divider" />

      <div className="inspector-section">
        <div className="inspector-section-title">Connections</div>
        {connectedInputs.length > 0 && (
          <div className="connection-list">
            <span className="connection-dir">Inputs:</span>
            {connectedInputs.map((c, i) => (
              <div key={i} className="connection-item">
                {c.handle} ← {c.sourceNode}
              </div>
            ))}
          </div>
        )}
        {connectedOutputs.length > 0 && (
          <div className="connection-list">
            <span className="connection-dir">Outputs:</span>
            {connectedOutputs.map((c, i) => (
              <div key={i} className="connection-item">
                {c.handle} → {c.targetNode}
              </div>
            ))}
          </div>
        )}
        {connectedInputs.length === 0 && connectedOutputs.length === 0 && (
          <div className="inspector-empty-small">No connections</div>
        )}
      </div>

      {selectedNode.type === 'preview' && !!data.previewData && (
        <>
          <div className="inspector-divider" />
          <div className="inspector-section">
            <div className="inspector-section-title">Preview</div>
            <img
              src={data.previewData as string}
              alt="Preview"
              className="inspector-preview-img"
            />
          </div>
        </>
      )}

      {!!data._result && (
        <>
          <div className="inspector-divider" />
          <div className="inspector-section">
            <div className="inspector-section-title">Last Result</div>
            <pre className="inspector-result">
              {typeof data._result === 'string'
                ? data._result
                : JSON.stringify(data._result, null, 2)}
            </pre>
          </div>
        </>
      )}

      {selectedNode.type === 'compositor' && (
        <CompositorModal
          open={compositorModalOpen}
          onClose={() => setCompositorModalOpen(false)}
          nodeId={selectedNode.id}
        />
      )}

      {selectedNode.type === 'editor' && (
        <EditorModal
          open={editorModalOpen}
          onClose={() => setEditorModalOpen(false)}
          nodeId={selectedNode.id}
        />
      )}

      {selectedNode.type === 'vignette' && (
        <VignetteModal
          open={vignetteModalOpen}
          onClose={() => setVignetteModalOpen(false)}
          nodeId={selectedNode.id}
        />
      )}
    </div>
    </>
  );
}

function NodePropertyEditor({
  nodeId,
  type,
  data,
  updateNodeData,
  openCompositorModal,
  openEditorModal,
  openVignetteModal,
  openCropModal,
}: {
  nodeId: string;
  type: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  openCompositorModal?: () => void;
  openEditorModal?: () => void;
  openVignetteModal?: () => void;
  openCropModal?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        updateNodeData(nodeId, { fileData: dataUrl, filePath: file.name });
      };
      reader.readAsDataURL(file);
    },
    [nodeId, updateNodeData]
  );

  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  switch (type) {
    case 'prompt':
      return (
        <div className="prop-group">
          <label className="inspector-label">Prompt Text</label>
          <textarea
            className="inspector-textarea"
            value={data.value as string}
            onChange={(e) => update('value', e.target.value)}
            rows={6}
            placeholder="Enter your prompt text..."
          />
        </div>
      );

    case 'combinePrompts':
      return <CombinePromptsEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />;

    case 'refMapper':
      return <RefMapperEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />;

    case 'sketch2Final':
      return <Sketch2FinalEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />;

    case 'studio':
      return <StudioFields nodeId={nodeId} data={data} showOutputPreview />;

    case 'importImage':
      return (
        <div className="prop-group">
          <button className="inspector-btn" onClick={() => fileInputRef.current?.click()}>
            Choose File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          {data.filePath && <div className="prop-file-name">{data.filePath as string}</div>}
        </div>
      );

    case 'exportImage':
      return (
        <div className="prop-group">
          <label className="inspector-label">Export Path (local)</label>
          <input
            className="inspector-input"
            value={(data.exportPath as string) || ''}
            onChange={(e) => update('exportPath', e.target.value)}
            placeholder="D:\output\image.png"
          />
          {data.exportPath && (
            <div className="prop-file-name" title={data.exportPath as string}>
              {data.exportPath as string}
            </div>
          )}
          <label className="inspector-label">File Name</label>
          <input
            className="inspector-input"
            value={data.fileName as string}
            onChange={(e) => update('fileName', e.target.value)}
          />
          <label className="inspector-label">Format</label>
          <select
            className="inspector-select"
            value={data.format as string}
            onChange={(e) => update('format', e.target.value)}
          >
            <option value="png">PNG</option>
            <option value="jpg">JPG</option>
            <option value="webp">WEBP</option>
          </select>
          {data._lastExportedPath && (
            <div className="export-result-info">
              <span className="export-result-check">Exported to:</span>
              <span className="export-result-path">{data._lastExportedPath as string}</span>
            </div>
          )}
        </div>
      );

    case 'resize':
      return (
        <div className="prop-group">
          <label className="inspector-label">Width</label>
          <input
            className="inspector-input"
            type="number"
            value={data.width as number}
            onChange={(e) => update('width', parseInt(e.target.value) || 0)}
          />
          <label className="inspector-label">Height</label>
          <input
            className="inspector-input"
            type="number"
            value={data.height as number}
            onChange={(e) => update('height', parseInt(e.target.value) || 0)}
          />
          <label className="inspector-label">
            <input
              type="checkbox"
              checked={data.keepAspect as boolean}
              onChange={(e) => update('keepAspect', e.target.checked)}
            />
            Keep Aspect Ratio
          </label>
        </div>
      );

    case 'crop':
      return (
        <CropPropertyEditor
          nodeId={nodeId}
          data={data}
          updateNodeData={updateNodeData}
          onOpenCrop={openCropModal}
        />
      );

    case 'setAlpha':
      return (
        <div className="prop-group">
          <label className="inspector-label">Alpha (0-1)</label>
          <input
            className="inspector-range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={data.alpha as number}
            onChange={(e) => update('alpha', parseFloat(e.target.value))}
          />
          <span className="range-value">{(data.alpha as number).toFixed(2)}</span>
        </div>
      );

    case 'blur':
      return (
        <div className="prop-group">
          <label className="inspector-label">Radius</label>
          <input
            className="inspector-range"
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={data.radius as number}
            onChange={(e) => update('radius', parseFloat(e.target.value))}
          />
          <span className="range-value">{data.radius as number}</span>
        </div>
      );

    case 'rotate':
      return (
        <div className="prop-group">
          <label className="inspector-label">Angle</label>
          <input
            className="inspector-range"
            type="range"
            min={0}
            max={360}
            value={data.angle as number}
            onChange={(e) => update('angle', parseInt(e.target.value))}
          />
          <span className="range-value">{data.angle as number}°</span>
          <label className="inspector-label">
            <input
              type="checkbox"
              checked={data.flipH as boolean}
              onChange={(e) => update('flipH', e.target.checked)}
            />
            Flip Horizontal
          </label>
          <label className="inspector-label">
            <input
              type="checkbox"
              checked={data.flipV as boolean}
              onChange={(e) => update('flipV', e.target.checked)}
            />
            Flip Vertical
          </label>
        </div>
      );

    case 'numberValue':
      return (
        <div className="prop-group">
          <label className="inspector-label">Value</label>
          <input
            className="inspector-input"
            type="number"
            value={data.value as number}
            onChange={(e) => update('value', parseFloat(e.target.value) || 0)}
          />
        </div>
      );

    case 'colorValue':
      return (
        <div className="prop-group">
          <label className="inspector-label">Color</label>
          <input
            className="inspector-color"
            type="color"
            value={data.value as string}
            onChange={(e) => update('value', e.target.value)}
          />
          <input
            className="inspector-input"
            value={data.value as string}
            onChange={(e) => update('value', e.target.value)}
          />
        </div>
      );

    case 'getImageSize': {
      const sizeResult = data._result as Record<string, any> | undefined;
      return (
        <div className="prop-group">
          <div className="inspector-empty-small">
            Connect an image input to read its size
          </div>
          {sizeResult?.width != null && sizeResult?.height != null && (
            <div className="inspector-size-result">
              <div className="size-result-row">
                <span className="size-result-label">Width</span>
                <span className="size-result-value">{sizeResult.width}px</span>
              </div>
              <div className="size-result-row">
                <span className="size-result-label">Height</span>
                <span className="size-result-value">{sizeResult.height}px</span>
              </div>
              <div className="size-result-total">
                {sizeResult.width} × {sizeResult.height} px
              </div>
            </div>
          )}
        </div>
      );
    }

    case 'getColorPalette':
      return (
        <div className="prop-group">
          <label className="inspector-label">Number of Colors</label>
          <input
            className="inspector-input"
            type="number"
            min={1}
            max={30}
            value={data.count as number}
            onChange={(e) => update('count', Math.max(1, Math.min(30, parseInt(e.target.value) || 5)))}
          />
          <div className="inspector-empty-small" style={{ opacity: 0.6, marginTop: 4 }}>
            Outputs a swatch image strip and hex color values
          </div>
        </div>
      );

    case 'editor':
      return (
        <EditorPropertyEditor
          nodeId={nodeId}
          data={data}
          updateNodeData={updateNodeData}
          onOpenEditor={openEditorModal}
        />
      );

    case 'compositor':
      return (
        <CompositorInspectorSummary
          nodeId={nodeId}
          data={data}
          updateNodeData={updateNodeData}
          onOpenCompositor={openCompositorModal}
        />
      );

    case 'vignette':
      return (
        <VignetteInspectorSummary
          data={data}
          onOpenVignette={openVignetteModal}
        />
      );

    case 'nanoBananaPro':
      return (
        <NanoBananaProEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'nanoBanana2':
      return (
        <NanoBanana2Editor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'gptImage2':
      return (
        <GptImage2Editor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'imageScfPrompt':
      return (
        <ImageScfPromptEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'preview':
      return null;

    default:
      return <div className="inspector-empty-small">No editable properties</div>;
  }
}

function VignetteInspectorSummary({
  data,
  onOpenVignette,
}: {
  data: Record<string, any>;
  onOpenVignette?: () => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const n = Array.isArray(data.vignetteLayers) ? data.vignetteLayers.length : 0;

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Connect an image, then stack up to {MAX_VIGNETTE_LAYERS} vignette layers (circle or square falloff, color,
        blend, size, feather).
      </div>
      <button
        type="button"
        className="inspector-btn"
        disabled={isRunning || !onOpenVignette}
        onClick={() => onOpenVignette?.()}
      >
        Open Vignette
      </button>
      <div className="inspector-empty-small" style={{ marginTop: 8 }}>
        {n}/{MAX_VIGNETTE_LAYERS} layers — preview updates in the window; run workflow to bake output.
      </div>
    </div>
  );
}

function CropPropertyEditor({
  nodeId,
  data,
  updateNodeData,
  onOpenCrop,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  onOpenCrop?: () => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const update = (field: string, v: number) => updateNodeData(nodeId, { [field]: v });

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Connect an image, then adjust the crop in the crop window or type exact pixels below.
      </div>
      <button
        type="button"
        className="inspector-btn"
        disabled={isRunning || !onOpenCrop}
        onClick={() => onOpenCrop?.()}
      >
        Open Crop
      </button>
      <label className="inspector-label" style={{ marginTop: 12 }}>
        Rectangle (px)
      </label>
      {(['x', 'y', 'width', 'height'] as const).map((field) => (
        <div key={field}>
          <label className="inspector-label">{field.toUpperCase()}</label>
          <input
            className="inspector-input"
            type="number"
            min={field === 'width' || field === 'height' ? 1 : 0}
            value={data[field] as number}
            disabled={isRunning}
            onChange={(e) =>
              update(
                field,
                field === 'width' || field === 'height'
                  ? Math.max(1, parseInt(e.target.value, 10) || 1)
                  : parseInt(e.target.value, 10) || 0,
              )
            }
          />
        </div>
      ))}
    </div>
  );
}

function CompositorInspectorSummary({
  nodeId,
  data,
  updateNodeData,
  onOpenCompositor,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  onOpenCompositor?: () => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const cw = Math.max(1, Math.min(8192, Number(data.width) || 512));
  const ch = Math.max(1, Math.min(8192, Number(data.height) || 512));
  const n = Array.isArray(data.layers) ? data.layers.length : 0;

  const updateDim = (key: 'width' | 'height', v: number) => {
    updateNodeData(nodeId, { [key]: Math.max(1, Math.min(8192, v)) });
  };

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Optional Background input replaces the flat grey canvas. Add and edit shapes in the compositor window.
      </div>
      <label className="inspector-label">Canvas size (px)</label>
      <div className="editor-field-row" style={{ marginBottom: 8 }}>
        <label style={{ minWidth: 14 }}>W</label>
        <input
          className="inspector-input"
          type="number"
          min={1}
          max={8192}
          value={cw}
          onChange={(e) => updateDim('width', parseInt(e.target.value, 10) || 1)}
          disabled={isRunning}
        />
        <label style={{ minWidth: 14 }}>H</label>
        <input
          className="inspector-input"
          type="number"
          min={1}
          max={8192}
          value={ch}
          onChange={(e) => updateDim('height', parseInt(e.target.value, 10) || 1)}
          disabled={isRunning}
        />
      </div>
      <button
        type="button"
        className="inspector-btn"
        disabled={isRunning || !onOpenCompositor}
        onClick={() => onOpenCompositor?.()}
      >
        Open Compositor
      </button>
      <div className="inspector-empty-small" style={{ marginTop: 8 }}>
        {n}/{MAX_COMPOSITOR_LAYERS} layers — drag shapes on the canvas to move, scale, and rotate.
      </div>
    </div>
  );
}

function RefMapperEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const entries = useMemo(() => normalizeRefMapperEntries(data), [data]);

  const persistEntries = (next: RefMapperEntry[]) => {
    updateNodeData(nodeId, {
      refMapperEntries: next,
      refAttributes: undefined,
      refImageCount: undefined,
      fallbackPrompt: undefined,
    });
  };

  const addEntry = () => {
    if (entries.length >= REFMAPPER_MAX_ENTRIES) return;
    persistEntries([
      ...entries,
      { id: newRefMapperEntryId(), imageIndex: 1, attributes: [] },
    ]);
  };

  const removeEntry = (entryId: string) => {
    persistEntries(entries.filter((e) => e.id !== entryId));
  };

  const setImageIndex = (entryId: string, imageIndex: number) => {
    const n = Math.min(
      REFMAPPER_MAX_IMAGE_INDEX,
      Math.max(1, Math.round(Number(imageIndex)) || 1),
    );
    persistEntries(entries.map((e) => (e.id === entryId ? { ...e, imageIndex: n } : e)));
  };

  const toggleAttribute = (entryId: string, attrId: string) => {
    persistEntries(
      entries.map((e) => {
        if (e.id !== entryId) return e;
        const has = e.attributes.includes(attrId);
        const attributes = has
          ? e.attributes.filter((a) => a !== attrId)
          : [...e.attributes, attrId];
        return { ...e, attributes };
      }),
    );
  };

  const outputPreview = useMemo(() => buildRefMapperOutputString(data), [data]);

  const imageOptions = useMemo(
    () => Array.from({ length: REFMAPPER_MAX_IMAGE_INDEX }, (_, i) => i + 1),
    [],
  );

  return (
    <div className="prop-group">
      <div className="inspector-empty-small" style={{ marginBottom: 10, lineHeight: 1.45 }}>
        Outputs reference instructions only. Wire images into your image model as usual. The number
        you pick here is which reference image (1–14) each line applies to. Combine this node&apos;s
        text with your main prompt using <strong>Combine Prompts</strong>.
      </div>

      <div className="combine-input-controls" style={{ marginBottom: 8 }}>
        <span className="combine-input-count">
          {entries.length} / {REFMAPPER_MAX_ENTRIES} reference block{entries.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="inspector-btn-small"
          onClick={addEntry}
          disabled={entries.length >= REFMAPPER_MAX_ENTRIES}
        >
          + Add image
        </button>
      </div>

      {entries.map((entry) => (
        <div key={entry.id} className="inspector-refmapper-card">
          <div className="inspector-refmapper-card-head">
            <label className="inspector-label" style={{ marginBottom: 0 }}>
              Reference image
            </label>
            <button
              type="button"
              className="inspector-btn-small danger"
              onClick={() => removeEntry(entry.id)}
              title="Remove this block"
            >
              Remove
            </button>
          </div>
          <select
            className="inspector-select"
            value={entry.imageIndex}
            onChange={(e) => setImageIndex(entry.id, Number(e.target.value))}
            aria-label="Reference image index"
          >
            {imageOptions.map((n) => (
              <option key={n} value={n}>
                Image {n}
              </option>
            ))}
          </select>
          <div className="inspector-label" style={{ marginTop: 10, marginBottom: 6 }}>
            Use from this image
          </div>
          <div className="refmapper-tag-row" role="group" aria-label="Reference aspects">
            {REFMAPPER_ATTRIBUTES_ORDERED.map((attr) => {
              const on = entry.attributes.includes(attr.id);
              return (
                <button
                  key={attr.id}
                  type="button"
                  className={`refmapper-tag${on ? ' refmapper-tag-on' : ''}`}
                  onClick={() => toggleAttribute(entry.id, attr.id)}
                  aria-pressed={on}
                >
                  {attr.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {entries.length === 0 ? (
        <div className="inspector-empty-small" style={{ fontStyle: 'italic', marginTop: 4 }}>
          No blocks yet — click <strong>Add image</strong> to configure reference lines.
        </div>
      ) : null}

      {outputPreview ? (
        <>
          <label className="inspector-label">Output preview</label>
          <pre className="inspector-result inspector-refmapper-preview">{outputPreview}</pre>
          <div className="combine-char-count-inspector">{outputPreview.length} characters</div>
        </>
      ) : null}
    </div>
  );
}

const SKETCH2_FINAL_LEVEL_OPTIONS = [
  { id: 'scratch' as const, label: 'Doodle' },
  { id: 'rough' as const, label: 'Rough' },
  { id: 'detailed' as const, label: 'High detailed' },
];

function Sketch2FinalEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);

  const promptEdge = useMemo(
    () => edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt'),
    [edges, nodeId],
  );

  const wiredPromptText = useMemo(() => {
    if (!promptEdge) return null;
    return resolveUpstreamTextOutput(promptEdge.source, edges, allNodes);
  }, [promptEdge, edges, allNodes]);

  const outputPreview = useMemo(() => {
    const local = sketch2FinalLocalPrompt(data);
    const base = promptEdge
      ? (wiredPromptText || '').trim() || local
      : local;
    return buildSketch2FinalOutputString(data, base);
  }, [promptEdge, wiredPromptText, data]);

  const isPromptConnected = promptEdge != null;
  const sketchLevel = SKETCH2_FINAL_LEVEL_OPTIONS.some((o) => o.id === data.sketchLevel)
    ? (data.sketchLevel as string)
    : 'rough';

  return (
    <div className="prop-group">
      <label className="inspector-label">
        Prompt
        {isPromptConnected && <span className="inspector-connected-badge">connected</span>}
      </label>
      {isPromptConnected ? (
        <div className="inspector-connected-prompt">
          <div className="connected-prompt-text">
            {(wiredPromptText || '').trim()
              ? (wiredPromptText || '').trim()
              : '(empty from source — local text below is used)'}
          </div>
          <div className="connected-prompt-hint">
            Driven by the connected node when non-empty; otherwise local text is used.
          </div>
        </div>
      ) : null}
      <label className="inspector-label">Prompt text (on node / when input empty)</label>
      <textarea
        className="inspector-textarea"
        value={(data.value as string) || ''}
        onChange={(e) => updateNodeData(nodeId, { value: e.target.value })}
        rows={4}
        placeholder="Describe the content in the sketch"
      />

      <label className="inspector-label">Sketch level</label>
      <div className="refmapper-attr-grid" style={{ marginBottom: 8 }}>
        {SKETCH2_FINAL_LEVEL_OPTIONS.map((opt) => (
          <label key={opt.id} className="refmapper-attr-item">
            <input
              type="radio"
              name={`sketch-level-${nodeId}`}
              checked={sketchLevel === opt.id}
              onChange={() => updateNodeData(nodeId, { sketchLevel: opt.id })}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>

      <label className="inspector-label">
        <input
          type="checkbox"
          checked={Boolean(data.coloredSketch)}
          onChange={(e) => updateNodeData(nodeId, { coloredSketch: e.target.checked })}
        />{' '}
        Colored sketch (use color from sketch)
      </label>

      <label className="inspector-label">Output preview</label>
      <pre className="inspector-result inspector-refmapper-preview">{outputPreview}</pre>
      <div className="combine-char-count-inspector">{outputPreview.length} characters</div>
    </div>
  );
}

function CombinePromptsEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);

  const inputCount = (data.inputCount as number) || 2;
  const separator = (data.separator as string) || '\n';

  const combinedText = useMemo(() => {
    const connectedEdges = edges.filter((e) => e.target === nodeId);
    const texts: string[] = [];
    for (let i = 1; i <= inputCount; i++) {
      const edge = connectedEdges.find((e) => e.targetHandle === `text${i}`);
      if (edge) {
        const piece = resolveUpstreamTextOutput(edge.source, edges, allNodes).trim();
        if (piece) texts.push(piece);
      }
    }
    return texts.join(separator);
  }, [edges, allNodes, nodeId, inputCount, separator]);

  const handleRemoveInput = () => {
    if (inputCount <= 2) return;
    const handleToRemove = `text${inputCount}`;
    const edgesToRemove = edges
      .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
      .map((e) => e.id);
    if (edgesToRemove.length > 0) {
      removeEdgesByIds(edgesToRemove);
    }
    updateNodeData(nodeId, { inputCount: inputCount - 1 });
  };

  return (
    <div className="prop-group">
      <label className="inspector-label">Inputs</label>
      <div className="combine-input-controls">
        <span className="combine-input-count">{inputCount} text inputs</span>
        <button
          className="inspector-btn-small"
          onClick={() => updateNodeData(nodeId, { inputCount: inputCount + 1 })}
        >
          + Add
        </button>
        <button
          className="inspector-btn-small danger"
          onClick={handleRemoveInput}
          disabled={inputCount <= 2}
        >
          − Remove
        </button>
      </div>

      <label className="inspector-label">Separator</label>
      <select
        className="inspector-select"
        value={separator}
        onChange={(e) => updateNodeData(nodeId, { separator: e.target.value })}
      >
        <option value={'\n'}>New Line</option>
        <option value=" ">Space</option>
        <option value=", ">Comma</option>
        <option value=" | ">Pipe</option>
        <option value="">None</option>
      </select>

      {combinedText && (
        <>
          <label className="inspector-label">Combined Text Preview</label>
          <pre className="inspector-result">{combinedText}</pre>
          <div className="combine-char-count-inspector">{combinedText.length} characters</div>
        </>
      )}
    </div>
  );
}

function NanoBananaProEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);

  const refImageCount = (data.refImageCount as number) || 1;

  const promptEdge = useMemo(
    () => edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt'),
    [edges, nodeId],
  );

  const connectedPrompt = useMemo(() => {
    if (!promptEdge) return null;
    return resolveUpstreamTextOutput(promptEdge.source, edges, allNodes).trim();
  }, [promptEdge, edges, allNodes, nodeId]);

  const isPromptConnected = promptEdge != null;

  const handleRemoveImage = () => {
    if (refImageCount <= 1) return;
    const handleToRemove = `referenceImage${refImageCount}`;
    const edgesToRemove = edges
      .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
      .map((e) => e.id);
    if (edgesToRemove.length > 0) {
      removeEdgesByIds(edgesToRemove);
    }
    updateNodeData(nodeId, { refImageCount: refImageCount - 1 });
  };

  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  return (
    <div className="prop-group">
      <div className="inspector-empty-small" style={{ opacity: 0.75, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}>
        gemini-3-pro-image-preview
      </div>

      <label className="inspector-label">
        Prompt
        {isPromptConnected && (
          <span className="inspector-connected-badge">connected</span>
        )}
      </label>
      {isPromptConnected ? (
        <div className="inspector-connected-prompt">
          <div className="connected-prompt-text">
            {connectedPrompt && connectedPrompt.length > 0
              ? connectedPrompt
              : '(empty from source — check upstream text nodes)'}
          </div>
          <div className="connected-prompt-hint">
            Prompt is driven by connected node. Disconnect to edit manually.
          </div>
        </div>
      ) : (
        <textarea
          className="inspector-textarea"
          value={data.prompt as string}
          onChange={(e) => update('prompt', e.target.value)}
          rows={3}
          placeholder="Describe the image you want to generate..."
        />
      )}

      <label className="inspector-label">Reference Images</label>
      <div className="combine-input-controls">
        <span className="combine-input-count">{refImageCount} image input{refImageCount > 1 ? 's' : ''}</span>
        <button
          className="inspector-btn-small"
          onClick={() => update('refImageCount', refImageCount + 1)}
        >
          + Add
        </button>
        <button
          className="inspector-btn-small danger"
          onClick={handleRemoveImage}
          disabled={refImageCount <= 1}
        >
          − Remove
        </button>
      </div>

      <label className="inspector-label">Aspect Ratio</label>
      <select
        className="inspector-select"
        value={data.aspectRatio as string}
        onChange={(e) => update('aspectRatio', e.target.value)}
      >
        <option value="1:1">1:1</option>
        <option value="3:4">3:4</option>
        <option value="4:3">4:3</option>
        <option value="3:2">3:2</option>
        <option value="2:3">2:3</option>
        <option value="9:16">9:16</option>
        <option value="16:9">16:9</option>
        <option value="21:9">21:9</option>
      </select>

      <label className="inspector-label">Resolution</label>
      <select
        className="inspector-select"
        value={data.resolution as string}
        onChange={(e) => update('resolution', e.target.value)}
      >
        <option value="1k">1K</option>
        <option value="2k">2K</option>
        <option value="4k">4K</option>
      </select>

      <label className="inspector-label">Output Format</label>
      <select
        className="inspector-select"
        value={data.outputMimeType as string}
        onChange={(e) => update('outputMimeType', e.target.value)}
      >
        <option value="image/png">PNG (lossless)</option>
        <option value="image/jpeg">JPEG</option>
      </select>

      <label className="inspector-label">Seed (0 = random)</label>
      <input
        className="inspector-input"
        type="number"
        min={0}
        value={data.seed as number}
        onChange={(e) => update('seed', parseInt(e.target.value) || 0)}
      />
    </div>
  );
}

function NanoBanana2Editor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);

  const refImageCount = (data.refImageCount as number) || 1;

  const promptEdge = useMemo(
    () => edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt'),
    [edges, nodeId],
  );

  const connectedPrompt = useMemo(() => {
    if (!promptEdge) return null;
    return resolveUpstreamTextOutput(promptEdge.source, edges, allNodes).trim();
  }, [promptEdge, edges, allNodes, nodeId]);

  const isPromptConnected = promptEdge != null;

  const handleRemoveImage = () => {
    if (refImageCount <= 1) return;
    const handleToRemove = `referenceImage${refImageCount}`;
    const edgesToRemove = edges
      .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
      .map((e) => e.id);
    if (edgesToRemove.length > 0) {
      removeEdgesByIds(edgesToRemove);
    }
    updateNodeData(nodeId, { refImageCount: refImageCount - 1 });
  };

  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  return (
    <div className="prop-group">
      <div className="inspector-empty-small" style={{ opacity: 0.75, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}>
        gemini-3.1-flash-image-preview
      </div>

      <label className="inspector-label">Thinking Mode</label>
      <select
        className="inspector-select"
        value={(data.thinkingMode as string) || 'off'}
        onChange={(e) => update('thinkingMode', e.target.value)}
      >
        <option value="off">Off</option>
        <option value="minimal">Minimal</option>
        <option value="high">High</option>
        <option value="dynamic">Dynamic</option>
      </select>

      <label className="inspector-label">
        Prompt
        {isPromptConnected && (
          <span className="inspector-connected-badge">connected</span>
        )}
      </label>
      {isPromptConnected ? (
        <div className="inspector-connected-prompt">
          <div className="connected-prompt-text">
            {connectedPrompt && connectedPrompt.length > 0
              ? connectedPrompt
              : '(empty from source — check upstream text nodes)'}
          </div>
          <div className="connected-prompt-hint">
            Prompt is driven by connected node. Disconnect to edit manually.
          </div>
        </div>
      ) : (
        <textarea
          className="inspector-textarea"
          value={data.prompt as string}
          onChange={(e) => update('prompt', e.target.value)}
          rows={3}
          placeholder="Describe the image you want to generate..."
        />
      )}

      <label className="inspector-label">Reference Images</label>
      <div className="combine-input-controls">
        <span className="combine-input-count">{refImageCount} image input{refImageCount > 1 ? 's' : ''}</span>
        <button
          className="inspector-btn-small"
          onClick={() => update('refImageCount', refImageCount + 1)}
        >
          + Add
        </button>
        <button
          className="inspector-btn-small danger"
          onClick={handleRemoveImage}
          disabled={refImageCount <= 1}
        >
          − Remove
        </button>
      </div>

      <label className="inspector-label">Aspect Ratio</label>
      <select
        className="inspector-select"
        value={data.aspectRatio as string}
        onChange={(e) => update('aspectRatio', e.target.value)}
      >
        <option value="1:1">1:1</option>
        <option value="3:4">3:4</option>
        <option value="4:3">4:3</option>
        <option value="3:2">3:2</option>
        <option value="2:3">2:3</option>
        <option value="5:4">5:4</option>
        <option value="4:5">4:5</option>
        <option value="9:16">9:16</option>
        <option value="16:9">16:9</option>
        <option value="21:9">21:9</option>
        <option value="1:2">1:2</option>
        <option value="2:1">2:1</option>
        <option value="1:8">1:8</option>
        <option value="8:1">8:1</option>
      </select>

      <label className="inspector-label">Resolution</label>
      <select
        className="inspector-select"
        value={data.resolution as string}
        onChange={(e) => update('resolution', e.target.value)}
      >
        <option value="512">512</option>
        <option value="1k">1K</option>
        <option value="2k">2K</option>
        <option value="4k">4K</option>
      </select>

      <label className="inspector-label">Output Format</label>
      <select
        className="inspector-select"
        value={data.outputMimeType as string}
        onChange={(e) => update('outputMimeType', e.target.value)}
      >
        <option value="image/png">PNG (lossless)</option>
        <option value="image/jpeg">JPEG</option>
      </select>

      <label className="inspector-label">Seed (0 = random)</label>
      <input
        className="inspector-input"
        type="number"
        min={0}
        value={data.seed as number}
        onChange={(e) => update('seed', parseInt(e.target.value) || 0)}
      />
    </div>
  );
}

const GPT_IMAGE_2_POPULAR_SIZES = new Set([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840',
]);

/** Older workflows used `aspectRatio` — map to OpenAI popular `size` strings. */
const GPT_IMAGE_2_LEGACY_ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '3:4': '1024x1536',
  '4:3': '1536x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '9:16': '1024x1536',
  '16:9': '2048x1152',
  '21:9': 'auto',
  '5:4': '1536x1024',
  '4:5': '1024x1536',
  '1:2': '1024x1536',
  '2:1': '1536x1024',
  '1:8': 'auto',
  '8:1': 'auto',
};

function GptImage2Editor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);

  const refImageCount = (data.refImageCount as number) || 1;

  const imageSizeSelectValue = useMemo(() => {
    const cur = String(data.imageSize || '').trim();
    if (GPT_IMAGE_2_POPULAR_SIZES.has(cur)) return cur;
    const ar = String(data.aspectRatio || '').trim();
    return GPT_IMAGE_2_LEGACY_ASPECT_TO_SIZE[ar] || 'auto';
  }, [data.imageSize, data.aspectRatio]);

  const promptEdge = useMemo(
    () => edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt'),
    [edges, nodeId],
  );

  const connectedPrompt = useMemo(() => {
    if (!promptEdge) return null;
    return resolveUpstreamTextOutput(promptEdge.source, edges, allNodes).trim();
  }, [promptEdge, edges, allNodes, nodeId]);

  const isPromptConnected = promptEdge != null;

  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  const handleRemoveImage = () => {
    if (refImageCount <= 1) return;
    const handleToRemove = `referenceImage${refImageCount}`;
    const edgesToRemove = edges
      .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
      .map((e) => e.id);
    if (edgesToRemove.length > 0) {
      removeEdgesByIds(edgesToRemove);
    }
    updateNodeData(nodeId, { refImageCount: refImageCount - 1 });
  };

  const fmt = (data.outputFormat as string) || 'png';
  const showCompression = fmt === 'jpeg' || fmt === 'webp';

  return (
    <div className="prop-group">
      <div className="inspector-empty-small" style={{ opacity: 0.75, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}>
        gpt-image-2
      </div>

      <label className="inspector-label">
        Prompt
        {isPromptConnected && (
          <span className="inspector-connected-badge">connected</span>
        )}
      </label>
      {isPromptConnected ? (
        <div className="inspector-connected-prompt">
          <div className="connected-prompt-text">
            {connectedPrompt && connectedPrompt.length > 0
              ? connectedPrompt
              : '(empty from source — check upstream text nodes)'}
          </div>
          <div className="connected-prompt-hint">
            Prompt is driven by connected node. Disconnect to edit manually.
          </div>
        </div>
      ) : (
        <textarea
          className="inspector-textarea"
          value={data.prompt as string}
          onChange={(e) => update('prompt', e.target.value)}
          rows={3}
          placeholder="Describe the image you want to generate..."
        />
      )}

      <label className="inspector-label">Reference Images</label>
      <div className="combine-input-controls">
        <span className="combine-input-count">
          {refImageCount} image input{refImageCount > 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="inspector-btn-small"
          disabled={refImageCount >= GPT_IMAGE_2_MAX_REFERENCE_IMAGES}
          onClick={() => update('refImageCount', refImageCount + 1)}
        >
          + Add
        </button>
        <button
          type="button"
          className="inspector-btn-small danger"
          onClick={handleRemoveImage}
          disabled={refImageCount <= 1}
        >
          − Remove
        </button>
      </div>

      <label className="inspector-label">Output size</label>
      <select
        className="inspector-select"
        value={imageSizeSelectValue}
        onChange={(e) => updateNodeData(nodeId, { imageSize: e.target.value })}
      >
        <option value="auto">Auto</option>
        <option value="1024x1024">1:1 · 1K</option>
        <option value="1536x1024">3:2 · 1K</option>
        <option value="1024x1536">2:3 · 1K</option>
        <option value="2048x2048">1:1 · 2K</option>
        <option value="2048x1152">16:9 · 2K</option>
        <option value="3840x2160">16:9 · 4K</option>
        <option value="2160x3840">9:16 · 4K</option>
      </select>

      <label className="inspector-label">Quality</label>
      <select
        className="inspector-select"
        value={(data.quality as string) || 'auto'}
        onChange={(e) => update('quality', e.target.value)}
      >
        <option value="auto">Auto</option>
        <option value="low">Low (fast)</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>

      <label className="inspector-label">Output format</label>
      <select
        className="inspector-select"
        value={(data.outputFormat as string) || 'png'}
        onChange={(e) => update('outputFormat', e.target.value)}
      >
        <option value="png">PNG</option>
        <option value="jpeg">JPEG</option>
        <option value="webp">WebP</option>
      </select>

      {showCompression && (
        <>
          <label className="inspector-label">Compression (0–100%, JPEG/WebP)</label>
          <input
            className="inspector-input"
            type="number"
            min={0}
            max={100}
            value={Number(data.outputCompression) || 0}
            onChange={(e) => update('outputCompression', Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
          />
        </>
      )}

      <label className="inspector-label">Moderation</label>
      <select
        className="inspector-select"
        value={(data.moderation as string) || 'auto'}
        onChange={(e) => update('moderation', e.target.value)}
      >
        <option value="auto">Auto</option>
        <option value="low">Low</option>
      </select>
    </div>
  );
}

function ImageScfPromptEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  const style = data.analyzeStyle !== false;
  const content = data.analyzeContent !== false;
  const feel = data.analyzeFeel !== false;

  return (
    <div className="prop-group">
      <div className="inspector-empty-small" style={{ opacity: 0.75, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}>
        gemini-2.5-flash
      </div>

      <label className="inspector-label">Analyze</label>
      <div className="prop-group" style={{ gap: 6, display: 'flex', flexDirection: 'column' }}>
        <label className="inspector-checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={style}
            onChange={(e) => update('analyzeStyle', e.target.checked)}
          />
          <span>Style (short: brushwork, medium, detail/contrast/saturation—not scene or palette)</span>
        </label>
        <label className="inspector-checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={content}
            onChange={(e) => update('analyzeContent', e.target.checked)}
          />
          <span>Content (very short: subject, pose, expression)</span>
        </label>
        <label className="inspector-checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={feel}
            onChange={(e) => update('analyzeFeel', e.target.checked)}
          />
          <span>Feel (very short mood tags)</span>
        </label>
      </div>
    </div>
  );
}

function EditorPropertyEditor({
  nodeId,
  data,
  updateNodeData,
  onOpenEditor,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  onOpenEditor?: () => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const layerCount = (data.layerCount as number) || 0;
  const layers = (data.layers as Record<string, any>) || {};

  const handleAddLayer = () => {
    const newCount = layerCount + 1;
    const updated = { ...layers };
    updated[`layer${newCount}`] = { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false };
    updateNodeData(nodeId, { layerCount: newCount, layers: updated });
  };

  const handleRemoveLayer = () => {
    if (layerCount <= 0) return;
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
    <div className="prop-group">
      <div className="editor-bg-notice">
        BG Layer is the bottom layer and is not editable — it sets the canvas size. Arrange layers in the editor
        window.
      </div>

      <label className="inspector-label">Layers</label>
      <div className="combine-input-controls">
        <span className="combine-input-count">
          {layerCount} layer{layerCount !== 1 ? 's' : ''}
        </span>
        <button type="button" className="inspector-btn-small" disabled={isRunning} onClick={handleAddLayer}>
          + Add
        </button>
        <button
          type="button"
          className="inspector-btn-small danger"
          disabled={isRunning || layerCount <= 0}
          onClick={handleRemoveLayer}
        >
          − Remove
        </button>
      </div>

      <button
        type="button"
        className="inspector-btn"
        disabled={isRunning || !onOpenEditor}
        onClick={() => onOpenEditor?.()}
      >
        Open Editor
      </button>
      <div className="inspector-empty-small" style={{ marginTop: 8 }}>
        Edit transforms and preview on a large canvas in the editor window.
      </div>
    </div>
  );
}
