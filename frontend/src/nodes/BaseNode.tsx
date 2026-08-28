import { Handle, Position, NodeResizer, NodeResizeControl, ResizeControlVariant } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { memo, lazy, Suspense, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  NODE_TYPE_DEFINITIONS,
  NODE_CATEGORIES,
  PORT_TYPE_COLORS,
  MAX_PICK_RANDOM_INPUTS,
  PICK_RANDOM_VALUE_TYPES,
  BOOLEAN_VALUE_TYPES,
  getNodeInputs,
  getNodeOutputs,
  isTextResizableNodeType,
  isNodeTypePinnable,
  isResizablePreviewNodeType,
  isTemplateOutputNodeType,
  normalizePreview3dDisplayMode,
  type PickRandomValueType,
  type BooleanValueType,
} from '../types/nodeTypes';
import {
  setPickRandomValueType,
  addPickRandomInput,
  removePickRandomInput,
} from '../utils/pickRandom';
import { setBooleanValueType } from '../utils/booleanNode';
import { getLegacyNodeInfo } from '../types/legacyNodes';
import Icon from '../icons/Icon';
import {
  REFMAPPER_MAX_ENTRIES,
  buildRefMapperOutputString,
  newRefMapperEntryId,
  normalizeRefMapperEntries,
  resolveUpstreamTextOutput,
} from '../constants/refMapperAttributes';
import StudioFields from '../components/StudioFields';
import StackImagesCanvasPreview from '../components/StackImagesCanvasPreview';
import { AnchorOffsetControls } from '../components/AnchorControls';
import {
  RESIZE_MODE_HINTS,
  RESIZE_MODE_LABELS,
  normalizeAnchor,
  normalizeCropAnchor,
  normalizeResizeMode,
  readOffset,
  resizeModeUsesAnchor,
  resolveResizePlacement,
  type AnchorPosition,
  type ResizeMode,
} from '../utils/anchorPlacement';
import { useCropAnchorSync, useSourceImageSizeSync } from '../utils/cropRect';
import {
  MATH_OPERATIONS,
  resolveMathState,
  type MathNodeState,
  type MathOperationId,
} from '../utils/mathNode';
import { useWorkflowStore, findGroupIdForNode } from '../store/workflowStore';
import {
  getNodeImageOutputDataUrl,
  getConnectedImageDataUrl,
  getConnectedModel3d,
  getNodeModel3dOutput,
} from '../utils/upstreamImage';
import { getModelFileUrl } from '../utils/api';
import { useEditorPreviewBake } from '../utils/editorBake';
import { encodeCanvasPreview } from '../utils/previewEncoding';
import {
  useToolPreviewBake,
  useInvalidateBakeOnChange,
  drawCrop,
  drawRotate,
  drawSetMask,
  drawSimpleCombine,
  drawCompositor,
} from '../utils/toolPreviewBake';
import { registerModel3dCapture, unregisterModel3dCapture } from '../utils/model3dCapture';
import type { Model3dViewerHandle, Model3dViewerSettings } from '../components/Model3dViewer';
import { useImageObjectUrl } from '../utils/imageObjectUrl';
import { buildImportImageData } from '../utils/importImageData';
import { isIdentity as isAdjustmentsIdentity, normalizeAdjustments } from '../utils/adjustmentsMath';

/** Keeps three.js out of the main bundle until a Preview 3D node is rendered. */
const LazyModel3dViewer = lazy(() => import('../components/Model3dViewer'));

