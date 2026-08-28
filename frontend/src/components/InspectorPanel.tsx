import { useWorkflowStore } from '../store/workflowStore';
import {
  NODE_TYPE_DEFINITIONS,
  NODE_CATEGORIES,
  MAX_COMPOSITOR_LAYERS,
  MAX_VIGNETTE_LAYERS,
  MAX_STACK_IMAGES,
  MAX_EXPORT_IMAGES,
  MAX_DIVIDER_OUTPUTS,
  MAX_PICK_RANDOM_INPUTS,
  PICK_RANDOM_VALUE_TYPES,
  type PickRandomValueType,
  BOOLEAN_VALUE_TYPES,
  type BooleanValueType,
  FAL_MODEL_SPECS,
  FAL_MODEL_OPTIONS,
  FAL_IMAGE_SIZE_OPTIONS,
  FAL_ASPECT_RATIO_OPTIONS,
  FAL_IMG2IMG_MODELS,
  FAL_MULTI_IMAGE_MODELS,
  FAL_ASPECT_RATIO_MODELS,
  FAL_NO_SIZE_MODELS,
  FAL_NO_STEPS_MODELS,
  FAL_NO_PROMPT_MODELS,
  FAL_REQUIRES_IMAGE_MODELS,
  DEFAULT_IMAGE_TO_3D_MODEL,
  IMAGE_TO_3D_MODEL_SPECS,
  IMAGE_TO_3D_MODEL_OPTIONS,
  DEFAULT_UPSCALER_MODEL,
  UPSCALER_MODEL_SPECS,
  UPSCALER_MODEL_OPTIONS,
  UPSCALER_SCALE_OPTIONS,
  DEFAULT_UPSCALER_SCALE,
  PREVIEW_3D_DISPLAY_MODES,
  normalizePreview3dDisplayMode,
  isNodeTypePinnable,
  isTemplateOutputNodeType,
} from '../types/nodeTypes';
import { getLegacyNodeInfo, type LegacyNodeInfo } from '../types/legacyNodes';
import Icon from '../icons/Icon';
import { iconForNodeType } from '../constants/nodeIcons';
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
import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { getConnectedImageDataUrl, getConnectedModel3d, getNodeImageOutputDataUrl } from '../utils/upstreamImage';
import { bakeCanvasPreview, drawBlur } from '../utils/toolPreviewBake';
import { exportImages, exportModels } from '../utils/api';
import { buildImportImageData } from '../utils/importImageData';
import { buildImport3dData } from '../utils/model3dImport';
import { remapDividerSourceEdges, type DividerSelection } from '../utils/dividerEdges';
import {
  setPickRandomValueType,
  addPickRandomInput,
  removePickRandomInput,
} from '../utils/pickRandom';
import { setBooleanValueType } from '../utils/booleanNode';
import {
  ANCHOR_LABELS,
  RESIZE_MODE_HINTS,
  RESIZE_MODE_LABELS,
  normalizeAnchor,
  normalizeCropAnchor,
  normalizeResizeMode,
  readOffset,
  resizeModeUsesAnchor,
  resolveCropRect,
} from '../utils/anchorPlacement';
import { AnchorOffsetControls } from './AnchorControls';
import CompositorModal from './CompositorModal';
import CropModal from './CropModal';
import DividerModal from './DividerModal';
import EditorModal from './EditorModal';
import KeyColorModal from './KeyColorModal';
import RemoveBgModal from './RemoveBgModal';
import StudioFields from './StudioFields';
import VignetteModal from './VignetteModal';
import AdjustmentsModal from './AdjustmentsModal';
import { normalizeAdjustments, isIdentity as isAdjustmentsIdentity } from '../utils/adjustmentsMath';
import { GenerationMetaInfo, type GenerationMeta } from './GenerationMetaInfo';
import { MATH_OPERATIONS, resolveMathState, type MathOperationId } from '../utils/mathNode';

export default function InspectorPanel() {
  // Subscribe granularly instead of pulling the whole store. The heavy inspector
  // previously re-rendered on every store tick (every box-select / drag frame).
  // `selectedNode` only changes reference when that specific node changes, so
  // box-selecting other nodes no longer re-renders the inspector.
  const selectedNode = useWorkflowStore(
    (s) => s.nodes.find((n) => n.id === s.selectedNodeId) ?? null,
  );
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const toggleBypass = useWorkflowStore((s) => s.toggleBypass);
  const togglePin = useWorkflowStore((s) => s.togglePin);
  const edges = useWorkflowStore((s) => s.edges);
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const [compositorModalOpen, setCompositorModalOpen] = useState(false);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [vignetteModalOpen, setVignetteModalOpen] = useState(false);
  const [adjustmentsModalOpen, setAdjustmentsModalOpen] = useState(false);
  const [keyColorModalOpen, setKeyColorModalOpen] = useState(false);
  const [removeBgModalOpen, setRemoveBgModalOpen] = useState(false);

  const cropEditorModalNodeId = useWorkflowStore((s) => s.cropEditorModalNodeId);
  const closeCropEditorModal = useWorkflowStore((s) => s.closeCropEditorModal);
  const dividerEditorModalNodeId = useWorkflowStore((s) => s.dividerEditorModalNodeId);
  const closeDividerEditorModal = useWorkflowStore((s) => s.closeDividerEditorModal);

  const cropModalEl =
    cropEditorModalNodeId != null ? (
      <CropModal
        key={cropEditorModalNodeId}
        open
        nodeId={cropEditorModalNodeId}
        onClose={closeCropEditorModal}
      />
    ) : null;

  const dividerModalEl =
    dividerEditorModalNodeId != null ? (
      <DividerModal
        key={dividerEditorModalNodeId}
        open
        nodeId={dividerEditorModalNodeId}
        onClose={closeDividerEditorModal}
      />
    ) : null;

  if (!selectedNode) {
    return (
      <>
        {cropModalEl}
        {dividerModalEl}
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
  const effectiveBypassed = Boolean(data.bypassed);

  const connectedInputs = edges
    .filter((e) => e.target === selectedNode.id)
    .map((e) => ({ handle: e.targetHandle, sourceNode: e.source }));
  const connectedOutputs = edges
    .filter((e) => e.source === selectedNode.id)
    .map((e) => ({ handle: e.sourceHandle, targetNode: e.target }));

  return (
    <>
      {cropModalEl}
      {dividerModalEl}
      <div className={`inspector-panel ${isRunning ? 'inspector-locked' : ''}`}>
      <div
        className="inspector-header"
        style={{ borderBottomColor: category?.color }}
      >
        <span
          className="inspector-header-icon"
          style={{ color: category?.color }}
        >
          <Icon name={iconForNodeType(selectedNode.type, def?.category)} size={14} />
        </span>
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
            disabled={isRunning}
          />
          Bypass (M) · Alt+M clears
        </label>
      </div>

      {isNodeTypePinnable(selectedNode.type) && (
        <div className="inspector-section">
          <label className="inspector-label">
            <input
              type="checkbox"
              checked={Boolean(data.pinned)}
              onChange={() => togglePin(selectedNode.id)}
              disabled={isRunning}
            />
            Pin to template
          </label>
          <p className="inspector-focus-note">
            {isTemplateOutputNodeType(selectedNode.type)
              ? 'Pinned results appear in the Playground result panel.'
              : 'Pinned inputs become fields in the Playground template form.'}
          </p>
        </div>
      )}

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
          openAdjustmentsModal={
            selectedNode.type === 'adjustments' ? () => setAdjustmentsModalOpen(true) : undefined
          }
          openCropModal={
            selectedNode.type === 'crop'
              ? () => useWorkflowStore.getState().openCropEditorModal(selectedNode.id)
              : undefined
          }
          openKeyColorModal={
            selectedNode.type === 'keyColor' ? () => setKeyColorModalOpen(true) : undefined
          }
          openRemoveBgModal={
            selectedNode.type === 'removeBg' ? () => setRemoveBgModalOpen(true) : undefined
          }
          openDividerModal={
            selectedNode.type === 'divider'
              ? () => useWorkflowStore.getState().openDividerEditorModal(selectedNode.id)
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
                {c.handle} <Icon name="arrow-left-line" size={11} /> {c.sourceNode}
              </div>
            ))}
          </div>
        )}
        {connectedOutputs.length > 0 && (
          <div className="connection-list">
            <span className="connection-dir">Outputs:</span>
            {connectedOutputs.map((c, i) => (
              <div key={i} className="connection-item">
                {c.handle} <Icon name="arrow-right-line" size={11} /> {c.targetNode}
              </div>
            ))}
          </div>
        )}
        {connectedInputs.length === 0 && connectedOutputs.length === 0 && (
          <div className="inspector-empty-small">No connections</div>
        )}
      </div>

      {selectedNode.type === 'preview' && (
        <PreviewInspectorSection nodeId={selectedNode.id} data={data} />
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

      {selectedNode.type === 'adjustments' && (
        <AdjustmentsModal
          open={adjustmentsModalOpen}
          onClose={() => setAdjustmentsModalOpen(false)}
          nodeId={selectedNode.id}
        />
      )}

      {selectedNode.type === 'keyColor' && (
        <KeyColorModal
          open={keyColorModalOpen}
          onClose={() => setKeyColorModalOpen(false)}
          nodeId={selectedNode.id}
        />
      )}

      {selectedNode.type === 'removeBg' && (
        <RemoveBgModal
          open={removeBgModalOpen}
          onClose={() => setRemoveBgModalOpen(false)}
          nodeId={selectedNode.id}
        />
      )}
    </div>
    </>
  );
}

