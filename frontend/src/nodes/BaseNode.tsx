import { Handle, Position, NodeResizer, NodeResizeControl, ResizeControlVariant } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useMemo, useCallback, useRef } from 'react';
import {
  NODE_TYPE_DEFINITIONS,
  NODE_CATEGORIES,
  PORT_TYPE_COLORS,
  getNodeInputs,
  isTextResizableNodeType,
} from '../types/nodeTypes';
import {
  REFMAPPER_MAX_ENTRIES,
  buildRefMapperOutputString,
  newRefMapperEntryId,
  normalizeRefMapperEntries,
  resolveUpstreamTextOutput,
} from '../constants/refMapperAttributes';
import StudioFields from '../components/StudioFields';
import { useWorkflowStore, isNodeEffectivelyBypassed } from '../store/workflowStore';

export default function BaseNode({ id, type, data, selected }: NodeProps) {
  const def = NODE_TYPE_DEFINITIONS[type!];
  if (!def) return <div>Unknown node: {type}</div>;

  const category = NODE_CATEGORIES[def.category];
  const focusedGroupId = useWorkflowStore((s) => s.focusedGroupId);
  const groups = useWorkflowStore((s) => s.groups);
  const bypassed = isNodeEffectivelyBypassed(
    id,
    Boolean(data.bypassed),
    focusedGroupId,
    groups,
  );
  const nodeInputs = getNodeInputs(type!, data);
  const isPreview = type === 'preview';
  const isTextResizable = isTextResizableNodeType(type!);

  const isRunning = useWorkflowStore((s) => s.isRunning);
  const activeNodeId = useWorkflowStore((s) => s.activeNodeId);
  const completedNodeIds = useWorkflowStore((s) => s.completedNodeIds);
  const runResults = useWorkflowStore((s) => s.runResults);
  const isExecuting = isRunning && activeNodeId === id;
  const isCompleted = isRunning && completedNodeIds.includes(id);
  const nodeResult = runResults[id];
  const hasError = nodeResult && nodeResult.error && !nodeResult.skipped;
  const wasSkipped = nodeResult && nodeResult.skipped;

  const classNames = [
    'workflow-node',
    selected ? 'selected' : '',
    bypassed ? 'bypassed' : '',
    isPreview ? 'preview-resizable' : '',
    isTextResizable ? 'text-node-resizable' : '',
    isExecuting ? 'node-executing' : '',
    isCompleted && !hasError && !wasSkipped ? 'node-completed' : '',
    hasError ? 'node-error' : '',
    wasSkipped ? 'node-skipped' : '',
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
        {isExecuting && <span className="node-executing-spinner" />}
      </div>
      <div className="node-body">
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
            {def.outputs.map((port) => {
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
        {type === 'combinePrompts' ? (
          <CombinePromptsContent nodeId={id} data={data} />
        ) : type === 'refMapper' ? (
          <RefMapperContent nodeId={id} data={data} />
        ) : type === 'sketch2Final' ? (
          <Sketch2FinalInlineEditor nodeId={id} data={data} />
        ) : type === 'studio' ? (
          <StudioFields nodeId={id} data={data} />
        ) : type === 'nanoBananaPro' ? (
          <NanoBananaProContent nodeId={id} data={data} />
        ) : type === 'nanoBanana2' ? (
          <NanoBanana2Content nodeId={id} data={data} />
        ) : type === 'imageScfPrompt' ? (
          <div className="node-ai-info inspector-empty-small" style={{ opacity: 0.75, padding: '4px 0' }}>
            Style / Content / Feel toggles in inspector
          </div>
        ) : type === 'editor' ? (
          <EditorNodeContent nodeId={id} data={data} />
        ) : type === 'compositor' ? (
          <CompositorNodeContent data={data} />
        ) : type === 'vignette' ? (
          <VignetteNodeContent data={data} />
        ) : type === 'crop' ? (
          <CropNodeContent nodeId={id} data={data} />
        ) : (
          renderNodeContent(type!, data, id)
        )}
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
          <span className="ai-node-add-ref-icon" aria-hidden>+</span>
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
  const edges = useWorkflowStore((s) => s.edges);
  const allNodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

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
          <span className="ai-node-add-ref-icon" aria-hidden>+</span>
          <span>Add Input</span>
        </button>
      </div>
    </div>
  );
}

function NanoBananaProContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const refImageCount = (data.refImageCount as number) || 1;

  return (
    <div className="node-ai-info">
      <button
        type="button"
        className="ai-node-add-ref-btn nopan nodrag"
        title="Add a reference image input"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          updateNodeData(nodeId, { refImageCount: refImageCount + 1 });
        }}
      >
        <span className="ai-node-add-ref-icon" aria-hidden>+</span>
        <span>Add Image</span>
      </button>
    </div>
  );
}

