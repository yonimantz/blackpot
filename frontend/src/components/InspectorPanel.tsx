import { useWorkflowStore, isNodeEffectivelyBypassed } from '../store/workflowStore';
import {
  NODE_TYPE_DEFINITIONS,
  NODE_CATEGORIES,
  MAX_COMPOSITOR_LAYERS,
  MAX_VIGNETTE_LAYERS,
  MAX_STACK_IMAGES,
  MAX_EXPORT_IMAGES,
  MAX_DIVIDER_OUTPUTS,
  GPT_IMAGE_2_MAX_REFERENCE_IMAGES,
  FAL_IMG2IMG_MODELS,
  FAL_MULTI_IMAGE_MODELS,
  FAL_ASPECT_RATIO_MODELS,
  FAL_NO_SIZE_MODELS,
  isNodeTypePinnable,
  isTemplateOutputNodeType,
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
import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { getConnectedImageDataUrl, getNodeImageOutputDataUrl } from '../utils/upstreamImage';
import { exportImages } from '../utils/api';
import { buildImportImageData } from '../utils/importImageData';
import { remapDividerSourceEdges, type DividerSelection } from '../utils/dividerEdges';
import CompositorModal from './CompositorModal';
import CropModal from './CropModal';
import DividerModal from './DividerModal';
import EditorModal from './EditorModal';
import KeyColorModal from './KeyColorModal';
import RemoveBgModal from './RemoveBgModal';
import StudioFields from './StudioFields';
import VignetteModal from './VignetteModal';

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
  const focusedGroupId = useWorkflowStore((s) => s.focusedGroupId);
  const groups = useWorkflowStore((s) => s.groups);

  const [compositorModalOpen, setCompositorModalOpen] = useState(false);
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [vignetteModalOpen, setVignetteModalOpen] = useState(false);
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
      {dividerModalEl}
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
            Image 1 (overlay) is composited on top of Image 2 (base). The
            opacity slider fades Image 1. Image 1 is resized to match Image 2.
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

    case 'falAi':
      return (
        <FalAiEditor nodeId={nodeId} data={data} updateNodeData={updateNodeData} />
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
        {aspectLocked ? '🔒 Aspect Locked' : '🔓 Aspect Free'}
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
          ↔ Horizontal
        </button>
        <button
          type="button"
          className={`inspector-btn-small${direction === 'vertical' ? '' : ' ghost'}`}
          onClick={() => updateNodeData(nodeId, { direction: 'vertical' })}
          disabled={isRunning}
        >
          ↕ Vertical
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
        placeholder="D:\output (blank = backend exports folder)"
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

const REMOVE_BG_MODELS = [
  'u2net',
  'u2net_human_seg',
  'isnet-general-use',
  'birefnet-general',
  'birefnet-portrait',
] as const;

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

  const model = typeof data.model === 'string' && data.model ? data.model : 'isnet-general-use';
  const alphaMatting = Boolean(data.alphaMatting);
  const fgThreshold = Math.max(0, Math.min(255, Number(data.fgThreshold) || 240));
  const bgThreshold = Math.max(0, Math.min(255, Number(data.bgThreshold) || 10));
  const erodeSize = Math.max(0, Math.min(40, Number(data.erodeSize) || 10));
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
        Remove background with a local model, then refine edges with mask sliders.
        Use the editor for a larger live preview while tuning.
      </div>

      <label className="inspector-label">Model</label>
      <select
        className="inspector-select"
        value={model}
        onChange={(e) => update({ model: e.target.value })}
        disabled={isRunning}
      >
        {REMOVE_BG_MODELS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <label className="inspector-label" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={alphaMatting}
          onChange={(e) => update({ alphaMatting: e.target.checked })}
          disabled={isRunning}
        />
        Alpha matting (cleaner hair/fur, slower)
      </label>

      {alphaMatting ? (
        <>
          <label className="inspector-label">Foreground Threshold</label>
          <input
            className="inspector-range"
            type="range"
            min={0}
            max={255}
            value={fgThreshold}
            onChange={(e) => update({ fgThreshold: Number(e.target.value) })}
            disabled={isRunning}
          />
          <span className="range-value">{fgThreshold}</span>

          <label className="inspector-label">Background Threshold</label>
          <input
            className="inspector-range"
            type="range"
            min={0}
            max={255}
            value={bgThreshold}
            onChange={(e) => update({ bgThreshold: Number(e.target.value) })}
            disabled={isRunning}
          />
          <span className="range-value">{bgThreshold}</span>

          <label className="inspector-label">Alpha Erode Size</label>
          <input
            className="inspector-range"
            type="range"
            min={0}
            max={40}
            value={erodeSize}
            onChange={(e) => update({ erodeSize: Number(e.target.value) })}
            disabled={isRunning}
          />
          <span className="range-value">{erodeSize}</span>
        </>
      ) : null}

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

const FAL_MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: 'flux_dev', label: 'FLUX.1 [dev]' },
  { id: 'flux_schnell', label: 'FLUX.1 [schnell] (fast)' },
  { id: 'flux_pro_v11', label: 'FLUX1.1 [pro]' },
  { id: 'flux_redux_dev', label: 'FLUX.1 [dev] Redux (image-to-image)' },
  { id: 'sd35_large', label: 'Stable Diffusion 3.5 Large' },
  { id: 'fast_sdxl', label: 'Fast SDXL' },
  { id: 'nano_banana', label: 'Nano Banana (Gemini 2.5 Flash Image)' },
  { id: 'nano_banana_edit', label: 'Nano Banana Edit (image-to-image)' },
  { id: 'nano_banana_pro', label: 'Nano Banana Pro (Gemini 3 Pro Image)' },
];

const FAL_IMAGE_SIZE_OPTIONS: { id: string; label: string }[] = [
  { id: 'square_hd', label: 'Square HD (1024×1024)' },
  { id: 'square', label: 'Square (512×512)' },
  { id: 'portrait_4_3', label: 'Portrait 4:3' },
  { id: 'portrait_16_9', label: 'Portrait 16:9' },
  { id: 'landscape_4_3', label: 'Landscape 4:3' },
  { id: 'landscape_16_9', label: 'Landscape 16:9' },
];

const FAL_ASPECT_RATIO_OPTIONS: { id: string; label: string }[] = [
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '21:9', label: '21:9' },
];

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
  const supportsRefImage = FAL_IMG2IMG_MODELS.has(model);
  const supportsMultiImage = FAL_MULTI_IMAGE_MODELS.has(model);
  const usesAspectRatio = FAL_ASPECT_RATIO_MODELS.has(model);
  const noSizeControl = FAL_NO_SIZE_MODELS.has(model);
  const supportsInferenceSteps = !usesAspectRatio && !noSizeControl;
  const refImageCount = (data.refImageCount as number) || 1;

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
    if (!FAL_IMG2IMG_MODELS.has(next)) {
      const refEdges = edges
        .filter(
          (e) =>
            e.target === nodeId &&
            typeof e.targetHandle === 'string' &&
            e.targetHandle.startsWith('referenceImage'),
        )
        .map((e) => e.id);
      if (refEdges.length > 0) {
        removeEdgesByIds(refEdges);
      }
    }
    update('model', next);
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

  const imageSize = FAL_IMAGE_SIZE_OPTIONS.some((o) => o.id === data.imageSize)
    ? (data.imageSize as string)
    : 'square_hd';
  const aspectRatio = FAL_ASPECT_RATIO_OPTIONS.some((o) => o.id === data.aspectRatio)
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

      {supportsRefImage ? (
        <>
          <label className="inspector-label">Reference Images</label>
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
          </div>
        </>
      ) : (
        <div className="inspector-empty-small" style={{ marginTop: 6, opacity: 0.75 }}>
          This model is text-to-image only. Switch to <strong>Nano Banana Edit</strong>,
          <strong> Nano Banana Pro</strong>, <strong>FLUX Redux</strong>, or
          <strong> Fast SDXL</strong> to enable an image input port on the node.
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
            {FAL_IMAGE_SIZE_OPTIONS.map((opt) => (
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
            {FAL_ASPECT_RATIO_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </>
      )}

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
