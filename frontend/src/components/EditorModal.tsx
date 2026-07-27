import { useWorkflowStore } from '../store/workflowStore';
import EditorCanvasPreview from './EditorCanvasPreview';
import EditorLayerFields from './EditorLayerFields';

export default function EditorModal({
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

  if (!open || !node) return null;

  const maxPreviewWidth = Math.min(960, Math.max(200, window.innerWidth - 120 - 280));
  const maxPreviewHeight = Math.max(
    180,
    Math.floor(window.innerHeight * 0.92 - 168),
  );

  return (
    <div
      className="compositor-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="compositor-modal editor-modal" role="dialog" aria-labelledby="editor-modal-title">
        <div className="compositor-modal-header">
          <h2 id="editor-modal-title">Editor</h2>
          <button type="button" className="compositor-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Drag layers to move. Corners and edge midpoints resize; top edge rotate handle rotates. Use fields for
              precise values.
            </p>
            <EditorLayerFields
              nodeId={nodeId}
              data={data}
              updateNodeData={updateNodeData}
              disabled={isRunning}
            />
          </aside>
          <div className="compositor-modal-canvas-wrap">
            <EditorCanvasPreview
              nodeId={nodeId}
              data={data}
              maxPreviewWidth={maxPreviewWidth}
              maxPreviewHeight={maxPreviewHeight}
              disabled={isRunning}
              className="compositor-modal-canvas editor-canvas-interactive editor-canvas-no-round"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