function NanoBanana2Content({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const refImageCount = (data.refImageCount as number) || 1;

  return (
    <div className="node-ai-info">
      <button
        type="button"
        className="ai-node-add-ref-btn nopan nodrag"
        title="Add a reference image input"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          updateNodeData(nodeId, { refImageCount: refImageCount + 1 });
        }}
      >
        <span className="ai-node-add-ref-icon" aria-hidden>+</span>
        <span>Add Image</span>
      </button>
    </div>
  );
}

function EditorNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const layerCount = (data.layerCount as number) || 0;

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <span className="editor-layer-icon">&#9776;</span>
        <span>{layerCount} layer{layerCount !== 1 ? 's' : ''} + BG</span>
      </div>
      {data._editorPreview && (
        <img src={data._editorPreview as string} alt="Editor preview" className="node-preview-img" />
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
            layers[`layer${newCount}`] = { x: 0, y: 0, width: 0, height: 0, rotation: 0, flipH: false };
            updateNodeData(nodeId, { layerCount: newCount, layers });
          }}
        >
          <span className="ai-node-add-ref-icon" aria-hidden>+</span>
          <span>Add Layer</span>
        </button>
      </div>
    </div>
  );
}

function CropNodeContent({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const openCropEditorModal = useWorkflowStore((s) => s.openCropEditorModal);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const x = Number(data.x) || 0;
  const y = Number(data.y) || 0;
  const w = Number(data.width) || 0;
  const h = Number(data.height) || 0;

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <span>
          {x}, {y} · {w}×{h}
        </span>
      </div>
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

function CompositorNodeContent({ data }: { data: Record<string, any> }) {
  const w = Math.max(1, Number(data.width) || 512);
  const h = Math.max(1, Number(data.height) || 512);
  const layerList = Array.isArray(data.layers) ? data.layers : [];
  const n = layerList.length;

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <span className="editor-layer-icon">&#9638;</span>
        <span>
          {n} shape{n !== 1 ? 's' : ''} · {w}×{h}
        </span>
      </div>
      {data._compositorPreview && (
        <img src={data._compositorPreview as string} alt="Compositor preview" className="node-preview-img" />
      )}
    </div>
  );
}

function VignetteNodeContent({ data }: { data: Record<string, any> }) {
  const layerList = Array.isArray(data.vignetteLayers) ? data.vignetteLayers : [];
  const n = layerList.length;

  return (
    <div className="node-editor-content">
      <div className="editor-layer-summary">
        <span className="editor-layer-icon">&#9673;</span>
        <span>
          {n} vignette layer{n !== 1 ? 's' : ''}
        </span>
      </div>
      {data._vignettePreview && (
        <img src={data._vignettePreview as string} alt="Vignette preview" className="node-preview-img" />
      )}
    </div>
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

function ImportImageInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        updateNodeData(nodeId, { fileData: reader.result as string, filePath: file.name });
      };
      reader.readAsDataURL(file);
    },
    [nodeId, updateNodeData]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        updateNodeData(nodeId, { fileData: reader.result as string, filePath: file.name });
      };
      reader.readAsDataURL(file);
    },
    [nodeId, updateNodeData]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className="node-inline-editor">
      {data.fileData ? (
        <div className="node-inline-import-loaded">
          <img src={data.fileData as string} alt="Import" className="node-preview-img" />
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
          <div className="dropzone-icon">+</div>
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

function ExportImageInlineEditor({ nodeId, data }: { nodeId: string; data: Record<string, any> }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const exportPath = (data.exportPath as string) || '';

  return (
    <div className="node-inline-editor">
      <input
        className="node-inline-input nopan nodrag"
        value={exportPath}
        onChange={(e) => updateNodeData(nodeId, { exportPath: e.target.value })}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Export path..."
        title={exportPath || 'Set export path'}
      />
      <div className="node-inline-export-meta">
        <span className="node-inline-meta-text">{data.fileName as string}.{data.format as string}</span>
        {data._lastExportedPath && <span className="node-inline-exported-badge">Exported</span>}
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

function renderNodeContent(type: string, data: Record<string, any>, nodeId: string) {
  switch (type) {
    case 'preview':
      return data.previewData ? (
        <img src={data.previewData as string} alt="Preview" className="node-preview-img" />
      ) : (
        <div className="node-preview-placeholder">No preview</div>
      );
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
    case 'nanoBananaPro':
      return null;
    case 'nanoBanana2':
      return null;
    default:
      return null;
  }
}
