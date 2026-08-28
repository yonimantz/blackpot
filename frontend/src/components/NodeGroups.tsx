import { useCallback, useRef, useState } from 'react';
import { useViewport, useNodesInitialized, ViewportPortal } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import { useWorkflowStore } from '../store/workflowStore';
import type { NodeGroup } from '../store/workflowStore';
import { startWorkflowRun, stopWorkflowRun } from '../utils/runWorkflow';
import Icon from '../icons/Icon';

const PADDING = 24;
const HEADER_HEIGHT = 36;
const GROUP_COLOR = '#8b5cf6';
const FALLBACK_WIDTH = 180;
const FALLBACK_HEIGHT = 80;

// Right after a workflow (re)loads — e.g. coming back from Collection/Playground —
// React Flow hasn't measured the freshly mounted node DOM yet, so `measured` is
// empty for a frame. Fall back to the node's own explicit/initial size (persisted
// for resizable nodes like Preview) before resorting to a guessed constant, so the
// group frame doesn't visibly snap from the wrong size once measurement lands.
function getNodeSize(node: Node): { width: number; height: number } {
  return {
    width: node.measured?.width ?? node.width ?? node.initialWidth ?? FALLBACK_WIDTH,
    height: node.measured?.height ?? node.height ?? node.initialHeight ?? FALLBACK_HEIGHT,
  };
}

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
    const { width: w, height: h } = getNodeSize(node);
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
  // Subscribe to a serialized bounds string instead of the whole nodes array,
  // so the box only re-renders when its own members actually move/resize — not
  // on every box-select frame (which rebuilds the nodes array each tick).
  const boundsKey = useWorkflowStore((s) => {
    const b = getGroupBounds(group, s.nodes);
    return b ? `${b.x}|${b.y}|${b.width}|${b.height}` : '';
  });
  const ungroupNodes = useWorkflowStore((s) => s.ungroupNodes);
  const updateGroupName = useWorkflowStore((s) => s.updateGroupName);
  const moveGroupNodes = useWorkflowStore((s) => s.moveGroupNodes);
  const clearCanvasSelection = useWorkflowStore((s) => s.clearCanvasSelection);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const runningGroupId = useWorkflowStore((s) => s.runningGroupId);
  const getGroupRunPayload = useWorkflowStore((s) => s.getGroupRunPayload);
  const setHoveredRunGroupId = useWorkflowStore((s) => s.setHoveredRunGroupId);
  const viewport = useViewport();

  const isRunningThisGroup = runningGroupId === group.id;
  const playDisabled = isRunning && !isRunningThisGroup;

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(viewport.zoom);
  zoomRef.current = viewport.zoom;

  if (!boundsKey) return null;
  const [bx, by, bw, bh] = boundsKey.split('|').map(Number);
  const bounds = { x: bx, y: by, width: bw, height: bh };

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
      clearCanvasSelection();
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
    [group.id, moveGroupNodes, clearCanvasSelection]
  );

  const handlePlayClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setHoveredRunGroupId(null);
      if (isRunningThisGroup) {
        await stopWorkflowRun();
        return;
      }
      if (playDisabled) return;
      await startWorkflowRun(getGroupRunPayload(group.id), { groupId: group.id });
    },
    [group.id, isRunningThisGroup, playDisabled, getGroupRunPayload, setHoveredRunGroupId]
  );

  const onEmptyGroupPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      clearCanvasSelection();
    },
    [clearCanvasSelection],
  );

  return (
    <div
      className="node-group-box"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        borderColor: `${GROUP_COLOR}80`,
      }}
    >
      <div
        className="node-group-empty-hit"
        style={{ top: HEADER_HEIGHT, left: 0, right: 0, height: PADDING }}
        onPointerDown={onEmptyGroupPointerDown}
      />
      <div
        className="node-group-empty-hit"
        style={{ top: HEADER_HEIGHT + PADDING, left: 0, bottom: 0, width: PADDING }}
        onPointerDown={onEmptyGroupPointerDown}
      />
      <div
        className="node-group-empty-hit"
        style={{ top: HEADER_HEIGHT + PADDING, right: 0, bottom: 0, width: PADDING }}
        onPointerDown={onEmptyGroupPointerDown}
      />
      <div
        className="node-group-empty-hit"
        style={{ left: PADDING, right: PADDING, bottom: 0, height: PADDING }}
        onPointerDown={onEmptyGroupPointerDown}
      />
      <div
        className="node-group-header"
        style={{ background: `${GROUP_COLOR}30` }}
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
            className={`node-group-btn node-group-play-btn${isRunningThisGroup ? ' node-group-play-btn-active' : ''}`}
            title={isRunningThisGroup ? 'Stop this group' : 'Run only the nodes in this group'}
            disabled={playDisabled}
            onClick={handlePlayClick}
            onMouseEnter={() => setHoveredRunGroupId(group.id)}
            onMouseLeave={() => setHoveredRunGroupId(null)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Icon name={isRunningThisGroup ? 'stop-fill' : 'play-fill'} size={12} />
          </button>
          <button
            className="node-group-btn"
            title="Ungroup"
            aria-label="Ungroup"
            onClick={(e) => {
              e.stopPropagation();
              ungroupNodes(group.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Icon name="vector-group-line" size={13} />
          </button>
          <button
            className="node-group-btn node-group-btn-danger"
            title="Delete all nodes in group"
            aria-label="Delete all nodes in group"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Icon name="delete-2-line" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NodeGroups() {
  const groups = useWorkflowStore((s) => s.groups);
  const deleteGroupNodes = useWorkflowStore((s) => s.deleteGroupNodes);
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null);
  // Right after the canvas (re)mounts — e.g. coming back from Collection/
  // Playground/Settings — React Flow hasn't measured the freshly mounted node
  // DOM yet. Wait for real sizes before drawing frames so groups don't flash
  // at the wrong bounds while nodes are still settling in.
  const nodesInitialized = useNodesInitialized();

  if (groups.length === 0 && !confirmGroupId) return null;

  return (
    <>
      {nodesInitialized && (
        // ViewportPortal renders into the same transformed pane React Flow uses
        // for nodes/edges, so group frames automatically track pan/zoom and stay
        // aligned even when the canvas remounts — no manual transform to desync.
        <ViewportPortal>
          {groups.map((group) => (
            <GroupBox
              key={group.id}
              group={group}
              onRequestDelete={() => setConfirmGroupId(group.id)}
            />
          ))}
        </ViewportPortal>
      )}

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
