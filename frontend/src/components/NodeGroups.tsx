import { useState, useCallback, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import { useWorkflowStore } from '../store/workflowStore';
import type { NodeGroup } from '../store/workflowStore';

const PADDING = 24;
const HEADER_HEIGHT = 36;

function getGroupBounds(
  group: NodeGroup,
  nodes: Node[]
): { x: number; y: number; width: number; height: number } | null {
  const groupNodes = nodes.filter((n) => group.nodeIds.includes(n.id));
  if (groupNodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of groupNodes) {
    const w = node.measured?.width ?? 180;
    const h = node.measured?.height ?? 80;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }

  return {
    x: minX - PADDING,
    y: minY - PADDING - HEADER_HEIGHT,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2 + HEADER_HEIGHT,
  };
}

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div className="confirm-buttons">
          <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="confirm-btn confirm-btn-danger" onClick={onConfirm}>
            Delete All
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupBox({
  group,
  onRequestDelete,
}: {
  group: NodeGroup;
  onRequestDelete: () => void;
}) {
  const nodes = useWorkflowStore((s) => s.nodes);
  const ungroupNodes = useWorkflowStore((s) => s.ungroupNodes);
  const updateGroupName = useWorkflowStore((s) => s.updateGroupName);
  const moveGroupNodes = useWorkflowStore((s) => s.moveGroupNodes);
  const focusedGroupId = useWorkflowStore((s) => s.focusedGroupId);
  const toggleGroupFocus = useWorkflowStore((s) => s.toggleGroupFocus);
  const viewport = useViewport();

  const isFocused = focusedGroupId === group.id;

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(viewport.zoom);
  zoomRef.current = viewport.zoom;

  const bounds = getGroupBounds(group, nodes);
  if (!bounds) return null;

  const handleStartEdit = useCallback(() => {
    setEditName(group.name);
    setEditing(true);
  }, [group.name]);

  const handleSaveName = useCallback(() => {
    updateGroupName(group.id, editName.trim() || 'Group');
    setEditing(false);
  }, [group.id, editName, updateGroupName]);

  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = { x: e.clientX, y: e.clientY };

      const handleMove = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        const dx = (ev.clientX - dragRef.current.x) / zoomRef.current;
        const dy = (ev.clientY - dragRef.current.y) / zoomRef.current;
        dragRef.current = { x: ev.clientX, y: ev.clientY };
        moveGroupNodes(group.id, dx, dy);
      };

      const handleUp = () => {
        dragRef.current = null;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [group.id, moveGroupNodes]
  );

  return (
    <div
      className={`node-group-box${isFocused ? ' node-group-box-focused' : ''}`}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        borderColor: `${group.color}80`,
        background: `${group.color}12`,
      }}
    >
      <div
        className="node-group-header"
        style={{ background: `${group.color}30` }}
        onPointerDown={handleDragStart}
      >
        {editing ? (
          <input
            className="node-group-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') handleSaveName();
              if (e.key === 'Escape') setEditing(false);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="node-group-name" onDoubleClick={handleStartEdit}>
            {group.name}
          </span>
        )}
        <div className="node-group-actions">
          <button
            type="button"
            className={`node-group-btn node-group-btn-focus${isFocused ? ' node-group-btn-focus-active' : ''}`}
            title="Focus group — run only this group (F). Edges from outside are ignored while focused."
            onClick={(e) => {
              e.stopPropagation();
              toggleGroupFocus(group.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          </button>
          <button
            className="node-group-btn"
            title="Ungroup"
            onClick={(e) => {
              e.stopPropagation();
              ungroupNodes(group.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            ⊟
          </button>
          <button
            className="node-group-btn node-group-btn-danger"
            title="Delete all nodes in group"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NodeGroups() {
  const viewport = useViewport();
  const groups = useWorkflowStore((s) => s.groups);
  const deleteGroupNodes = useWorkflowStore((s) => s.deleteGroupNodes);
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null);

  if (groups.length === 0 && !confirmGroupId) return null;

  return (
    <>
      <div className="node-groups-layer">
        <div
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {groups.map((group) => (
            <GroupBox
              key={group.id}
              group={group}
              onRequestDelete={() => setConfirmGroupId(group.id)}
            />
          ))}
        </div>
      </div>

      {confirmGroupId && (
        <ConfirmDialog
          message="Delete all nodes in this group? This cannot be undone."
          onConfirm={() => {
            deleteGroupNodes(confirmGroupId);
            setConfirmGroupId(null);
          }}
          onCancel={() => setConfirmGroupId(null)}
        />
      )}
    </>
  );
}