function BaseNode({ id, type, data, selected }: NodeProps) {
  const def = NODE_TYPE_DEFINITIONS[type!];
  if (!def) return <div>Unknown node: {type}</div>;

  const category = NODE_CATEGORIES[def.category];
  const bypassed = Boolean(data.bypassed);
  const hoveredRunGroupId = useWorkflowStore((s) => s.hoveredRunGroupId);
  const groups = useWorkflowStore((s) => s.groups);
  const isRunPreviewTarget =
    hoveredRunGroupId != null && findGroupIdForNode(groups, id) === hoveredRunGroupId;
  const nodeInputs = getNodeInputs(type!, data);
  const nodeOutputs = getNodeOutputs(type!, data);
  const isPreview = isResizablePreviewNodeType(type);
  const isTextResizable = isTextResizableNodeType(type!);
  const pinnable = isNodeTypePinnable(type);
  const pinned = pinnable && Boolean(data.pinned);
  const togglePin = useWorkflowStore((s) => s.togglePin);

  const isRunning = useWorkflowStore((s) => s.isRunning);
  const activeNodeId = useWorkflowStore((s) => s.activeNodeId);
  const completedNodeIds = useWorkflowStore((s) => s.completedNodeIds);
  const runResults = useWorkflowStore((s) => s.runResults);
  const isExecuting = isRunning && activeNodeId === id;
  const isCompleted = isRunning && completedNodeIds.includes(id);
  // Error/skipped are run state, not node state: they only show while the run
  // that produced them is on screen, so a failed run leaves nothing behind.
  const nodeResult = isRunning ? runResults[id] : undefined;
  const hasError = nodeResult && nodeResult.error && !nodeResult.skipped;
  const wasSkipped = nodeResult && nodeResult.skipped;

  const isNote = type === 'note';

  const classNames = [
    'workflow-node',
    selected ? 'selected' : '',
    bypassed && !isNote ? 'bypassed' : '',
    isPreview ? 'preview-resizable' : '',
    isTextResizable ? 'text-node-resizable' : '',
    isNote ? 'note-node' : '',
    isExecuting && !isNote ? 'node-executing' : '',
    isCompleted && !hasError && !wasSkipped && !isNote ? 'node-completed' : '',
    hasError && !isNote ? 'node-error' : '',
    wasSkipped && !isNote ? 'node-skipped' : '',
    pinned ? 'node-pinned' : '',
    isRunPreviewTarget && !isNote ? 'node-run-preview' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classNames}
      style={{ '--node-color': category?.color || '#666' } as React.CSSProperties}
    >
      {isPreview && (
        <NodeResizer
          minWidth={150}
          minHeight={100}
          isVisible={selected}
          lineClassName="node-resize-line"
          handleClassName="node-resize-handle"
          onResizeStart={() => useWorkflowStore.getState().beginResizeUndoSession()}
          onResizeEnd={() => useWorkflowStore.getState().endResizeUndoSession()}
        />
      )}
      {isTextResizable && selected && (
        <>
          <NodeResizeControl
            position="top"
            variant={ResizeControlVariant.Line}
            resizeDirection="vertical"
            minWidth={10}
            minHeight={160}
            className="text-node-resize-edge"
            onResizeStart={() => useWorkflowStore.getState().beginResizeUndoSession()}
            onResizeEnd={() => useWorkflowStore.getState().endResizeUndoSession()}
          />
          <NodeResizeControl
            position="bottom"
            variant={ResizeControlVariant.Line}
            resizeDirection="vertical"
            minWidth={10}
            minHeight={160}
            className="text-node-resize-edge"
            onResizeStart={() => useWorkflowStore.getState().beginResizeUndoSession()}
            onResizeEnd={() => useWorkflowStore.getState().endResizeUndoSession()}
          />
        </>
      )}
      <div className="node-header" style={{ background: hasError ? '#ef4444' : wasSkipped ? '#6b7280' : category?.color || '#666' }}>
        <span className="node-title">{data.label as string || def.label}</span>
        {bypassed && <span className="bypass-badge">BYPASSED</span>}
        {hasError && <span className="bypass-badge" style={{ background: '#991b1b' }}>ERROR</span>}
        {wasSkipped && !hasError && <span className="bypass-badge" style={{ background: '#4b5563' }}>SKIPPED</span>}
        {(type === 'removeBg' || type === 'imageScfPrompt' || type === 'imageTo3d' || type === 'upscaler') && (
          <span className="node-cost-badge" title="Costs money per run (fal.ai)">$</span>
        )}
        {isExecuting && <span className="node-executing-spinner" />}
        {pinnable && (
          <button
            type="button"
            className={`node-pin-btn nopan nodrag${pinned ? ' pinned' : ''}`}
            aria-pressed={pinned}
            title={
              pinned
                ? 'Pinned to template — click to unpin'
                : isTemplateOutputNodeType(type)
                  ? 'Pin to template — show this result in the Playground'
                  : 'Pin to template — ask the user for this value in the Playground'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              togglePin(id);
            }}
          >
            <Icon name={pinned ? 'pin-fill' : 'pin-line'} size={12} />
          </button>
        )}
      </div>
      <div className="node-ports">
        <div className="node-inputs">
          {nodeInputs.map((port) => (
            <div key={port.id} className="node-port input-port">
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                style={{ background: PORT_TYPE_COLORS[port.type] }}
                className="port-handle"
              />
              <span className="port-label">{port.label}</span>
            </div>
          ))}
        </div>
        <div className="node-outputs">
          {nodeOutputs.map((port) => {
            const resultVal =
              type === 'getImageSize' && data._result
                ? (data._result as Record<string, any>)[port.id]
                : undefined;

            return (
              <div key={port.id} className="node-port output-port">
                <span className="port-label">
                  {port.label}
                  {resultVal != null && (
                    <span className="port-result-value">{resultVal}px</span>
                  )}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={port.id}
                  style={{ background: PORT_TYPE_COLORS[port.type] }}
                  className="port-handle"
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="node-body">
        {type === 'combinePrompts' ? (
          <CombinePromptsContent nodeId={id} data={data} />
        ) : type === 'refMapper' ? (
          <RefMapperContent nodeId={id} data={data} />
        ) : type === 'sketch2Final' ? (
          <Sketch2FinalInlineEditor nodeId={id} data={data} />
        ) : type === 'studio' ? (
          <StudioFields nodeId={id} data={data} />
        ) : def.legacy ? (
          <LegacyNodeContent type={type!} />
        ) : type === 'imageScfPrompt' ? (
          <div className="node-ai-info inspector-empty-small" style={{ opacity: 0.75, padding: '4px 0' }}>
            Style / Content / Feel toggles in inspector
          </div>
        ) : type === 'editor' ? (
          <EditorNodeContent nodeId={id} data={data} />
        ) : type === 'compositor' ? (
          <CompositorNodeContent nodeId={id} data={data} />
        ) : type === 'vignette' ? (
          <VignetteNodeContent nodeId={id} data={data} />
        ) : type === 'adjustments' ? (
          <AdjustmentsNodeContent data={data} />
        ) : type === 'crop' ? (
          <CropNodeContent nodeId={id} data={data} />
        ) : type === 'rotate' ? (
          <RotateNodeContent nodeId={id} data={data} />
        ) : type === 'setMask' ? (
          <SetMaskNodeContent nodeId={id} data={data} />
        ) : type === 'simpleCombine' ? (
          <SimpleCombineNodeContent nodeId={id} data={data} />
        ) : type === 'blur' ? (
          <BlurNodeContent nodeId={id} data={data} />
        ) : type === 'divider' ? (
          <DividerNodeContent nodeId={id} data={data} />
        ) : type === 'keyColor' ? (
          <KeyColorNodeContent data={data} />
        ) : type === 'stackImages' ? (
          <StackImagesNodeContent nodeId={id} data={data} />
        ) : type === 'resize' ? (
          <ResizeNodeContent nodeId={id} data={data} />
        ) : type === 'math' ? (
          <MathNodeContent nodeId={id} data={data} />
        ) : type === 'pickRandom' ? (
          <PickRandomNodeContent nodeId={id} data={data} />
        ) : type === 'boolean' ? (
          <BooleanNodeContent nodeId={id} data={data} />
        ) : type === 'note' ? (
          <NoteInlineEditor nodeId={id} data={data} />
        ) : (
          renderNodeContent(type!, data, id)
        )}
      </div>
    </div>
  );
}

function LegacyNodeContent({ type }: { type: string }) {
  const info = getLegacyNodeInfo(type);
  if (!info) return null;
  return (
    <div className="node-legacy-content">
      <div className="node-legacy-badge">Removed</div>
      <div className="node-legacy-text">
        Replace with <strong>FAL AI</strong> set to “{info.replacementModel}”.
      </div>
    </div>
  );
}

function RefMapperContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const entries = useMemo(() => normalizeRefMapperEntries(data), [data]);

  const outputText = useMemo(() => buildRefMapperOutputString(data), [data]);

  const addEntry = () => {
    if (entries.length >= REFMAPPER_MAX_ENTRIES) return;
    const next = [
      ...entries,
      { id: newRefMapperEntryId(), imageIndex: 1, attributes: [] as string[] },
    ];
    updateNodeData(nodeId, {
      refMapperEntries: next,
      refAttributes: undefined,
      refImageCount: undefined,
      fallbackPrompt: undefined,
    });
  };

  return (
    <div className="node-refmapper-content">
      {outputText ? (
        <>
          <div className="combine-preview refmapper-preview nopan nodrag nowheel">{outputText}</div>
          <div className="combine-char-count">{outputText.length} chars</div>
        </>
      ) : (
        <div className="combine-preview empty">
          Add reference blocks in the inspector (or below) — pick image 1–14 and toggle tags
        </div>
      )}
      <div className="refmapper-slot-row">
        <span className="refmapper-slot-label">
          {entries.length} block{entries.length !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="ai-node-add-ref-btn nopan nodrag"
          title="Add a reference image block"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            addEntry();
          }}
          disabled={entries.length >= REFMAPPER_MAX_ENTRIES}
        >
          <Icon name="add-line" size={12} className="ai-node-add-ref-icon" />
          <span>Add Image</span>
        </button>
      </div>
    </div>
  );
}