export function NodePropertyEditor({
  nodeId,
  type,
  data,
  updateNodeData,
  openCompositorModal,
  openEditorModal,
  openVignetteModal,
  openAdjustmentsModal,
  openCropModal,
  openKeyColorModal,
  openRemoveBgModal,
  openDividerModal,
}: {
  nodeId: string;
  type: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  openCompositorModal?: () => void;
  openEditorModal?: () => void;
  openVignetteModal?: () => void;
  openAdjustmentsModal?: () => void;
  openCropModal?: () => void;
  openKeyColorModal?: () => void;
  openRemoveBgModal?: () => void;
  openDividerModal?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importDragActive, setImportDragActive] = useState(false);

  const handleImportFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return;
      updateNodeData(nodeId, await buildImportImageData(file, file.name));
    },
    [nodeId, updateNodeData],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleImportFile(file);
      e.target.value = '';
    },
    [handleImportFile],
  );

  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  const legacyInfo = getLegacyNodeInfo(type);
  if (legacyInfo) {
    return <LegacyNodeEditor info={legacyInfo} />;
  }

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

    case 'note':
      return (
        <div className="prop-group">
          <div className="inspector-empty-small" style={{ lineHeight: 1.45, marginBottom: 8 }}>
            Notes live on the canvas only — they don't connect to anything and
            don't run in the workflow. Use them to leave reminders or context
            for yourself or collaborators.
          </div>
          <label className="inspector-label">Note Text</label>
          <textarea
            className="inspector-textarea"
            value={(data.value as string) || ''}
            onChange={(e) => update('value', e.target.value)}
            rows={6}
            placeholder="Write a note..."
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
        <div
          className={`prop-group inspector-import-drop${importDragActive ? ' inspector-import-drop-active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setImportDragActive(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setImportDragActive(true);
          }}
          onDragLeave={(e) => {
            const rel = e.relatedTarget;
            if (rel && e.currentTarget.contains(rel as Element)) return;
            setImportDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setImportDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleImportFile(file);
          }}
        >
          <button
            type="button"
            className="inspector-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose File
          </button>
          <span className="inspector-import-drop-hint">or drop an image here</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          {data.filePath && <div className="prop-file-name">{data.filePath as string}</div>}
          <ImageSizeInfo src={getNodeImageOutputDataUrl(data) || null} />
        </div>
      );

    case 'exportImage':
      return (
        <ExportImagePropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'export3d':
      return (
        <Export3dPropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'import3d':
      return (
        <Import3dEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'resize':
      return <ResizePropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />;

    case 'crop':
      return (
        <CropPropertyEditor
          nodeId={nodeId}
          data={data}
          updateNodeData={updateNodeData}
          onOpenCrop={openCropModal}
        />
      );

    case 'divider':
      return (
        <DividerPropertyEditor
          nodeId={nodeId}
          data={data}
          onOpenDivider={openDividerModal}
        />
      );

    case 'blur':
      return (
        <BlurPropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
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

    case 'getChannel':
      return (
        <div className="prop-group">
          <div className="inspector-empty-small" style={{ lineHeight: 1.45 }}>
            Splits the input image into four grayscale outputs — one per ARGB
            channel. Each output renders that channel's intensity as a
            grayscale image you can use directly or feed into <strong>Set Mask</strong>.
          </div>
        </div>
      );

    case 'setMask':
      return (
        <div className="prop-group">
          <div className="inspector-empty-small" style={{ lineHeight: 1.45, marginBottom: 8 }}>
            Uses the <strong>Mask</strong> input as a grayscale alpha for the
            <strong> Image</strong> input. White = visible, black = transparent.
            The mask is auto-resized to match the image.
          </div>
          <label className="inspector-label">
            <input
              type="checkbox"
              checked={Boolean(data.invert)}
              onChange={(e) => update('invert', e.target.checked)}
            />
            Invert mask
          </label>
        </div>
      );

    case 'keyColor':
      return (
        <KeyColorPropertyEditor
          nodeId={nodeId}
          data={data}
          updateNodeData={updateNodeData}
          onOpenKeyColor={openKeyColorModal}
        />
      );

    case 'removeBg':
      return (
        <RemoveBgPropertyEditor
          nodeId={nodeId}
          data={data}
          updateNodeData={updateNodeData}
          onOpenRemoveBg={openRemoveBgModal}
        />
      );

    case 'stackImages':
      return (
        <StackImagesPropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'simpleCombine': {
      const opacity = typeof data.opacity === 'number' ? (data.opacity as number) : 1.0;
      return (
        <div className="prop-group">
          <div className="inspector-empty-small" style={{ lineHeight: 1.45, marginBottom: 8 }}>
            Top is composited over Bottom. The opacity slider fades Top.
            Top is resized to match Bottom.
          </div>
          <label className="inspector-label">Opacity (0–1)</label>
          <input
            className="inspector-range"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={opacity}
            onChange={(e) => update('opacity', parseFloat(e.target.value))}
          />
          <span className="range-value">{opacity.toFixed(2)}</span>
        </div>
      );
    }

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

    case 'math':
      return <MathPropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />;

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

    case 'pickRandom':
      return (
        <PickRandomPropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'boolean':
      return <BooleanPropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />;

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

    case 'adjustments':
      return (
        <AdjustmentsInspectorSummary
          data={data}
          onOpenAdjustments={openAdjustmentsModal}
        />
      );

    case 'falAi':
      return (
        <FalAiEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'imageTo3d':
      return (
        <ImageTo3dEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'upscaler':
      return (
        <UpscalerEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'imageScfPrompt':
      return (
        <ImageScfPromptEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    case 'preview':
      return null;

    case 'preview3d':
      return (
        <Preview3dPropertyEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
      );

    default:
      return <div className="inspector-empty-small">No editable properties</div>;
  }
}

function LegacyNodeEditor({ info }: { info: LegacyNodeInfo }) {
  return (
    <div className="inspector-legacy">
      <div className="inspector-legacy-title">This node was removed</div>
      <p className="inspector-legacy-body">
        <strong>{info.label}</strong> ran on a provider SpotOn no longer uses. It is kept here so
        this workflow still opens with its connections intact, but it will fail if you run it.
      </p>
      <p className="inspector-legacy-body">
        Add a <strong>FAL AI</strong> node, set its model to “{info.replacementModel}”, move these
        connections over, and delete this one.
      </p>
    </div>
  );
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

/** Inspector preview that mirrors the in-canvas Preview node: prefers the
 * live upstream image so the size readout reflects the current resize
 * (or other tool) result, and falls back to the cached `previewData`
 * from the last run when the upstream is disconnected. */
function PreviewInspectorSection({
  nodeId,
  data,
}: {
  nodeId: string;
  data: Record<string, any>;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const liveSrc = useMemo(
    () => getConnectedImageDataUrl(nodeId, 'image', edges, allNodes),
    [nodeId, edges, allNodes],
  );
  const src = liveSrc || (data.previewData as string) || '';
  if (!src) return null;
  return (
    <>
      <div className="inspector-divider" />
      <div className="inspector-section">
        <div className="inspector-section-title">Preview</div>
        <img src={src} alt="Preview" className="inspector-preview-img" />
        <ImageSizeInfo src={src} />
        <GenerationMetaInfo meta={data.previewMeta as GenerationMeta | undefined} />
      </div>
    </>
  );
}

function ImageSizeInfo({ src }: { src: string | null | undefined }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!src) {
      setSize(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      if (cancelled) return;
      setSize(null);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src || !size || !size.width || !size.height) return null;

  const g = gcdInt(size.width, size.height);
  const ratio = `${Math.round(size.width / g)}:${Math.round(size.height / g)}`;

  return (
    <div className="inspector-size-result">
      <div className="size-result-row">
        <span className="size-result-label">Width</span>
        <span className="size-result-value">{size.width}px</span>
      </div>
      <div className="size-result-row">
        <span className="size-result-label">Height</span>
        <span className="size-result-value">{size.height}px</span>
      </div>
      <div className="size-result-row">
        <span className="size-result-label">Ratio</span>
        <span className="size-result-value">{ratio}</span>
      </div>
      <div className="size-result-total">
        {size.width} × {size.height} px
      </div>
    </div>
  );
}

/** Mirror of resolveLockedRatio in BaseNode — see comment there for the
 * reasoning (deriving the ratio from the live W/H drifts due to integer
 * rounding, so we keep a stable `_lockedRatio` on node data instead). */
function resolveResizeLockedRatio(data: Record<string, any>): number {
  const stored = Number(data._lockedRatio);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const ow = Number(data._origWidth) || 0;
  const oh = Number(data._origHeight) || 0;
  if (ow > 0 && oh > 0) return ow / oh;
  const w = Number(data.width) || 0;
  const h = Number(data.height) || 0;
  if (w > 0 && h > 0) return w / h;
  return 1;
}

/**
 * Inspector controls for the Resize node. Mirrors the in-canvas UI but
 * lays out everything vertically so the user can read the values clearly.
 * The width/height edits and lock toggle stay in sync with the node body
 * because both are bound to the same node data.
 */
function ResizePropertyEditor({
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

  const upstreamSrc = useMemo(
    () => getConnectedImageDataUrl(nodeId, 'image', edges, allNodes),
    [nodeId, edges, allNodes],
  );

  const aspectLocked = data.aspectLocked !== false;
  const width = Math.max(0, Number(data.width) || 0);
  const height = Math.max(0, Number(data.height) || 0);
  const origW = Math.max(0, Number(data._origWidth) || 0);
  const origH = Math.max(0, Number(data._origHeight) || 0);
  const lockedRatio = resolveResizeLockedRatio(data);
  const mode = normalizeResizeMode(data.resizeMode);
  const anchor = normalizeAnchor(data.anchor);
  const offset = readOffset(data);

  const handleWidthChange = (newW: number) => {
    const w = Math.max(1, Math.round(newW));
    if (aspectLocked && lockedRatio > 0) {
      const h = Math.max(1, Math.round(w / lockedRatio));
      updateNodeData(nodeId, { width: w, height: h });
    } else {
      updateNodeData(nodeId, { width: w });
    }
  };

  const handleHeightChange = (newH: number) => {
    const h = Math.max(1, Math.round(newH));
    if (aspectLocked && lockedRatio > 0) {
      const w = Math.max(1, Math.round(h * lockedRatio));
      updateNodeData(nodeId, { width: w, height: h });
    } else {
      updateNodeData(nodeId, { height: h });
    }
  };

  const handleToggleLock = () => {
    if (!aspectLocked && width > 0 && height > 0) {
      updateNodeData(nodeId, {
        aspectLocked: true,
        _lockedRatio: width / height,
      });
    } else {
      updateNodeData(nodeId, { aspectLocked: !aspectLocked });
    }
  };

  return (
    <div className="prop-group">
      <div className="resize-orig-row inspector-resize-orig-row">
        <span className="resize-orig-label">Original</span>
        <span className="resize-orig-value">
          {origW && origH
            ? `${origW} × ${origH}`
            : upstreamSrc
              ? 'Reading…'
              : 'Connect image'}
        </span>
      </div>
      <label className="inspector-label">Width</label>
      <input
        className="inspector-input"
        type="number"
        min={1}
        value={width || ''}
        onChange={(e) => handleWidthChange(parseInt(e.target.value, 10) || 0)}
      />
      <label className="inspector-label">Height</label>
      <input
        className="inspector-input"
        type="number"
        min={1}
        value={height || ''}
        onChange={(e) => handleHeightChange(parseInt(e.target.value, 10) || 0)}
      />
      <button
        type="button"
        className={`inspector-btn-small${aspectLocked ? '' : ' ghost'}`}
        title={aspectLocked ? 'Aspect ratio is locked' : 'Aspect ratio is free'}
        aria-pressed={aspectLocked}
        onClick={handleToggleLock}
        style={{ marginTop: 8, width: '100%' }}
      >
        <Icon name={aspectLocked ? 'lock-fill' : 'unlock-line'} size={12} />
        {aspectLocked ? 'Aspect Locked' : 'Aspect Free'}
      </button>

      <label className="inspector-label" style={{ marginTop: 12 }}>
        Fill Mode
      </label>
      <div className="tool-pill-row">
        {(['stretch', 'fit', 'canvas'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`tool-pill${mode === m ? ' on' : ''}`}
            title={RESIZE_MODE_HINTS[m]}
            aria-pressed={mode === m}
            onClick={() => updateNodeData(nodeId, { resizeMode: m })}
          >
            {RESIZE_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <div className="inspector-empty-small" style={{ marginTop: 6 }}>
        {RESIZE_MODE_HINTS[mode]}
      </div>

      {resizeModeUsesAnchor(mode) && (
        <>
          <label className="inspector-label" style={{ marginTop: 12 }}>
            Anchor & Offset
          </label>
          <AnchorOffsetControls
            anchor={anchor}
            offsetX={offset.x}
            offsetY={offset.y}
            onAnchorChange={(next) => updateNodeData(nodeId, { anchor: next })}
            onOffsetChange={({ x, y }) => updateNodeData(nodeId, { offsetX: x, offsetY: y })}
            note={`Anchored ${ANCHOR_LABELS[anchor].toLowerCase()}`}
          />
        </>
      )}
    </div>
  );
}

/**
 * Blur has no dedicated modal, so the Apply button that bakes `_blurPreview`
 * lives right here. Baking is what lets a connected Preview node (and the
 * node's own thumbnail, see `BlurNodeContent`) show the blurred result
 * without a workflow run — canvas blur is a close approximation of the
 * backend's PIL `GaussianBlur`, not pixel-identical.
 */
function BlurPropertyEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const imageSrc = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'image', s.edges, s.nodes),
  );
  const [applying, setApplying] = useState(false);
  const radius = (data.radius as number) ?? 2;

  const handleApply = async () => {
    if (applying) return;
    setApplying(true);
    try {
      const url = await bakeCanvasPreview({ image: imageSrc }, (ctx, canvas, images) =>
        drawBlur(ctx, canvas, images, radius),
      );
      if (!url) {
        alert(
          'Could not bake the blur preview. Connect an image to the Image input first, then try again.',
        );
        return;
      }
      updateNodeData(nodeId, { _blurPreview: url });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="prop-group">
      <label className="inspector-label">Radius</label>
      <input
        className="inspector-range"
        type="range"
        min={0}
        max={20}
        step={0.5}
        value={radius}
        onChange={(e) => updateNodeData(nodeId, { radius: parseFloat(e.target.value) })}
      />
      <span className="range-value">{radius}</span>
      <button
        type="button"
        className="inspector-btn"
        style={{ marginTop: 10, background: '#4f46e5', color: '#fff', borderColor: '#4f46e5' }}
        onClick={handleApply}
        disabled={applying || !imageSrc}
        title={!imageSrc ? 'Connect an image to the Image input first' : undefined}
      >
        {applying ? 'Applying…' : 'Apply'}
      </button>
    </div>
  );
}

function StackImagesPropertyEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const direction = data.direction === 'vertical' ? 'vertical' : 'horizontal';
  const stretch = Boolean(data.stretch);
  const imageCount = Math.max(
    1,
    Math.min(MAX_STACK_IMAGES, (data.imageCount as number) || 2),
  );

  const handleAddImage = () => {
    if (imageCount >= MAX_STACK_IMAGES) return;
    updateNodeData(nodeId, { imageCount: imageCount + 1 });
  };

  const handleRemoveImage = () => {
    if (imageCount <= 1) return;
    const handleToRemove = `image${imageCount}`;
    const edgesToRemove = edges
      .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
      .map((e) => e.id);
    if (edgesToRemove.length > 0) {
      removeEdgesByIds(edgesToRemove);
    }
    updateNodeData(nodeId, { imageCount: imageCount - 1 });
  };

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Joins multiple images next to each other. Image 1 decides the
        cross-axis size; other images are center-aligned — or stretched to
        match Image 1 exactly when <strong>Stretch</strong> is on.
      </div>

      <label className="inspector-label">Direction</label>
      <div className="combine-input-controls" style={{ marginBottom: 8 }}>
        <button
          type="button"
          className={`inspector-btn-small${direction === 'horizontal' ? '' : ' ghost'}`}
          onClick={() => updateNodeData(nodeId, { direction: 'horizontal' })}
          disabled={isRunning}
        >
          <Icon name="transfer-horizontal-line" size={12} />
          Horizontal
        </button>
        <button
          type="button"
          className={`inspector-btn-small${direction === 'vertical' ? '' : ' ghost'}`}
          onClick={() => updateNodeData(nodeId, { direction: 'vertical' })}
          disabled={isRunning}
        >
          <Icon name="transfer-vertical-line" size={12} />
          Vertical
        </button>
      </div>

      <label className="inspector-label">
        <input
          type="checkbox"
          checked={stretch}
          onChange={(e) => updateNodeData(nodeId, { stretch: e.target.checked })}
          disabled={isRunning}
        />
        Stretch all images to Image 1's size
      </label>

      <label className="inspector-label" style={{ marginTop: 8 }}>
        Image Inputs
      </label>
      <div className="combine-input-controls">
        <span className="combine-input-count">
          {imageCount} / {MAX_STACK_IMAGES} input{imageCount !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="inspector-btn-small"
          onClick={handleAddImage}
          disabled={isRunning || imageCount >= MAX_STACK_IMAGES}
        >
          + Add
        </button>
        <button
          type="button"
          className="inspector-btn-small danger"
          onClick={handleRemoveImage}
          disabled={isRunning || imageCount <= 1}
        >
          − Remove
        </button>
      </div>

      <div className="inspector-empty-small" style={{ marginTop: 8, lineHeight: 1.45 }}>
        Preview on the node updates live as you connect or change images. Run
        the workflow to bake the stacked output for downstream nodes.
      </div>
    </div>
  );
}

function PickRandomPropertyEditor({
  nodeId,
  data,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const valueType = (data.valueType as PickRandomValueType) || 'image';
  const inputCount = Math.max(2, Math.min(MAX_PICK_RANDOM_INPUTS, (data.inputCount as number) || 2));

  const result = data._result as Record<string, any> | undefined;
  const pickedIndex = typeof result?.pickedIndex === 'number' ? result.pickedIndex : null;
  const pickedFrom = typeof result?.pickedFrom === 'number' ? result.pickedFrom : null;
  const pickedValue = result?.out;

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Every run picks one connected input at random and sends it to the output.
        Switching the value type retypes every port and drops any edge that no
        longer matches.
      </div>

      <label className="inspector-label">Value Type</label>
      <select
        className="inspector-select"
        value={valueType}
        disabled={isRunning}
        onChange={(e) => setPickRandomValueType(nodeId, e.target.value as PickRandomValueType)}
      >
        {PICK_RANDOM_VALUE_TYPES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>

      <label className="inspector-label" style={{ marginTop: 10 }}>
        Inputs
      </label>
      <div className="combine-input-controls">
        <span className="combine-input-count">
          {inputCount} / {MAX_PICK_RANDOM_INPUTS} input{inputCount !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="inspector-btn-small"
          onClick={() => addPickRandomInput(nodeId)}
          disabled={isRunning || inputCount >= MAX_PICK_RANDOM_INPUTS}
        >
          + Add
        </button>
        <button
          type="button"
          className="inspector-btn-small danger"
          onClick={() => removePickRandomInput(nodeId)}
          disabled={isRunning || inputCount <= 2}
        >
          − Remove
        </button>
      </div>

      {pickedIndex != null ? (
        <div className="inspector-size-result" style={{ marginTop: 10 }}>
          <div className="size-result-total">
            Picked Input {pickedIndex} of {pickedFrom ?? inputCount}
          </div>
          {valueType === 'color' && typeof pickedValue === 'string' && (
            <div className="editor-field-row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
              <span className="color-swatch" style={{ background: pickedValue }} />
              <span style={{ fontFamily: 'monospace' }}>{pickedValue}</span>
            </div>
          )}
          {(valueType === 'value' || valueType === 'text') && pickedValue != null && (
            <div className="combine-preview" style={{ marginTop: 6 }}>
              {String(pickedValue)}
            </div>
          )}
        </div>
      ) : (
        <div className="inspector-empty-small" style={{ marginTop: 8 }}>
          Run the workflow to see which input was picked.
        </div>
      )}
    </div>
  );
}

function BooleanPropertyEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const valueType = (data.valueType as BooleanValueType) || 'text';
  const enabled = Boolean(data.enabled);

  const result = data._result as Record<string, any> | undefined;
  const pickedValue = result?.value;
  const selected = typeof result?.selected === 'string' ? result.selected : null;

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Switches its output between Input A and Input B based on the checkbox.
        Switching the value type retypes A, B, and the output, and drops any
        edge that no longer matches.
      </div>

      <label className="inspector-label">Value Type</label>
      <select
        className="inspector-select"
        value={valueType}
        disabled={isRunning}
        onChange={(e) => setBooleanValueType(nodeId, e.target.value as BooleanValueType)}
      >
        {BOOLEAN_VALUE_TYPES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>

      <label className="inspector-label" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={isRunning}
          onChange={(e) => updateNodeData(nodeId, { enabled: e.target.checked })}
        />
        {' '}Output Input {enabled ? 'B' : 'A'}
      </label>

      {pickedValue != null ? (
        <div className="inspector-size-result" style={{ marginTop: 10 }}>
          <div className="size-result-total">
            Selected Input {(selected ?? (enabled ? 'b' : 'a')).toUpperCase()}
          </div>
          {valueType === 'color' && typeof pickedValue === 'string' && (
            <div className="editor-field-row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
              <span className="color-swatch" style={{ background: pickedValue }} />
              <span style={{ fontFamily: 'monospace' }}>{pickedValue}</span>
            </div>
          )}
          {(valueType === 'value' || valueType === 'text') && (
            <div className="combine-preview" style={{ marginTop: 6 }}>
              {String(pickedValue)}
            </div>
          )}
        </div>
      ) : (
        <div className="inspector-empty-small" style={{ marginTop: 8 }}>
          Run the workflow to see which input was output.
        </div>
      )}
    </div>
  );
}

interface ExportImageItemSettings {
  fileName: string;
  format: string;
}

/** Build a per-input settings list of length `imageCount`, migrating the
 * legacy single `fileName` / `format` fields onto the first slot. */
function normalizeExportItems(data: Record<string, any>): ExportImageItemSettings[] {
  const count = Math.max(1, Math.min(MAX_EXPORT_IMAGES, (data.imageCount as number) || 1));
  const raw = Array.isArray(data.exportItems) ? data.exportItems : [];
  const legacyName =
    typeof data.fileName === 'string' && data.fileName.length > 0 ? data.fileName : '';
  const legacyFmt =
    typeof data.format === 'string' && data.format.length > 0 ? data.format : 'png';
  return Array.from({ length: count }, (_, i) => {
    const item = (raw[i] || {}) as Record<string, any>;
    const fileName =
      typeof item.fileName === 'string' && item.fileName.length > 0
        ? item.fileName
        : i === 0 && legacyName
          ? legacyName
          : `image${i + 1}`;
    const format =
      typeof item.format === 'string' && item.format.length > 0
        ? item.format
        : i === 0
          ? legacyFmt
          : 'png';
    return { fileName, format };
  });
}

/** Resolve the image feeding input slot `slot` (1-based). Falls back to the
 * legacy `image` handle for the first slot so old workflows still work. */
function getConnectedExportImage(
  nodeId: string,
  slot: number,
  edges: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
): string | null {
  const direct = getConnectedImageDataUrl(nodeId, `image${slot}`, edges, allNodes);
  if (direct) return direct;
  if (slot === 1) return getConnectedImageDataUrl(nodeId, 'image', edges, allNodes);
  return null;
}

function ExportImagePropertyEditor({
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
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const items = useMemo(() => normalizeExportItems(data), [data]);
  const imageCount = items.length;
  const exportPath = (data.exportPath as string) || '';

  const connected = useMemo(
    () => items.map((_, i) => getConnectedExportImage(nodeId, i + 1, edges, allNodes) != null),
    [items, nodeId, edges, allNodes],
  );
  const connectedCount = connected.filter(Boolean).length;

  const persistItems = (next: ExportImageItemSettings[], extra?: Record<string, any>) => {
    updateNodeData(nodeId, {
      exportItems: next,
      fileName: undefined,
      format: undefined,
      ...extra,
    });
  };

  const setItem = (index: number, patch: Partial<ExportImageItemSettings>) => {
    persistItems(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const handleAddImage = () => {
    if (imageCount >= MAX_EXPORT_IMAGES) return;
    persistItems([...items, { fileName: `image${imageCount + 1}`, format: 'png' }], {
      imageCount: imageCount + 1,
    });
  };

  const handleRemoveImage = () => {
    if (imageCount <= 1) return;
    const handleToRemove = `image${imageCount}`;
    const edgesToRemove = edges
      .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
      .map((e) => e.id);
    if (edgesToRemove.length > 0) removeEdgesByIds(edgesToRemove);
    persistItems(items.slice(0, imageCount - 1), { imageCount: imageCount - 1 });
  };

  const handleExport = async () => {
    setExportError(null);
    const payload: { image: string; fileName: string; format: string }[] = [];
    for (let i = 0; i < imageCount; i++) {
      const img = getConnectedExportImage(nodeId, i + 1, edges, allNodes);
      if (!img) continue;
      payload.push({ image: img, fileName: items[i].fileName, format: items[i].format });
    }
    if (payload.length === 0) {
      setExportError('Connect at least one image, then export.');
      return;
    }
    setExporting(true);
    try {
      const result = await exportImages(payload, exportPath);
      updateNodeData(nodeId, { _lastExportedPaths: result.saved });
      if (result.errors && result.errors.length > 0) {
        setExportError(result.errors.join('\n'));
      }
    } catch (err: any) {
      setExportError(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const lastPaths: string[] = Array.isArray(data._lastExportedPaths)
    ? (data._lastExportedPaths as string[])
    : [];

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Connect one or more images, name each file and pick its format, then
        click <strong>Export</strong>. Nothing is written until you press the
        button.
      </div>

      <label className="inspector-label">Export Folder (local)</label>
      <input
        className="inspector-input"
        value={exportPath}
        onChange={(e) => updateNodeData(nodeId, { exportPath: e.target.value })}
        placeholder="D:\output (blank = SpotOn exports folder)"
        disabled={isRunning}
      />

      <label className="inspector-label" style={{ marginTop: 10 }}>
        Image Inputs
      </label>
      <div className="combine-input-controls">
        <span className="combine-input-count">
          {imageCount} / {MAX_EXPORT_IMAGES} input{imageCount !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="inspector-btn-small"
          onClick={handleAddImage}
          disabled={isRunning || exporting || imageCount >= MAX_EXPORT_IMAGES}
        >
          + Add image
        </button>
        <button
          type="button"
          className="inspector-btn-small danger"
          onClick={handleRemoveImage}
          disabled={isRunning || exporting || imageCount <= 1}
        >
          − Remove
        </button>
      </div>

      {items.map((item, i) => (
        <div key={i} className="editor-layer-card" style={{ marginTop: 8 }}>
          <div className="editor-layer-card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Image {i + 1}</span>
            <span
              className="inspector-connected-badge"
              style={{ opacity: connected[i] ? 1 : 0.4 }}
            >
              {connected[i] ? 'connected' : 'no input'}
            </span>
          </div>
          <label className="inspector-label">File name</label>
          <input
            className="inspector-input"
            value={item.fileName}
            onChange={(e) => setItem(i, { fileName: e.target.value })}
            placeholder={`image${i + 1}`}
            disabled={isRunning || exporting}
          />
          <label className="inspector-label">Format</label>
          <select
            className="inspector-select"
            value={item.format}
            onChange={(e) => setItem(i, { format: e.target.value })}
            disabled={isRunning || exporting}
          >
            <option value="png">PNG</option>
            <option value="jpg">JPG</option>
            <option value="webp">WEBP</option>
          </select>
        </div>
      ))}

      <button
        type="button"
        className="inspector-btn"
        style={{ marginTop: 12 }}
        onClick={handleExport}
        disabled={isRunning || exporting || connectedCount === 0}
      >
        {exporting ? 'Exporting…' : `Export ${connectedCount} image${connectedCount !== 1 ? 's' : ''}`}
      </button>

      {exportError && (
        <div className="inspector-empty-small" style={{ marginTop: 8, color: '#f87171', whiteSpace: 'pre-wrap' }}>
          {exportError}
        </div>
      )}

      {lastPaths.length > 0 && (
        <div className="export-result-info" style={{ marginTop: 10 }}>
          <span className="export-result-check">Last export:</span>
          {lastPaths.map((p, i) => (
            <span key={i} className="export-result-path" title={p}>
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Export3dPropertyEditor({
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
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportPath = (data.exportPath as string) || '';
  const fileName = (data.fileName as string) || 'model';
  const connected = getConnectedModel3d(nodeId, 'model', edges, allNodes);

  const handleExport = async () => {
    setExportError(null);
    if (!connected?.assetId) {
      setExportError('Connect a 3D model, then export.');
      return;
    }
    setExporting(true);
    try {
      const result = await exportModels(
        [{ assetId: connected.assetId, fileName }],
        exportPath,
      );
      updateNodeData(nodeId, { _lastExportedPaths: result.saved });
      if (result.errors && result.errors.length > 0) {
        setExportError(result.errors.join('\n'));
      }
    } catch (err: any) {
      setExportError(err?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const lastPaths: string[] = Array.isArray(data._lastExportedPaths)
    ? (data._lastExportedPaths as string[])
    : [];

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Connect a 3D model, name the file, then click <strong>Export</strong>.
        Nothing is written until you press the button.
      </div>

      <label className="inspector-label">Export Folder (local)</label>
      <input
        className="inspector-input"
        value={exportPath}
        onChange={(e) => updateNodeData(nodeId, { exportPath: e.target.value })}
        placeholder="D:\output (blank = SpotOn exports folder)"
        disabled={isRunning}
      />

      <label className="inspector-label" style={{ marginTop: 10 }}>
        File name
      </label>
      <input
        className="inspector-input"
        value={fileName}
        onChange={(e) => updateNodeData(nodeId, { fileName: e.target.value })}
        placeholder="model"
        disabled={isRunning || exporting}
      />
      <div className="inspector-empty-small" style={{ marginTop: 4 }}>
        Saved as GLB
        {connected ? (
          <span className="inspector-connected-badge" style={{ marginLeft: 8 }}>
            connected
          </span>
        ) : (
          <span className="inspector-connected-badge" style={{ marginLeft: 8, opacity: 0.4 }}>
            no input
          </span>
        )}
      </div>

      <button
        type="button"
        className="inspector-btn"
        style={{ marginTop: 12 }}
        onClick={handleExport}
        disabled={isRunning || exporting || !connected}
      >
        {exporting ? 'Exporting…' : 'Export GLB'}
      </button>

      {exportError && (
        <div className="inspector-empty-small" style={{ marginTop: 8, color: '#f87171', whiteSpace: 'pre-wrap' }}>
          {exportError}
        </div>
      )}

      {lastPaths.length > 0 && (
        <div className="export-result-info" style={{ marginTop: 10 }}>
          <span className="export-result-check">Last export:</span>
          {lastPaths.map((p, i) => (
            <span key={i} className="export-result-path" title={p}>
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Import3dEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assetId = (data.modelAssetId as string) || '';
  const sourceName = (data.sourceName as string) || '';
  const sourceFormat = (data.sourceFormat as string) || '';
  const sizeBytes = typeof data.sizeBytes === 'number' ? data.sizeBytes : 0;

  const handleFile = async (file: File) => {
    setError(null);
    setImporting(true);
    try {
      const patch = await buildImport3dData(file);
      updateNodeData(nodeId, patch);
    } catch (err: any) {
      setError(err?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFile(file);
  };

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Import a GLB, OBJ, or FBX file. OBJ/FBX are converted to GLB right in
        the browser: OBJ keeps geometry only (no material), and FBX keeps
        textures only when they're embedded in the file.
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.obj,.fbx"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      <button
        type="button"
        className="inspector-btn"
        style={{ marginTop: 10 }}
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
      >
        {importing ? 'Converting…' : assetId ? 'Replace File' : 'Choose File'}
      </button>

      {error && (
        <div
          className="inspector-empty-small"
          style={{ marginTop: 8, color: '#f87171', whiteSpace: 'pre-wrap' }}
        >
          {error}
        </div>
      )}

      {assetId && !importing && (
        <div className="inspector-empty-small" style={{ marginTop: 10 }}>
          {sourceName || 'model'}
          {sourceFormat && ` (${sourceFormat.toUpperCase()})`}
          {sizeBytes > 0 && ` — ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB GLB`}
        </div>
      )}
    </div>
  );
}

const PREVIEW_3D_LIGHT_FIELDS: {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  suffix?: string;
}[] = [
  { key: 'keyLight', label: 'Key light', min: 0, max: 5, step: 0.1, fallback: 2 },
  { key: 'fillLight', label: 'Fill light', min: 0, max: 3, step: 0.05, fallback: 0.6 },
  { key: 'shadowStrength', label: 'Shadow', min: 0, max: 1, step: 0.05, fallback: 0.5 },
  { key: 'lightAzimuth', label: 'Light rotation', min: 0, max: 360, step: 1, fallback: 135, suffix: '°' },
  { key: 'lightElevation', label: 'Light height', min: 0, max: 90, step: 1, fallback: 45, suffix: '°' },
];

function Preview3dPropertyEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });
  const sizeBytes = (data._result as Record<string, any> | undefined)?.model?.sizeBytes;
  const displayMode = normalizePreview3dDisplayMode(data.displayMode);
  const activeDisplayMode = PREVIEW_3D_DISPLAY_MODES.find((m) => m.id === displayMode);

  return (
    <div className="prop-group">
      <div className="inspector-empty-small" style={{ opacity: 0.75, marginBottom: 8 }}>
        Drag to orbit, scroll to zoom. Click an axis dot in the corner to snap the view.
      </div>

      <label className="inspector-label">Display</label>
      <div className="tool-pill-row">
        {PREVIEW_3D_DISPLAY_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`tool-pill${displayMode === m.id ? ' on' : ''}`}
            title={m.hint}
            aria-pressed={displayMode === m.id}
            onClick={() => update('displayMode', m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {activeDisplayMode && (
        <div className="inspector-empty-small" style={{ marginTop: 6, marginBottom: 8 }}>
          {activeDisplayMode.hint}
        </div>
      )}

      <label className="inspector-label">
        <input
          type="checkbox"
          checked={data.transparentBg === false}
          onChange={(e) => update('transparentBg', !e.target.checked)}
        />
        Show background
      </label>

      <label className="inspector-label">
        <input
          type="checkbox"
          checked={data.showGrid !== false}
          onChange={(e) => update('showGrid', e.target.checked)}
        />
        Show grid
      </label>

      {PREVIEW_3D_LIGHT_FIELDS.map((field) => {
        const value = typeof data[field.key] === 'number' ? data[field.key] : field.fallback;
        return (
          <div key={field.key}>
            <label className="inspector-label">{field.label}</label>
            <input
              className="inspector-range"
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={value}
              onChange={(e) => update(field.key, parseFloat(e.target.value))}
            />
            <span className="range-value">
              {field.step >= 1 ? value : value.toFixed(2)}
              {field.suffix || ''}
            </span>
          </div>
        );
      })}

      {typeof sizeBytes === 'number' && sizeBytes > 0 && (
        <div className="inspector-empty-small" style={{ marginTop: 10 }}>
          Mesh: {(sizeBytes / (1024 * 1024)).toFixed(2)} MB
        </div>
      )}
    </div>
  );
}

function ImageTo3dEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const model = (data.model as string) || DEFAULT_IMAGE_TO_3D_MODEL;
  const spec =
    IMAGE_TO_3D_MODEL_SPECS[model] ?? IMAGE_TO_3D_MODEL_SPECS[DEFAULT_IMAGE_TO_3D_MODEL];
  const extraFields = spec.extraFields ?? [];
  const result = data._result as Record<string, any> | undefined;
  const sizeBytes = result?.model?.sizeBytes;

  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  const handleModelChange = (next: string) => {
    if (next === model) return;
    const nextSpec = IMAGE_TO_3D_MODEL_SPECS[next];
    const patch: Record<string, any> = { model: next };
    for (const field of nextSpec?.extraFields ?? []) {
      if (data[field.key] == null) patch[field.key] = field.default;
    }
    updateNodeData(nodeId, patch);
  };

  return (
    <div className="prop-group">
      <div
        className="inspector-empty-small"
        style={{ opacity: 0.75, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}
      >
        fal.ai
      </div>

      <label className="inspector-label">Model</label>
      <select
        className="inspector-select"
        value={model}
        onChange={(e) => handleModelChange(e.target.value)}
      >
        {IMAGE_TO_3D_MODEL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      {extraFields.map((field) => {
        const current = extraFields.some((f) => f.key === field.key && data[field.key] != null)
          ? String(data[field.key])
          : field.default;
        return (
          <div key={field.key}>
            <label className="inspector-label">{field.label}</label>
            <select
              className="inspector-select"
              value={current}
              onChange={(e) => update(field.key, e.target.value)}
            >
              {field.options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}

      {typeof sizeBytes === 'number' && sizeBytes > 0 && (
        <div className="inspector-empty-small" style={{ marginTop: 10 }}>
          Last mesh: {(sizeBytes / (1024 * 1024)).toFixed(2)} MB
        </div>
      )}
    </div>
  );
}

function UpscalerEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);

  const model = (data.model as string) || DEFAULT_UPSCALER_MODEL;
  const spec = UPSCALER_MODEL_SPECS[model] ?? UPSCALER_MODEL_SPECS[DEFAULT_UPSCALER_MODEL];
  const supportsPrompt = !!spec.supportsPrompt;
  const scale = UPSCALER_SCALE_OPTIONS.some((o) => o.id === data.scale)
    ? (data.scale as string)
    : DEFAULT_UPSCALER_SCALE;

  const promptEdge = useMemo(
    () => edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt'),
    [edges, nodeId],
  );
  const connectedPrompt = useWorkflowStore((s) => {
    const edge = s.edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt');
    if (!edge) return null;
    return resolveUpstreamTextOutput(edge.source, s.edges, s.nodes).trim();
  });
  const isPromptConnected = promptEdge != null;

  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  const handleModelChange = (next: string) => {
    if (next === model) return;
    const nextSupportsPrompt = !!UPSCALER_MODEL_SPECS[next]?.supportsPrompt;
    if (!nextSupportsPrompt) {
      const staleEdges = edges
        .filter((e) => e.target === nodeId && e.targetHandle === 'prompt')
        .map((e) => e.id);
      if (staleEdges.length > 0) removeEdgesByIds(staleEdges);
    }
    updateNodeData(nodeId, { model: next });
  };

  return (
    <div className="prop-group">
      <div
        className="inspector-empty-small"
        style={{ opacity: 0.75, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}
      >
        fal.ai
      </div>

      <label className="inspector-label">Model</label>
      <select
        className="inspector-select"
        value={model}
        onChange={(e) => handleModelChange(e.target.value)}
      >
        {UPSCALER_MODEL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      <label className="inspector-label">Scale</label>
      <select
        className="inspector-select"
        value={scale}
        onChange={(e) => update('scale', e.target.value)}
      >
        {UPSCALER_SCALE_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      {supportsPrompt ? (
        <>
          <label className="inspector-label">
            Prompt (optional)
            {isPromptConnected && <span className="inspector-connected-badge">connected</span>}
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
              value={(data.prompt as string) || ''}
              onChange={(e) => update('prompt', e.target.value)}
              rows={3}
              placeholder="Optional — guide the upscale, e.g. 'sharp, detailed skin texture'..."
            />
          )}
        </>
      ) : (
        <div className="inspector-empty-small" style={{ marginTop: 6, opacity: 0.75 }}>
          This model takes no prompt — it upscales the connected image as-is.
        </div>
      )}
    </div>
  );
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

function AdjustmentsInspectorSummary({
  data,
  onOpenAdjustments,
}: {
  data: Record<string, any>;
  onOpenAdjustments?: () => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const params = useMemo(() => normalizeAdjustments(data), [data.hue, data.saturation, data.value, data.levels]);
  const identity = isAdjustmentsIdentity(params);

  const hsvActive = params.hue !== 0 || params.saturation !== 0 || params.value !== 0;
  const levelsActive =
    params.levels.inBlack !== 0 ||
    params.levels.inWhite !== 255 ||
    params.levels.gamma !== 1 ||
    params.levels.outBlack !== 0 ||
    params.levels.outWhite !== 255;

  const summary = identity
    ? 'No adjustments — output matches input.'
    : [hsvActive ? 'Hue/Sat/Value' : null, levelsActive ? 'Levels' : null].filter(Boolean).join(' + ');

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Hue/Saturation/Value shift plus a Levels control (black/white/gamma points, output range) over a
        histogram of the connected image.
      </div>
      <button
        type="button"
        className="inspector-btn"
        disabled={isRunning || !onOpenAdjustments}
        onClick={() => onOpenAdjustments?.()}
      >
        Open Adjustments
      </button>
      <div className="inspector-empty-small" style={{ marginTop: 8 }}>
        {summary} — preview updates in the window; run workflow to bake output.
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

  const srcW = Math.max(0, Number(data._origWidth) || 0);
  const srcH = Math.max(0, Number(data._origHeight) || 0);
  const anchor = normalizeCropAnchor(data.anchor);
  const offset = readOffset(data);
  const rect = resolveCropRect(data, srcW, srcH);
  const anchored = anchor !== 'free';

  const update = (field: string, v: number) => updateNodeData(nodeId, { [field]: v });

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Connect an image, then pick an anchor to align the crop, nudge it with the offset, or drag it
        freely in the crop window.
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
        Anchor & Offset
      </label>
      <AnchorOffsetControls
        anchor={anchor}
        offsetX={offset.x}
        offsetY={offset.y}
        onAnchorChange={(next) => updateNodeData(nodeId, { anchor: next })}
        onOffsetChange={({ x, y }) => updateNodeData(nodeId, { offsetX: x, offsetY: y })}
        disabled={isRunning}
        onFreeSelect={() => updateNodeData(nodeId, { anchor: 'free' })}
        note={
          anchored
            ? `Anchored ${ANCHOR_LABELS[anchor].toLowerCase()} → ${rect.x}, ${rect.y}`
            : 'Position comes from the crop window'
        }
      />

      <label className="inspector-label" style={{ marginTop: 12 }}>
        Rectangle (px)
      </label>
      {(['x', 'y', 'width', 'height'] as const).map((field) => {
        const isSize = field === 'width' || field === 'height';
        const derived = anchored && !isSize;
        return (
          <div key={field}>
            <label className="inspector-label">{field.toUpperCase()}</label>
            <input
              className="inspector-input"
              type="number"
              min={isSize ? 1 : 0}
              value={derived ? (field === 'x' ? rect.x : rect.y) : (data[field] as number)}
              disabled={isRunning || derived}
              title={derived ? 'Derived from the anchor and offset' : undefined}
              onChange={(e) =>
                update(
                  field,
                  isSize
                    ? Math.max(1, parseInt(e.target.value, 10) || 1)
                    : parseInt(e.target.value, 10) || 0,
                )
              }
            />
          </div>
        );
      })}
      {srcW > 0 && srcH > 0 && (
        <div className="inspector-empty-small" style={{ marginTop: 6 }}>
          Source {srcW} × {srcH} px
        </div>
      )}
    </div>
  );
}

function DividerPropertyEditor({
  nodeId,
  data,
  onOpenDivider,
}: {
  nodeId: string;
  data: Record<string, any>;
  onOpenDivider?: () => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const edges = useWorkflowStore((s) => s.edges);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const selections = (Array.isArray(data.selections) ? data.selections : []) as DividerSelection[];

  const handleClearAll = useCallback(() => {
    if (selections.length === 0) return;
    const newEdges = remapDividerSourceEdges(nodeId, selections, [], edges);
    useWorkflowStore.setState({ edges: newEdges, _dirty: true });
    updateNodeData(nodeId, { selections: [], _dividerOutputs: {} });
  }, [edges, nodeId, selections, updateNodeData]);

  return (
    <div className="prop-group">
      <div className="editor-bg-notice">
        Connect an image, then open the editor to draw box or lasso regions. Each region becomes one
        output (max {MAX_DIVIDER_OUTPUTS}). Run the workflow to bake full-resolution crops.
      </div>
      <button
        type="button"
        className="inspector-btn"
        disabled={isRunning || !onOpenDivider}
        onClick={() => onOpenDivider?.()}
      >
        Open Divider
      </button>
      <div className="inspector-empty-small" style={{ marginTop: 10 }}>
        {selections.length} selection{selections.length !== 1 ? 's' : ''}
        {selections.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.5 }}>
            {selections.map((sel, i) => (
              <li key={sel.id || `div-${i}`}>{`Out ${i + 1} — ${sel.kind}`}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="inspector-btn"
        style={{ marginTop: 10 }}
        disabled={isRunning || selections.length === 0}
        onClick={handleClearAll}
      >
        Clear all
      </button>
    </div>
  );
}

function KeyColorPropertyEditor({
  nodeId,
  data,
  updateNodeData,
  onOpenKeyColor,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  onOpenKeyColor?: () => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const keyColor = (data.keyColor as string) || '#00ff00';
  const hasBaked = Boolean((data._keyColorBaked as string) || '');

  return (
    <div className="prop-group">
      <div className="inspector-empty-small" style={{ lineHeight: 1.45, marginBottom: 10 }}>
        Open the editor to pick a colour, tune threshold / softness, and
        brush manual fixes. Click <strong>Apply</strong> in the editor to
        bake the keyed image into this node's output.
      </div>

      <div className="editor-field-row" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 18,
            height: 18,
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.35)',
            background: keyColor,
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: 'monospace', opacity: 0.85 }}>{keyColor}</span>
      </div>

      <button
        type="button"
        className="inspector-btn"
        onClick={() => onOpenKeyColor?.()}
        disabled={isRunning || !onOpenKeyColor}
      >
        Open Editor…
      </button>

      {hasBaked ? (
        <button
          type="button"
          className="inspector-btn"
          style={{ marginTop: 6 }}
          onClick={() =>
            updateNodeData(nodeId, { _keyColorBaked: '', manualMaskData: '' })
          }
          disabled={isRunning}
        >
          Clear baked output
        </button>
      ) : null}

      <div
        className="inspector-empty-small"
        style={{ marginTop: 10, opacity: 0.75 }}
      >
        {hasBaked
          ? 'Output: baked from editor ✓'
          : 'Output: passes the input image through until you bake.'}
      </div>
    </div>
  );
}

/** BiRefNet v2 variants. Keep in sync with `REMOVE_BG_MODELS` in backend/nodes/tool_nodes.py. */
const REMOVE_BG_MODELS: { id: string; label: string }[] = [
  { id: 'General Use (Heavy)', label: 'General Use — Heavy (best quality)' },
  { id: 'General Use (Light)', label: 'General Use — Light (faster)' },
  { id: 'General Use (Light 2K)', label: 'General Use — Light 2K' },
  { id: 'Matting', label: 'Matting (soft edges, hair, fur)' },
  { id: 'Portrait', label: 'Portrait (people)' },
];

const REMOVE_BG_DEFAULT_MODEL = 'General Use (Heavy)';

function RemoveBgPropertyEditor({
  nodeId,
  data,
  updateNodeData,
  onOpenRemoveBg,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
  onOpenRemoveBg?: () => void;
}) {
  const isRunning = useWorkflowStore((s) => s.isRunning);

  // A workflow saved before the fal migration holds a rembg model id; the
  // backend maps it, and the dropdown falls back to the default until resaved.
  const rawModel = typeof data.model === 'string' ? data.model : '';
  const model = REMOVE_BG_MODELS.some((m) => m.id === rawModel)
    ? rawModel
    : REMOVE_BG_DEFAULT_MODEL;
  const operatingResolution =
    data.operatingResolution === '2048x2048' ? '2048x2048' : '1024x1024';
  const refineForeground = data.refineForeground !== false;
  const threshold = Math.max(0, Math.min(255, Number(data.threshold) || 0));
  const feather = Math.max(0, Math.min(20, Number(data.feather) || 0));
  const erode = Math.max(0, Math.min(20, Number(data.erode) || 0));
  const dilate = Math.max(0, Math.min(20, Number(data.dilate) || 0));
  const invert = Boolean(data.invert);
  const bgFillRaw = typeof data.bgFill === 'string' ? data.bgFill : 'transparent';
  const bgTransparent = bgFillRaw === 'transparent' || !bgFillRaw;
  const bgColor = bgTransparent ? '#ffffff' : bgFillRaw;
  const hasBaked = Boolean((data._removeBgBaked as string) || '');

  const update = (patch: Record<string, any>) => updateNodeData(nodeId, patch);

  return (
    <div className="prop-group">
      <div className="inspector-empty-small" style={{ lineHeight: 1.45, marginBottom: 10 }}>
        Removes the background with BiRefNet on fal.ai, then refines the edge with the mask
        sliders below. Needs internet and costs a little per run. Use the editor for a larger
        live preview while tuning.
      </div>

      <label className="inspector-label">Model</label>
      <select
        className="inspector-select"
        value={model}
        onChange={(e) => update({ model: e.target.value })}
        disabled={isRunning}
      >
        {REMOVE_BG_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>

      <label className="inspector-label">Detail Resolution</label>
      <select
        className="inspector-select"
        value={operatingResolution}
        onChange={(e) => update({ operatingResolution: e.target.value })}
        disabled={isRunning}
      >
        <option value="1024x1024">1024 — faster</option>
        <option value="2048x2048">2048 — finer edges, slower</option>
      </select>

      <label className="inspector-label" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={refineForeground}
          onChange={(e) => update({ refineForeground: e.target.checked })}
          disabled={isRunning}
        />
        Refine foreground (removes background color fringing)
      </label>

      <label className="inspector-label">Threshold</label>
      <input
        className="inspector-range"
        type="range"
        min={0}
        max={255}
        value={threshold}
        onChange={(e) => update({ threshold: Number(e.target.value) })}
        disabled={isRunning}
      />
      <span className="range-value">{threshold}</span>

      <label className="inspector-label">Feather</label>
      <input
        className="inspector-range"
        type="range"
        min={0}
        max={20}
        step={0.1}
        value={feather}
        onChange={(e) => update({ feather: Number(e.target.value) })}
        disabled={isRunning}
      />
      <span className="range-value">{feather.toFixed(1)} px</span>

      <label className="inspector-label">Erode</label>
      <input
        className="inspector-range"
        type="range"
        min={0}
        max={20}
        value={erode}
        onChange={(e) => update({ erode: Number(e.target.value) })}
        disabled={isRunning}
      />
      <span className="range-value">{erode}</span>

      <label className="inspector-label">Dilate</label>
      <input
        className="inspector-range"
        type="range"
        min={0}
        max={20}
        value={dilate}
        onChange={(e) => update({ dilate: Number(e.target.value) })}
        disabled={isRunning}
      />
      <span className="range-value">{dilate}</span>

      <label className="inspector-label">
        <input
          type="checkbox"
          checked={invert}
          onChange={(e) => update({ invert: e.target.checked })}
          disabled={isRunning}
        />
        Invert mask
      </label>

      <label className="inspector-label">Background Fill</label>
      <select
        className="inspector-select"
        value={bgTransparent ? 'transparent' : 'color'}
        onChange={(e) => {
          if (e.target.value === 'transparent') update({ bgFill: 'transparent' });
          else update({ bgFill: bgColor });
        }}
        disabled={isRunning}
      >
        <option value="transparent">Transparent</option>
        <option value="color">Solid color</option>
      </select>
      {!bgTransparent ? (
        <input
          className="inspector-color"
          type="color"
          value={bgColor}
          onChange={(e) => update({ bgFill: e.target.value })}
          disabled={isRunning}
        />
      ) : null}

      <button
        type="button"
        className="inspector-btn"
        style={{ marginTop: 10 }}
        onClick={() => onOpenRemoveBg?.()}
        disabled={isRunning || !onOpenRemoveBg}
      >
        Open Editor…
      </button>

      {hasBaked ? (
        <button
          type="button"
          className="inspector-btn"
          style={{ marginTop: 6 }}
          onClick={() => updateNodeData(nodeId, { _removeBgBaked: '' })}
          disabled={isRunning}
        >
          Clear baked output
        </button>
      ) : null}
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

function formatMathNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

function MathPropertyEditor({
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

  const mathState = useMemo(
    () => resolveMathState(nodeId, edges, allNodes),
    [nodeId, edges, allNodes],
  );
  const operation: MathOperationId = (data.operation as MathOperationId) || 'add';

  return (
    <div className="prop-group">
      <label className="inspector-label">
        Value A
        {mathState.a.linked && <span className="inspector-connected-badge">linked</span>}
      </label>
      {mathState.a.linked ? (
        <div className="inspector-connected-prompt">
          <div className="connected-prompt-text">{formatMathNumber(mathState.a.value)}</div>
        </div>
      ) : (
        <input
          className="inspector-input"
          type="number"
          value={data.a ?? 0}
          onChange={(e) => updateNodeData(nodeId, { a: parseFloat(e.target.value) || 0 })}
        />
      )}

      <label className="inspector-label">Operation</label>
      <select
        className="inspector-select"
        value={operation}
        onChange={(e) => updateNodeData(nodeId, { operation: e.target.value })}
      >
        {MATH_OPERATIONS.map((op) => (
          <option key={op.id} value={op.id}>
            {op.label}
          </option>
        ))}
      </select>

      <label className="inspector-label">
        Value B
        {mathState.b.linked && <span className="inspector-connected-badge">linked</span>}
      </label>
      {mathState.b.linked ? (
        <div className="inspector-connected-prompt">
          <div className="connected-prompt-text">{formatMathNumber(mathState.b.value)}</div>
        </div>
      ) : (
        <input
          className="inspector-input"
          type="number"
          value={data.b ?? 0}
          onChange={(e) => updateNodeData(nodeId, { b: parseFloat(e.target.value) || 0 })}
        />
      )}

      <label className="inspector-label">Result</label>
      {mathState.error ? (
        <div className="inspector-empty-small" style={{ color: 'var(--danger)' }}>
          {mathState.error}
        </div>
      ) : (
        <pre className="inspector-result">{formatMathNumber(mathState.result)}</pre>
      )}
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

function FalAiEditor({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  const edges = useWorkflowStore((s) => s.edges);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);

  const model = (data.model as string) || 'flux_dev';
  const spec = FAL_MODEL_SPECS[model] ?? FAL_MODEL_SPECS.flux_dev;
  const supportsRefImage = FAL_IMG2IMG_MODELS.has(model);
  const supportsMultiImage = FAL_MULTI_IMAGE_MODELS.has(model);
  const usesAspectRatio = FAL_ASPECT_RATIO_MODELS.has(model);
  const noSizeControl = FAL_NO_SIZE_MODELS.has(model);
  const supportsInferenceSteps =
    !usesAspectRatio && !noSizeControl && !FAL_NO_STEPS_MODELS.has(model);
  const supportsPrompt = !FAL_NO_PROMPT_MODELS.has(model);
  const requiresImage = FAL_REQUIRES_IMAGE_MODELS.has(model);
  const refImageCount = (data.refImageCount as number) || 1;
  const sizeOptions = spec.sizeOptions ?? FAL_IMAGE_SIZE_OPTIONS;
  const aspectOptions = spec.aspectOptions ?? FAL_ASPECT_RATIO_OPTIONS;

  const promptEdge = useMemo(
    () => edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt'),
    [edges, nodeId],
  );

  // Resolve the upstream prompt inside the selector so this re-renders only when
  // the resolved string changes — not on every nodes-array rebuild (box-select).
  const connectedPrompt = useWorkflowStore((s) => {
    const edge = s.edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt');
    if (!edge) return null;
    return resolveUpstreamTextOutput(edge.source, s.edges, s.nodes).trim();
  });

  const isPromptConnected = promptEdge != null;

  const update = (key: string, value: any) => updateNodeData(nodeId, { [key]: value });

  const handleModelChange = (next: string) => {
    if (next === model) return;
    const nextSupportsImage = FAL_IMG2IMG_MODELS.has(next);
    const nextSupportsMulti = FAL_MULTI_IMAGE_MODELS.has(next);
    const staleEdges = edges
      .filter((e) => {
        if (e.target !== nodeId || typeof e.targetHandle !== 'string') return false;
        if (e.targetHandle === 'prompt') return FAL_NO_PROMPT_MODELS.has(next);
        if (e.targetHandle.startsWith('referenceImage')) {
          if (!nextSupportsImage) return true;
          if (nextSupportsMulti) return false;
          // Single-image models only ever render Image 1 — drop Image 2+ so
          // edges don't dangle on a handle that no longer exists.
          const idx = parseInt(e.targetHandle.slice('referenceImage'.length), 10);
          return idx > 1;
        }
        return false;
      })
      .map((e) => e.id);
    if (staleEdges.length > 0) {
      removeEdgesByIds(staleEdges);
    }
    const patch: Record<string, any> = { model: next };
    if (!nextSupportsMulti && refImageCount > 1) {
      patch.refImageCount = 1;
    }
    updateNodeData(nodeId, patch);
  };

  const handleAddImage = () => update('refImageCount', refImageCount + 1);

  const handleRemoveImage = () => {
    if (refImageCount <= 1) return;
    const handleToRemove = `referenceImage${refImageCount}`;
    const edgesToRemove = edges
      .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
      .map((e) => e.id);
    if (edgesToRemove.length > 0) {
      removeEdgesByIds(edgesToRemove);
    }
    update('refImageCount', refImageCount - 1);
  };

  const imageSize = sizeOptions.some((o) => o.id === data.imageSize)
    ? (data.imageSize as string)
    : 'square_hd';
  const aspectRatio = aspectOptions.some((o) => o.id === data.aspectRatio)
    ? (data.aspectRatio as string)
    : '1:1';
  const steps = Number(data.numInferenceSteps) || 28;

  return (
    <div className="prop-group">
      <div
        className="inspector-empty-small"
        style={{ opacity: 0.75, marginBottom: 8, fontFamily: 'ui-monospace, monospace' }}
      >
        fal.ai
      </div>

      <label className="inspector-label">Model</label>
      <select
        className="inspector-select"
        value={model}
        onChange={(e) => handleModelChange(e.target.value)}
      >
        {FAL_MODEL_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      {supportsPrompt ? (
        <>
          <label className="inspector-label">
            Prompt
            {isPromptConnected && <span className="inspector-connected-badge">connected</span>}
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
              value={(data.prompt as string) || ''}
              onChange={(e) => update('prompt', e.target.value)}
              rows={3}
              placeholder="Describe the image you want to generate..."
            />
          )}
        </>
      ) : (
        <div className="inspector-empty-small" style={{ marginTop: 6, opacity: 0.75 }}>
          This model takes no prompt — it generates variations of the reference image
          you connect below.
        </div>
      )}

      {supportsRefImage ? (
        <>
          <label className="inspector-label">
            Reference Images{requiresImage ? ' (required)' : ''}
          </label>
          <div className="combine-input-controls">
            <span className="combine-input-count">
              {refImageCount} image input{refImageCount > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              className="inspector-btn-small"
              onClick={handleAddImage}
              disabled={!supportsMultiImage && refImageCount >= 1}
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
          <div className="inspector-empty-small" style={{ marginTop: 6, opacity: 0.75 }}>
            {supportsMultiImage
              ? 'All connected reference images are sent to fal as image_urls.'
              : 'Only the first reference image is sent to fal as image_url.'}
            {requiresImage
              ? ' This model cannot run without one.'
              : ' Connecting one switches this model to its image-to-image endpoint.'}
          </div>
        </>
      ) : (
        <div className="inspector-empty-small" style={{ marginTop: 6, opacity: 0.75 }}>
          This model is text-to-image only. Pick a different model above to enable
          an image input port on the node.
        </div>
      )}

      {!noSizeControl && !usesAspectRatio && (
        <>
          <label className="inspector-label">Image size</label>
          <select
            className="inspector-select"
            value={imageSize}
            onChange={(e) => update('imageSize', e.target.value)}
          >
            {sizeOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </>
      )}

      {usesAspectRatio && (
        <>
          <label className="inspector-label">Aspect Ratio</label>
          <select
            className="inspector-select"
            value={aspectRatio}
            onChange={(e) => update('aspectRatio', e.target.value)}
          >
            {aspectOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </>
      )}

      {(spec.extraFields ?? []).map((field) => {
        const raw = data[field.key] as string | undefined;
        const value = field.options.some((o) => o.id === raw) ? (raw as string) : field.default;
        return (
          <div key={field.key}>
            <label className="inspector-label">{field.label}</label>
            <select
              className="inspector-select"
              value={value}
              onChange={(e) => update(field.key, e.target.value)}
            >
              {field.options.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}

      {supportsInferenceSteps && (
        <>
          <label className="inspector-label">Inference steps (1–50)</label>
          <input
            className="inspector-input"
            type="number"
            min={1}
            max={50}
            value={steps}
            onChange={(e) =>
              update(
                'numInferenceSteps',
                Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 28)),
              )
            }
          />
        </>
      )}

      <label className="inspector-label">Seed (0 = random)</label>
      <input
        className="inspector-input"
        type="number"
        min={0}
        value={(data.seed as number) || 0}
        onChange={(e) => update('seed', parseInt(e.target.value, 10) || 0)}
      />
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
      <div className="inspector-empty-small" style={{ opacity: 0.75, marginBottom: 4, fontFamily: 'ui-monospace, monospace' }}>
        fal-ai/any-llm/vision
      </div>
      <div className="inspector-empty-small" style={{ lineHeight: 1.45, marginBottom: 10 }}>
        Needs internet and costs a little per run.
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
  const bgHidden = Boolean(data.bgHidden);

  const handleAddLayer = () => {
    const newCount = layerCount + 1;
    const updated = { ...layers };
    updated[`layer${newCount}`] = { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false, hidden: false };
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

      <div className="editor-layer-card" style={{ marginBottom: 10 }}>
        <div className="editor-layer-card-header">BG Layer</div>
        <label className="inspector-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={!bgHidden}
            disabled={isRunning}
            onChange={(e) => updateNodeData(nodeId, { bgHidden: !e.target.checked })}
          />
          Show in output
        </label>
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
