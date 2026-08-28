import { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import EditorCanvasPreview from './EditorCanvasPreview';
import EditorLayerFields from './EditorLayerFields';
import Icon from '../icons/Icon';

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

  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  // This modal instance is reused across node selections (no `key` remount), so
  // clear a stale selection from a previously-edited node.
  useEffect(() => {
    setSelectedLayer(null);
  }, [nodeId]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapSize, setWrapSize] = useState({ width: 640, height: 480 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !open) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setWrapSize({ width: Math.max(80, rect.width), height: Math.max(80, rect.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  if (!open || !node) return null;

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
          <button type="button" className="compositor-modal-close" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="close-line" size={18} />
          </button>
        </div>
        <div className="compositor-modal-body">
          <aside className="compositor-modal-sidebar">
            <p className="compositor-modal-hint">
              Drag layers to move. Corners and edge midpoints resize; top edge rotate handle rotates.
              Hold <strong>Shift</strong> while scaling to keep the aspect ratio, <strong>Alt</strong> to
              scale from the center, or both together. Hold <strong>Shift</strong> while rotating to snap
              to 45&deg; steps. Use fields for precise values.
            </p>
            <p className="compositor-modal-hint">
              Anything past the frame edge is cropped out of the output, but the transform box stays
              live out there &mdash; you can still grab and drag a layer back in from outside the frame.
            </p>
            <EditorLayerFields
              nodeId={nodeId}
              data={data}
              updateNodeData={updateNodeData}
              disabled={isRunning}
              selectedLayer={selectedLayer}
              onSelectLayer={setSelectedLayer}
            />
          </aside>
          <div className="compositor-modal-canvas-wrap" ref={wrapRef}>
            <EditorCanvasPreview
              nodeId={nodeId}
              data={data}
              selectedLayer={selectedLayer}
              onSelectLayer={setSelectedLayer}
              maxPreviewWidth={wrapSize.width}
              maxPreviewHeight={wrapSize.height}
              disabled={isRunning}
              className="compositor-modal-canvas editor-canvas-interactive editor-canvas-no-round"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