function Sketch2FinalInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const edges = useWorkflowStore((s) => s.edges);
  const value = (data.value as string) || '';

  const promptLinked = useMemo(
    () => edges.some((e) => e.target === nodeId && e.targetHandle === 'prompt'),
    [edges, nodeId],
  );

  return (
    <div className="node-inline-editor">
      {promptLinked && (
        <div className="nano-prompt-preview" style={{ marginBottom: 4 }}>
          <span className="nano-prompt-connected-badge">prompt linked</span>
        </div>
      )}
      <textarea
        className="node-inline-textarea nopan nodrag nowheel"
        value={value}
        onChange={(e) => updateNodeData(nodeId, { value: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Describe the content in the sketch"
        rows={3}
      />
    </div>
  );
}

function CombinePromptsContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const inputCount = (data.inputCount as number) || 2;
  const separator = (data.separator as string) || '\n';

  // Resolve the combined text inside the selector so this re-renders only when
  // the resulting string changes — not on every selection-array rebuild.
  const combinedText = useWorkflowStore((s) => {
    const connectedEdges = s.edges.filter((e) => e.target === nodeId);
    const texts: string[] = [];
    for (let i = 1; i <= inputCount; i++) {
      const edge = connectedEdges.find((e) => e.targetHandle === `text${i}`);
      if (edge) {
        const piece = resolveUpstreamTextOutput(edge.source, s.edges, s.nodes).trim();
        if (piece) texts.push(piece);
      }
    }
    return texts.join(separator);
  });

  return (
    <div className="node-combine-content">
      {combinedText ? (
        <>
          <div className="combine-preview nopan nodrag nowheel">{combinedText}</div>
          <div className="combine-char-count">{combinedText.length} chars</div>
        </>
      ) : (
        <div className="combine-preview empty">Connect prompts to see combined text</div>
      )}
      <div className="node-ai-info">
        <button
          type="button"
          className="ai-node-add-ref-btn nopan nodrag"
          title="Add another text input"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            updateNodeData(nodeId, { inputCount: inputCount + 1 });
          }}
        >
          <Icon name="add-line" size={12} className="ai-node-add-ref-icon" />
          <span>Add Input</span>
        </button>
      </div>
    </div>
  );
}

function EditorNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const layerCount = (data.layerCount as number) || 0;

  useEditorPreviewBake(nodeId, data);

  const editorPreviewUrl = useImageObjectUrl(data._editorPreview as string | undefined);

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <Icon name="layers-line" size={12} className="editor-layer-icon" />
        <span>{layerCount} layer{layerCount !== 1 ? 's' : ''} + BG</span>
      </div>
      {editorPreviewUrl && (
        <img
          src={editorPreviewUrl}
          alt="Editor preview"
          className={
            data.bgHidden
              ? 'node-preview-img node-preview-img-checker'
              : 'node-preview-img'
          }
        />
      )}
      <div className="node-ai-info">
        <button
          type="button"
          className="ai-node-add-ref-btn nopan nodrag"
          title="Add a layer"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const newCount = layerCount + 1;
            const layers = { ...(data.layers as Record<string, any> || {}) };
            layers[`layer${newCount}`] = {
              x: 0,
              y: 0,
              width: 0,
              height: 0,
              rotation: 0,
              flipH: false,
              opacity: 1,
              hidden: false,
            };
            updateNodeData(nodeId, { layerCount: newCount, layers });
          }}
        >
          <Icon name="add-line" size={12} className="ai-node-add-ref-icon" />
          <span>Add Layer</span>
        </button>
      </div>
    </div>
  );
}

function CropNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const openCropEditorModal = useWorkflowStore((s) => s.openCropEditorModal);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const upstreamSrc = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'image', s.edges, s.nodes),
  );

  const { width: srcW, height: srcH } = useSourceImageSizeSync(nodeId, upstreamSrc, data);
  const rect = useCropAnchorSync(nodeId, data, srcW, srcH);
  const anchor = normalizeCropAnchor(data.anchor);
  const offset = readOffset(data);

  // Live preview: mirrors backend `_apply_crop` by drawing the source at a
  // negative offset and letting the canvas clip to the rect — see drawCrop.
  useToolPreviewBake({
    nodeId,
    field: '_cropPreview',
    sources: { image: upstreamSrc },
    signature: `${rect.x}|${rect.y}|${rect.w}|${rect.h}`,
    maxEdge: 2048,
    draw: (ctx, canvas, images) => drawCrop(ctx, canvas, images, rect),
  });
  const previewUrl = useImageObjectUrl(data._cropPreview as string | undefined);

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <span>
          {rect.x}, {rect.y} · {rect.w}×{rect.h}
        </span>
      </div>
      <AnchorOffsetControls
        anchor={anchor}
        offsetX={offset.x}
        offsetY={offset.y}
        onAnchorChange={(next) => updateNodeData(nodeId, { anchor: next })}
        onOffsetChange={({ x, y }) => updateNodeData(nodeId, { offsetX: x, offsetY: y })}
        disabled={isRunning}
        compact
        inNode
        onFreeSelect={() => updateNodeData(nodeId, { anchor: 'free' })}
        note={anchor === 'free' ? 'dragged position' : undefined}
      />
      {previewUrl && (
        <img src={previewUrl} alt="Crop preview" className="node-preview-img" />
      )}
      <div className="node-ai-info">
        <button
          type="button"
          className="ai-node-add-ref-btn nopan nodrag"
          title="Open crop editor"
          disabled={isRunning}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openCropEditorModal(nodeId);
          }}
        >
          <span>Open Crop</span>
        </button>
      </div>
    </div>
  );
}

/** Live preview: mirrors backend `rotate` in `execute_tool_node` (see drawRotate). */
function RotateNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const upstreamSrc = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'image', s.edges, s.nodes),
  );
  const angle = Number(data.angle) || 0;
  const flipH = Boolean(data.flipH);
  const flipV = Boolean(data.flipV);

  useToolPreviewBake({
    nodeId,
    field: '_rotatePreview',
    sources: { image: upstreamSrc },
    signature: `${angle}|${flipH}|${flipV}`,
    maxEdge: 2048,
    draw: (ctx, canvas, images) => drawRotate(ctx, canvas, images, angle, flipH, flipV),
  });
  const previewUrl = useImageObjectUrl(data._rotatePreview as string | undefined);

  return (
    <div className="node-editor-content">
      {previewUrl ? (
        <img src={previewUrl} alt="Rotate preview" className="node-preview-img" />
      ) : (
        <div className="node-preview-placeholder">Connect an image</div>
      )}
    </div>
  );
}

/** Live preview: mirrors backend `_execute_set_mask` (see drawSetMask). Output
 * is usually partly transparent, so the thumbnail sits on a checker backing. */
function SetMaskNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const imageSrc = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'image', s.edges, s.nodes),
  );
  const maskSrc = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'mask', s.edges, s.nodes),
  );
  const invert = Boolean(data.invert);

  useToolPreviewBake({
    nodeId,
    field: '_maskPreview',
    sources: { image: imageSrc, mask: maskSrc },
    signature: String(invert),
    draw: (ctx, canvas, images) => drawSetMask(ctx, canvas, images, invert),
  });
  const previewUrl = useImageObjectUrl(data._maskPreview as string | undefined);

  return (
    <div className="node-editor-content">
      {previewUrl ? (
        <img src={previewUrl} alt="Set Mask preview" className="node-preview-img-checker" />
      ) : (
        <div className="node-preview-placeholder">Connect Image + Mask</div>
      )}
    </div>
  );
}

/** Live preview: mirrors backend `_execute_simple_combine` (see drawSimpleCombine). */
function SimpleCombineNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const image1Src = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'image1', s.edges, s.nodes),
  );
  const image2Src = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'image2', s.edges, s.nodes),
  );
  const opacity = typeof data.opacity === 'number' ? (data.opacity as number) : 1;

  useToolPreviewBake({
    nodeId,
    field: '_combinePreview',
    sources: { image1: image1Src, image2: image2Src },
    signature: String(opacity),
    draw: (ctx, canvas, images) => drawSimpleCombine(ctx, canvas, images, opacity),
  });
  const previewUrl = useImageObjectUrl(data._combinePreview as string | undefined);

  return (
    <div className="node-editor-content">
      {previewUrl ? (
        <img src={previewUrl} alt="Simple Combine preview" className="node-preview-img" />
      ) : (
        <div className="node-preview-placeholder">Connect Top and/or Bottom</div>
      )}
    </div>
  );
}

/**
 * Blur has no modal — the Apply button lives in the Inspector (see
 * `BlurPropertyEditor`). This just shows whatever `_blurPreview` currently
 * holds and clears it the moment `radius` changes, so a stale bake never
 * outlives the setting it was made from.
 */
function BlurNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const radius = Number(data.radius) || 0;
  const hasBake = Boolean(data._blurPreview);
  useInvalidateBakeOnChange(nodeId, '_blurPreview', String(radius), hasBake);
  const previewUrl = useImageObjectUrl(data._blurPreview as string | undefined);

  return (
    <div className="node-editor-content">
      {previewUrl ? (
        <img src={previewUrl} alt="Blur preview" className="node-preview-img" />
      ) : (
        <div className="node-preview-placeholder">Apply in inspector to preview</div>
      )}
    </div>
  );
}

function DividerNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const openDividerEditorModal = useWorkflowStore((s) => s.openDividerEditorModal);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const selections = Array.isArray(data.selections) ? data.selections : [];
  const count = selections.length;

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <span>{count} selection{count !== 1 ? 's' : ''}</span>
      </div>
      <div className="node-ai-info">
        <button
          type="button"
          className="ai-node-add-ref-btn nopan nodrag"
          title="Open divider editor"
          disabled={isRunning}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openDividerEditorModal(nodeId);
          }}
        >
          <span>Open Divider</span>
        </button>
      </div>
    </div>
  );
}

/** Live preview: reuses the modal's own `drawCompositorLayers` renderer at
 * scale 1 with handles off, so the node thumbnail and the modal never drift. */
function CompositorNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const w = Math.max(1, Number(data.width) || 512);
  const h = Math.max(1, Number(data.height) || 512);
  const layerList = Array.isArray(data.layers) ? data.layers : [];
  const n = layerList.length;
  const backgroundSrc = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'background', s.edges, s.nodes),
  );

  useToolPreviewBake({
    nodeId,
    field: '_compositorPreview',
    sources: { background: backgroundSrc },
    signature: `${w}|${h}|${JSON.stringify(layerList)}`,
    draw: (ctx, canvas, images) => drawCompositor(ctx, canvas, images, w, h, layerList),
  });
  const previewUrl = useImageObjectUrl(data._compositorPreview as string | undefined);

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <Icon name="layout-line" size={12} className="editor-layer-icon" />
        <span>
          {n} shape{n !== 1 ? 's' : ''} · {w}×{h}
        </span>
      </div>
      {previewUrl && (
        <img src={previewUrl} alt="Compositor preview" className="node-preview-img" />
      )}
    </div>
  );
}

/**
 * Vignette has no continuous live bake — it's Apply-gated (see
 * `VignetteModal`'s Apply button). This clears `_vignettePreview` the moment
 * `vignetteLayers` changes, so a stale bake falls back to the last run's
 * image instead of showing an outdated result.
 */
function VignetteNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const layerList = Array.isArray(data.vignetteLayers) ? data.vignetteLayers : [];
  const n = layerList.length;
  const hasBake = Boolean(data._vignettePreview);
  useInvalidateBakeOnChange(nodeId, '_vignettePreview', JSON.stringify(layerList), hasBake);
  const previewUrl = useImageObjectUrl(data._vignettePreview as string | undefined);

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <Icon name="sun-line" size={12} className="editor-layer-icon" />
        <span>
          {n} vignette layer{n !== 1 ? 's' : ''}
        </span>
      </div>
      {previewUrl && (
        <img src={previewUrl} alt="Vignette preview" className="node-preview-img" />
      )}
    </div>
  );
}

function AdjustmentsNodeContent({ data }: { data: Record<string, any> }) {
  const previewUrl = useImageObjectUrl(data._adjustmentsPreview as string | undefined);
  const params = useMemo(
    () => normalizeAdjustments(data),
    [data.hue, data.saturation, data.value, data.levels],
  );

  const hsvActive = params.hue !== 0 || params.saturation !== 0 || params.value !== 0;
  const levelsActive = !isAdjustmentsIdentity({ ...params, hue: 0, saturation: 0, value: 0 });
  const summary = !hsvActive && !levelsActive
    ? 'No adjustments'
    : [hsvActive ? 'Hue/Sat/Value' : null, levelsActive ? 'Levels' : null].filter(Boolean).join(' + ');

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <Icon name="color-filter-line" size={12} className="editor-layer-icon" />
        <span>{summary}</span>
      </div>
      {previewUrl && (
        <img src={previewUrl} alt="Adjustments preview" className="node-preview-img" />
      )}
    </div>
  );
}

function StackImagesNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const direction = data.direction === 'vertical' ? 'vertical' : 'horizontal';
  const stretch = Boolean(data.stretch);
  const imageCount = (data.imageCount as number) || 2;

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary" style={{ gap: 6 }}>
        <button
          type="button"
          className={`stack-dir-pill nopan nodrag${direction === 'horizontal' ? ' on' : ''}`}
          title="Stack horizontally"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            updateNodeData(nodeId, { direction: 'horizontal' });
          }}
        >
          <Icon name="transfer-horizontal-line" size={11} /> H
        </button>
        <button
          type="button"
          className={`stack-dir-pill nopan nodrag${direction === 'vertical' ? ' on' : ''}`}
          title="Stack vertically"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            updateNodeData(nodeId, { direction: 'vertical' });
          }}
        >
          <Icon name="transfer-vertical-line" size={11} /> V
        </button>
        <label
          className="stack-stretch-toggle nopan nodrag"
          title="Stretch every image to match Image 1's size"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={stretch}
            onChange={(e) => updateNodeData(nodeId, { stretch: e.target.checked })}
          />
          <span>Stretch</span>
        </label>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{imageCount} inputs</span>
      </div>
      <StackImagesCanvasPreview nodeId={nodeId} data={data} />
      <div className="node-ai-info">
        <button
          type="button"
          className="ai-node-add-ref-btn nopan nodrag"
          title="Add another image input"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            updateNodeData(nodeId, { imageCount: imageCount + 1 });
          }}
        >
          <span className="ai-node-add-ref-icon" aria-hidden>+</span>
          <span>Add Image</span>
        </button>
      </div>
    </div>
  );
}

function PickRandomNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const valueType = (data.valueType as PickRandomValueType) || 'image';
  const inputCount = Math.max(2, Math.min(MAX_PICK_RANDOM_INPUTS, (data.inputCount as number) || 2));

  const result = data._result as Record<string, any> | undefined;
  const pickedIndex = typeof result?.pickedIndex === 'number' ? result.pickedIndex : null;
  const pickedFrom = typeof result?.pickedFrom === 'number' ? result.pickedFrom : null;
  const pickedValue = result?.out;

  const pickedImageUrl = useImageObjectUrl(
    valueType === 'image' && typeof pickedValue === 'string' ? pickedValue : undefined,
  );

  return (
    <div className="node-editor-content">
      <select
        className="inspector-select nopan nodrag"
        value={valueType}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => setPickRandomValueType(nodeId, e.target.value as PickRandomValueType)}
      >
        {PICK_RANDOM_VALUE_TYPES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>

      {pickedIndex != null ? (
        <div
          className="editor-layer-summary"
          style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
        >
          <span>
            Picked Input {pickedIndex} of {pickedFrom ?? inputCount}
          </span>
          {valueType === 'image' && pickedImageUrl && (
            <img src={pickedImageUrl} alt="Picked" className="node-preview-img" />
          )}
          {valueType === 'color' && typeof pickedValue === 'string' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="color-swatch" style={{ background: pickedValue }} />
              {pickedValue}
            </span>
          )}
          {(valueType === 'value' || valueType === 'text') && pickedValue != null && (
            <span className="combine-preview" style={{ width: '100%' }}>
              {String(pickedValue)}
            </span>
          )}
        </div>
      ) : (
        <div className="combine-preview empty">Run to pick a random input</div>
      )}

      <div className="node-ai-info combine-input-controls">
        <span className="combine-input-count">
          {inputCount} / {MAX_PICK_RANDOM_INPUTS} input{inputCount !== 1 ? 's' : ''}
        </span>
        <button
          type="button"
          className="ai-node-add-ref-btn nopan nodrag"
          title="Add another input"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            addPickRandomInput(nodeId);
          }}
          disabled={inputCount >= MAX_PICK_RANDOM_INPUTS}
        >
          <Icon name="add-line" size={12} className="ai-node-add-ref-icon" />
          <span>Add</span>
        </button>
        <button
          type="button"
          className="ai-node-add-ref-btn nopan nodrag"
          title="Remove last input"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removePickRandomInput(nodeId);
          }}
          disabled={inputCount <= 2}
        >
          <Icon name="minus-circle-line" size={12} className="ai-node-add-ref-icon" />
          <span>Remove</span>
        </button>
      </div>
    </div>
  );
}

/** Best ratio we currently know about for the locked aspect. Falls back to
 * the original image's ratio, then to whatever W/H are present, then 1:1.
 * Storing it explicitly on the node (`_lockedRatio`) is what keeps the lock
 * stable across keystrokes — deriving from `width/height` after each round
 * trip causes the ratio to drift due to integer rounding (e.g. 1920×1080
 * → type "8" → 8×5 → ratio becomes 1.6, not 16:9). */
function resolveLockedRatio(data: Record<string, any>): number {
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
 * In-canvas controls for the Resize node:
 *  - Reads natural width/height from the upstream image and stashes it on the
 *    node so we can show the original size and seed the new W/H fields.
 *  - W/H number inputs with an aspect-lock toggle that keeps a stable ratio
 *    captured at connect-time (or when the user re-locks).
 *  - Live preview canvas that draws the upstream image at the requested
 *    width/height (capped to a small backbuffer so very large targets stay
 *    cheap to render).
 */
function ResizeNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  // Compute inside the selector so the resize node only re-renders when the
  // upstream image string changes, not on every selection-array rebuild.
  const upstreamSrc = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'image', s.edges, s.nodes),
  );

  const aspectLocked = data.aspectLocked !== false;
  const width = Math.max(0, Number(data.width) || 0);
  const height = Math.max(0, Number(data.height) || 0);
  const origW = Math.max(0, Number(data._origWidth) || 0);
  const origH = Math.max(0, Number(data._origHeight) || 0);
  const lockedRatio = resolveLockedRatio(data);
  const mode = normalizeResizeMode(data.resizeMode);
  const anchor = normalizeAnchor(data.anchor);
  const offset = readOffset(data);
  const usesAnchor = resizeModeUsesAnchor(mode);

  // Sync natural dims of the upstream image into node data. When the source
  // image changes (different natural dims), seed width/height + lockedRatio
  // to the new original so the user sees a 1:1 preview as the starting point.
  useEffect(() => {
    if (!upstreamSrc) {
      if (origW || origH) {
        updateNodeData(nodeId, { _origWidth: 0, _origHeight: 0 });
      }
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || 1;
      const h = img.naturalHeight || 1;
      if (w === origW && h === origH) return;
      updateNodeData(nodeId, {
        _origWidth: w,
        _origHeight: h,
        _lockedRatio: w / h,
        width: w,
        height: h,
      });
    };
    img.onerror = () => {
      /* keep prior values on load errors */
    };
    img.src = upstreamSrc;
    return () => {
      cancelled = true;
    };
    // We intentionally only re-sync on src changes; including origW/origH
    // would loop because we write to them inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamSrc, nodeId]);

  const handleWidthChange = useCallback(
    (newW: number) => {
      const w = Math.max(1, Math.round(newW));
      if (aspectLocked && lockedRatio > 0) {
        const h = Math.max(1, Math.round(w / lockedRatio));
        updateNodeData(nodeId, { width: w, height: h });
      } else {
        updateNodeData(nodeId, { width: w });
      }
    },
    [aspectLocked, lockedRatio, nodeId, updateNodeData],
  );

  const handleHeightChange = useCallback(
    (newH: number) => {
      const h = Math.max(1, Math.round(newH));
      if (aspectLocked && lockedRatio > 0) {
        const w = Math.max(1, Math.round(h * lockedRatio));
        updateNodeData(nodeId, { width: w, height: h });
      } else {
        updateNodeData(nodeId, { height: h });
      }
    },
    [aspectLocked, lockedRatio, nodeId, updateNodeData],
  );

  // Toggling lock OFF→ON snapshots the current W/H ratio so the user can
  // pick a custom aspect by unlocking, editing freely, then re-locking.
  const handleToggleLock = useCallback(() => {
    if (!aspectLocked && width > 0 && height > 0) {
      updateNodeData(nodeId, { aspectLocked: true, _lockedRatio: width / height });
    } else {
      updateNodeData(nodeId, { aspectLocked: !aspectLocked });
    }
  }, [aspectLocked, width, height, nodeId, updateNodeData]);

  return (
    <div className="node-resize-content">
      <div className="resize-orig-row">
        <span className="resize-orig-label">Original</span>
        <span className="resize-orig-value">
          {origW && origH ? `${origW} × ${origH}` : '—'}
        </span>
      </div>
      <div className="resize-fields-row">
        <label className="resize-field">
          <span className="resize-field-label">W</span>
          <input
            className="resize-field-input nopan nodrag nowheel"
            type="number"
            min={1}
            value={width || ''}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => handleWidthChange(parseInt(e.target.value, 10) || 0)}
          />
        </label>
        <button
          type="button"
          className={`resize-lock-btn nopan nodrag${aspectLocked ? ' on' : ''}`}
          title={aspectLocked ? 'Aspect ratio locked' : 'Aspect ratio free'}
          aria-pressed={aspectLocked}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleLock();
          }}
        >
          <Icon name={aspectLocked ? 'lock-fill' : 'unlock-line'} size={12} />
        </button>
        <label className="resize-field">
          <span className="resize-field-label">H</span>
          <input
            className="resize-field-input nopan nodrag nowheel"
            type="number"
            min={1}
            value={height || ''}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => handleHeightChange(parseInt(e.target.value, 10) || 0)}
          />
        </label>
      </div>
      <div className="tool-pill-row">
        {RESIZE_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={`tool-pill nopan nodrag${mode === m ? ' on' : ''}`}
            title={RESIZE_MODE_HINTS[m]}
            aria-pressed={mode === m}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              updateNodeData(nodeId, { resizeMode: m });
            }}
          >
            {RESIZE_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {usesAnchor && (
        <AnchorOffsetControls
          anchor={anchor}
          offsetX={offset.x}
          offsetY={offset.y}
          onAnchorChange={(next) => updateNodeData(nodeId, { anchor: next })}
          onOffsetChange={({ x, y }) => updateNodeData(nodeId, { offsetX: x, offsetY: y })}
          compact
          inNode
        />
      )}
      <ResizePreviewCanvas
        nodeId={nodeId}
        src={upstreamSrc}
        width={width}
        height={height}
        mode={mode}
        anchor={anchor}
        offsetX={offset.x}
        offsetY={offset.y}
        bakedPreview={(data._resizePreview as string) || ''}
      />
    </div>
  );
}

const RESIZE_MODES: readonly ResizeMode[] = ['stretch', 'fit', 'canvas'];

const RESIZE_PREVIEW_BACKBUFFER_MAX = 512;

/**
 * Renders the upstream image at the requested W×H into a small preview
 * canvas (capped to keep typing responsive) and bakes the result into
 * `data._resizePreview`. Baking is what lets downstream live-preview
 * chains (like the standalone Preview node) show the resized image
 * immediately, without waiting for a workflow run — same pattern used
 * by Stack Images / Editor / Compositor / Vignette / Key Color.
 */
function ResizePreviewCanvas({
  nodeId,
  src,
  width,
  height,
  mode,
  anchor,
  offsetX,
  offsetY,
  bakedPreview,
}: {
  nodeId: string;
  src: string | null;
  width: number;
  height: number;
  mode: ResizeMode;
  anchor: AnchorPosition;
  offsetX: number;
  offsetY: number;
  bakedPreview: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastSrcRef = useRef<string | null>(null);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const lastBakedRef = useRef<string>(bakedPreview);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const clearBake = () => {
      if (lastBakedRef.current) {
        lastBakedRef.current = '';
        updateNodeData(nodeId, { _resizePreview: '' });
      }
    };

    const drawPlaceholder = (msg: string) => {
      canvas.width = 200;
      canvas.height = 110;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1e1e21';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#71717a';
      ctx.font = '11px Fredoka, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(msg, canvas.width / 2, canvas.height / 2 + 4);
    };

    const drawImg = (img: HTMLImageElement) => {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      const longest = Math.max(w, h);
      const scale = longest > RESIZE_PREVIEW_BACKBUFFER_MAX
        ? RESIZE_PREVIEW_BACKBUFFER_MAX / longest
        : 1;
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      canvas.width = cw;
      canvas.height = ch;
      ctx.clearRect(0, 0, cw, ch);

      // Anchored modes place the source inside the target frame; whatever the
      // frame doesn't cover stays transparent, matching the backend.
      const place = resolveResizePlacement(
        mode,
        img.naturalWidth,
        img.naturalHeight,
        w,
        h,
        anchor,
        offsetX,
        offsetY,
      );
      ctx.drawImage(
        img,
        place.x * scale,
        place.y * scale,
        Math.max(1, place.w * scale),
        Math.max(1, place.h * scale),
      );

      try {
        const dataUrl = encodeCanvasPreview(canvas);
        if (dataUrl && dataUrl !== lastBakedRef.current) {
          lastBakedRef.current = dataUrl;
          updateNodeData(nodeId, { _resizePreview: dataUrl });
        }
      } catch {
        /* canvas may be tainted on some sources — skip the bake */
      }
    };

    if (!src) {
      imgRef.current = null;
      lastSrcRef.current = null;
      drawPlaceholder('Connect image');
      clearBake();
      return;
    }
    if (width <= 0 || height <= 0) {
      drawPlaceholder('Set width & height');
      clearBake();
      return;
    }

    if (lastSrcRef.current === src && imgRef.current && imgRef.current.complete) {
      drawImg(imgRef.current);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      lastSrcRef.current = src;
      drawImg(img);
    };
    img.onerror = () => {
      if (cancelled) return;
      imgRef.current = null;
      lastSrcRef.current = null;
      drawPlaceholder('Image failed to load');
      clearBake();
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
    // bakedPreview is read via lastBakedRef and updateNodeData only — re-running
    // when the prop bounces back through props is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, width, height, mode, anchor, offsetX, offsetY, nodeId, updateNodeData]);

  return (
    <canvas
      ref={canvasRef}
      className="node-preview-img resize-node-canvas"
    />
  );
}

function KeyColorNodeContent({ data }: { data: Record<string, any> }) {
  const keyColor = (data.keyColor as string) || '#00ff00';
  const baked = getNodeImageOutputDataUrl(data);
  const bakedUrl = useImageObjectUrl(baked);

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary" style={{ gap: 8 }}>
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            borderRadius: 3,
            border: '1px solid rgba(255,255,255,0.35)',
            background: keyColor,
            flexShrink: 0,
          }}
        />
        <span>{baked ? 'Baked output' : 'Open editor to bake'}</span>
      </div>
      {bakedUrl && (
        <img src={bakedUrl} alt="Key Color baked output" className="node-preview-img" />
      )}
    </div>
  );
}

/**
 * Preview node body. Prefers the live upstream image (so the Preview
 * updates instantly when an upstream tool node — Resize, Stack, etc. —
 * changes its preview) and falls back to the cached `previewData` from
 * the last workflow run when the upstream is disconnected.
 */
function PreviewNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  // Compute the upstream src inside the selector so this only re-renders when
  // the resolved data URL string actually changes — not on every box-select
  // frame (which rebuilds the nodes array reference each tick).
  const liveSrc = useWorkflowStore((s) =>
    getConnectedImageDataUrl(nodeId, 'image', s.edges, s.nodes),
  );
  const src = liveSrc || (data.previewData as string) || '';
  const url = useImageObjectUrl(src);
  return url ? (
    <img src={url} alt="Preview" className="node-preview-img" />
  ) : (
    <div className="node-preview-placeholder">No preview</div>
  );
}

function PromptInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const value = (data.value as string) || '';

  return (
    <div className="node-inline-editor">
      <textarea
        className="node-inline-textarea nopan nodrag nowheel"
        value={value}
        onChange={(e) => updateNodeData(nodeId, { value: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Type your prompt..."
        rows={3}
      />
    </div>
  );
}

function NoteInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const value = (data.value as string) || '';

  return (
    <div className="node-inline-editor note-inline-editor">
      <textarea
        className="node-inline-textarea note-inline-textarea nopan nodrag nowheel"
        value={value}
        onChange={(e) => updateNodeData(nodeId, { value: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Write a note..."
        rows={4}
      />
    </div>
  );
}

function ImportImageInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      updateNodeData(nodeId, await buildImportImageData(file, file.name));
    },
    [nodeId, updateNodeData]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      updateNodeData(nodeId, await buildImportImageData(file, file.name));
    },
    [nodeId, updateNodeData]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Resolve through getNodeImageOutputDataUrl so an externalized image
  // (`fileAssetId` → served URL) shows just like an inline `fileData` one.
  const resolvedSrc = getNodeImageOutputDataUrl(data);
  const fileUrl = useImageObjectUrl(resolvedSrc);

  return (
    <div className="node-inline-editor">
      {resolvedSrc ? (
        <div className="node-inline-import-loaded">
          <img src={fileUrl} alt="Import" className="node-preview-img" />
          <button
            className="node-inline-change-btn nopan nodrag"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            Change
          </button>
        </div>
      ) : (
        <div
          className="node-inline-dropzone nopan nodrag"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
        >
          <div className="dropzone-icon">
            <Icon name="upload-2-line" size={20} />
          </div>
          <div className="dropzone-text">Drop image or click</div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
    </div>
  );
}

/**
 * Image to 3D body. Deliberately a flat thumbnail rather than an interactive
 * viewer — orbiting lives in the dedicated Preview 3D node, so an AI node never
 * pays for a WebGL context.
 */
function Model3dResultThumb({ data }: { data: Record<string, any> }) {
  const model = getNodeModel3dOutput(data);
  const thumbnail = typeof data._result?.thumbnail === 'string' ? data._result.thumbnail : '';

  if (thumbnail) {
    return <img src={thumbnail} alt="3D preview" className="node-preview-img" />;
  }
  if (model?.assetId) {
    return <div className="node-preview-placeholder">Mesh ready</div>;
  }
  return <div className="node-preview-placeholder">No 3D model</div>;
}

/**
 * Preview 3D body. Prefers the live upstream mesh (so it fills in without a
 * re-run when Import / Image to 3D already has a model) and falls back to the
 * `modelAssetId` cached on the last run — that id survives save/reload, which
 * `_result` does not.
 */
function Preview3dNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  // Select the asset id rather than the descriptor: `getConnectedModel3d` builds
  // a fresh object each call, which would fail the store's identity check and
  // re-render this node on every unrelated store update.
  const liveAssetId = useWorkflowStore(
    (s) => getConnectedModel3d(nodeId, 'model', s.edges, s.nodes)?.assetId || '',
  );
  const savedAssetId = typeof data.modelAssetId === 'string' ? data.modelAssetId : '';
  const assetId = liveAssetId || savedAssetId;

  const settings = useMemo(
    () => ({
      showGrid: data.showGrid !== false,
      transparentBg: data.transparentBg !== false,
      keyLight: typeof data.keyLight === 'number' ? data.keyLight : 2,
      fillLight: typeof data.fillLight === 'number' ? data.fillLight : 0.6,
      shadowStrength: typeof data.shadowStrength === 'number' ? data.shadowStrength : 0.5,
      lightAzimuth: typeof data.lightAzimuth === 'number' ? data.lightAzimuth : 135,
      lightElevation: typeof data.lightElevation === 'number' ? data.lightElevation : 45,
      displayMode: normalizePreview3dDisplayMode(data.displayMode),
    }),
    [
      data.showGrid,
      data.transparentBg,
      data.keyLight,
      data.fillLight,
      data.shadowStrength,
      data.lightAzimuth,
      data.lightElevation,
      data.displayMode,
    ],
  );

  // Registered regardless of whether a model is currently connected: the
  // capture function itself just reports "nothing to show" via the ref being
  // null, and this keeps the Image output's live source in one place instead
  // of re-registering on every connect/disconnect.
  const viewerRef = useRef<Model3dViewerHandle | null>(null);
  useEffect(() => {
    const capture = () => viewerRef.current?.captureImage() ?? null;
    registerModel3dCapture(nodeId, capture);
    return () => unregisterModel3dCapture(nodeId, capture);
  }, [nodeId]);

  if (!assetId) {
    return <div className="node-preview-placeholder">Connect a 3D model</div>;
  }

  return (
    <Suspense fallback={<div className="node-preview-placeholder">Loading 3D…</div>}>
      <LazyModel3dViewer ref={viewerRef} src={getModelFileUrl(assetId)} settings={settings} />
    </Suspense>
  );
}

/**
 * Frozen viewer preset for Import 3D: orbit and zoom only (the viewer already
 * disables pan). No lighting/grid/shadow toggles here — those live on Preview
 * 3D, which sits downstream for anyone who wants to actually dial in a look.
 */
const IMPORT_3D_VIEWER_SETTINGS: Model3dViewerSettings = {
  displayMode: 'textured',
  showGrid: false,
  transparentBg: true,
  keyLight: 1,
  fillLight: 1,
  shadowStrength: 0,
  lightAzimuth: 45,
  lightElevation: 45,
};

/**
 * Import 3D body. The mesh is stored directly on this node's data (there is no
 * upstream to resolve, unlike Preview 3D), so it renders as soon as an import
 * finishes — no re-run needed.
 */
function Import3dNodeContent({ data }: { data: Record<string, any> }) {
  const assetId = typeof data.modelAssetId === 'string' ? data.modelAssetId : '';

  if (!assetId) {
    return <div className="node-preview-placeholder">Import a 3D file</div>;
  }

  return (
    <Suspense fallback={<div className="node-preview-placeholder">Loading 3D…</div>}>
      <LazyModel3dViewer src={getModelFileUrl(assetId)} settings={IMPORT_3D_VIEWER_SETTINGS} />
    </Suspense>
  );
}

function Export3dInlineEditor({ data }: { data: Record<string, any> }) {
  const exportPath = (data.exportPath as string) || '';
  const exportedCount = Array.isArray(data._lastExportedPaths)
    ? (data._lastExportedPaths as string[]).length
    : 0;

  return (
    <div className="node-inline-editor">
      <div className="node-inline-export-meta">
        <span className="node-inline-meta-text">
          {exportPath || 'SpotOn exports folder'}
        </span>
        {exportedCount > 0 && <span className="node-inline-exported-badge">Exported</span>}
      </div>
    </div>
  );
}

function ExportImageInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const exportPath = (data.exportPath as string) || '';
  const imageCount = Math.max(1, (data.imageCount as number) || 1);
  const exportedCount = Array.isArray(data._lastExportedPaths)
    ? (data._lastExportedPaths as string[]).length
    : 0;

  return (
    <div className="node-inline-editor">
      <input
        className="node-inline-input nopan nodrag"
        value={exportPath}
        onChange={(e) => updateNodeData(nodeId, { exportPath: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Export folder..."
        title={exportPath || 'Set export folder'}
      />
      <div className="node-inline-export-meta">
        <span className="node-inline-meta-text">
          {imageCount} image{imageCount !== 1 ? 's' : ''}
        </span>
        {exportedCount > 0 && <span className="node-inline-exported-badge">Exported</span>}
      </div>
    </div>
  );
}

function NumberValueInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  return (
    <div className="node-inline-editor">
      <input
        className="node-inline-number nopan nodrag"
        type="number"
        value={data.value as number}
        onChange={(e) => updateNodeData(nodeId, { value: parseFloat(e.target.value) || 0 })}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function ColorValueInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  return (
    <div className="node-inline-editor">
      <div className="node-inline-color-row">
        <input
          className="node-inline-color-picker nopan nodrag"
          type="color"
          value={data.value as string}
          onChange={(e) => updateNodeData(nodeId, { value: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <input
          className="node-inline-color-text nopan nodrag"
          value={data.value as string}
          onChange={(e) => updateNodeData(nodeId, { value: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

function formatMathNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

function MathNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const operation: MathOperationId = (data.operation as MathOperationId) || 'add';

  // Resolved as a JSON string so the default (reference-equality) selector
  // comparison skips re-renders when the computed state hasn't changed —
  // same trick `CombinePromptsContent` relies on for its live text preview.
  const mathStateJson = useWorkflowStore((s) =>
    JSON.stringify(resolveMathState(nodeId, s.edges, s.nodes)),
  );
  const mathState = useMemo<MathNodeState>(() => JSON.parse(mathStateJson), [mathStateJson]);

  return (
    <div className="node-math-content">
      <select
        className="inspector-select math-operation-select nopan nodrag"
        value={operation}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => updateNodeData(nodeId, { operation: e.target.value })}
      >
        {MATH_OPERATIONS.map((op) => (
          <option key={op.id} value={op.id}>
            {op.label}
          </option>
        ))}
      </select>
      <div className={`math-result-row${mathState.error ? ' math-result-error' : ''}`}>
        {mathState.error ? mathState.error : formatMathNumber(mathState.result)}
      </div>
    </div>
  );
}

function BooleanNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const valueType = (data.valueType as BooleanValueType) || 'text';
  const enabled = Boolean(data.enabled);

  const result = data._result as Record<string, any> | undefined;
  const pickedValue = result?.value;
  const selected = typeof result?.selected === 'string' ? result.selected : null;

  const pickedImageUrl = useImageObjectUrl(
    valueType === 'image' && typeof pickedValue === 'string' ? pickedValue : undefined,
  );

  return (
    <div className="node-editor-content">
      <select
        className="inspector-select nopan nodrag"
        value={valueType}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => setBooleanValueType(nodeId, e.target.value as BooleanValueType)}
      >
        {BOOLEAN_VALUE_TYPES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>

      <label
        className="stack-stretch-toggle nopan nodrag"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => updateNodeData(nodeId, { enabled: e.target.checked })}
        />
        <span>Output {enabled ? 'B' : 'A'}</span>
      </label>

      {pickedValue != null ? (
        <div
          className="editor-layer-summary"
          style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
        >
          <span>Selected Input {(selected ?? (enabled ? 'b' : 'a')).toUpperCase()}</span>
          {valueType === 'image' && pickedImageUrl && (
            <img src={pickedImageUrl} alt="Selected" className="node-preview-img" />
          )}
          {valueType === 'color' && typeof pickedValue === 'string' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="color-swatch" style={{ background: pickedValue }} />
              {pickedValue}
            </span>
          )}
          {(valueType === 'value' || valueType === 'text') && (
            <span className="combine-preview" style={{ width: '100%' }}>
              {String(pickedValue)}
            </span>
          )}
        </div>
      ) : (
        <div className="combine-preview empty">Run to see the switched output</div>
      )}
    </div>
  );
}

function renderNodeContent(type: string, data: Record<string, any>, nodeId: string) {
  switch (type) {
    case 'preview':
      return <PreviewNodeContent nodeId={nodeId} data={data} />;
    case 'importImage':
      return <ImportImageInlineEditor nodeId={nodeId} data={data} />;
    case 'numberValue':
      return <NumberValueInlineEditor nodeId={nodeId} data={data} />;
    case 'colorValue':
      return <ColorValueInlineEditor nodeId={nodeId} data={data} />;
    case 'prompt':
      return <PromptInlineEditor nodeId={nodeId} data={data} />;
    case 'exportImage':
      return <ExportImageInlineEditor nodeId={nodeId} data={data} />;
    case 'imageTo3d':
      return <Model3dResultThumb data={data} />;
    case 'preview3d':
      return <Preview3dNodeContent nodeId={nodeId} data={data} />;
    case 'export3d':
      return <Export3dInlineEditor data={data} />;
    case 'import3d':
      return <Import3dNodeContent data={data} />;
    default:
      return null;
  }
}

/**
 * Memoized so that selecting/deselecting one node (which rebuilds the `nodes`
 * array reference) doesn't re-render every other node's body — including their
 * potentially heavy image previews. React Flow passes stable props for nodes
 * that didn't change, so the default shallow comparison is sufficient.
 */
export default memo(BaseNode);
