import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  SelectionMode,
} from '@xyflow/react';
import type { ReactFlowInstance, Edge, Connection, FinalConnectionState, NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore, findGroupIdForNode } from '../store/workflowStore';
import { buildImportImageData } from '../utils/importImageData';
import { nodeTypes } from '../nodes/nodeRegistry';
import {
  NODE_TYPE_DEFINITIONS,
  NODE_CATEGORIES,
  getNodeInputs,
  getNodeOutputs,
  getNodeTypesConnectableFromWireOrigin,
  isNodeTypePinnable,
  type PortType,
} from '../types/nodeTypes';
import NodeGroups from './NodeGroups';

interface WireDropContext {
  originNodeId: string;
  handleId: string;
  handleType: 'source' | 'target';
}

interface ContextMenu {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  wireDrop?: WireDropContext;
}

interface CutPoint {
  x: number;
  y: number;
}

function isRasterImageFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    mime === 'image/pjpeg'
  ) {
    return true;
  }
  return /\.(png|jpe?g)$/i.test(file.name);
}

function FocusModeCanvasChip() {
  const focusedGroupId = useWorkflowStore((s) => s.focusedGroupId);
  const groups = useWorkflowStore((s) => s.groups);
  const clearGroupFocus = useWorkflowStore((s) => s.clearGroupFocus);
  const focusedGroup =
    focusedGroupId != null ? groups.find((g) => g.id === focusedGroupId) : undefined;

  if (!focusedGroup) return null;

  const title = `${focusedGroup.name} — run uses only this group. Press F or click to exit.`;

  return (
    <button
      type="button"
      className="focus-mode-canvas-chip"
      onClick={clearGroupFocus}
      title={title}
      aria-label={title}
    >
      <span className="focus-mode-canvas-chip-icon" aria-hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </span>
      <span className="focus-mode-canvas-chip-text">Focus mode</span>
    </button>
  );
}

export default function Canvas() {
  // Granular selectors so the canvas only re-renders when the data it actually
  // passes to ReactFlow changes (nodes / edges / isRunning), not on every store
  // tick (run progress, undo stack, dirty flag, etc.). Action references are
  // stable in zustand, so selecting them never triggers a re-render.
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const addNode = useWorkflowStore((s) => s.addNode);
  const addNodeAndConnectFromHandle = useWorkflowStore((s) => s.addNodeAndConnectFromHandle);
  const setBypassForNodeIds = useWorkflowStore((s) => s.setBypassForNodeIds);
  const deleteSelectedElements = useWorkflowStore((s) => s.deleteSelectedElements);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);
  const handleReconnect = useWorkflowStore((s) => s.handleReconnect);

  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextPaneClickRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [menuFilter, setMenuFilter] = useState('');

  // --- Reconnect (Disconnect + Pull) ---
  const edgeReconnectSuccessful = useRef(true);

  const onReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      edgeReconnectSuccessful.current = true;
      handleReconnect(oldEdge, newConnection);
    },
    [handleReconnect]
  );

  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      if (!edgeReconnectSuccessful.current) {
        removeEdgesByIds([edge.id]);
      }
      edgeReconnectSuccessful.current = true;
    },
    [removeEdgesByIds]
  );

  // --- Cut Mode (Ctrl + drag) ---
  const [isCutting, setIsCutting] = useState(false);
  const [cutPoints, setCutPoints] = useState<CutPoint[]>([]);
  const cutEdgeIdsRef = useRef<Set<string>>(new Set());
  const lastCutPos = useRef<{ x: number; y: number } | null>(null);
  const [ctrlHeld, setCtrlHeld] = useState(false);

  const onNodeDragStart = useCallback(() => {
    useWorkflowStore.getState().beginMoveUndoSession();
  }, []);
  const onNodeDragStop = useCallback(() => {
    useWorkflowStore.getState().endMoveUndoSession();
  }, []);
  const onSelectionDragStart = useCallback(() => {
    useWorkflowStore.getState().beginMoveUndoSession();
  }, []);
  const onSelectionDragStop = useCallback(() => {
    useWorkflowStore.getState().endMoveUndoSession();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(true);

      const el = e.target as HTMLElement | null;
      if (!el) return;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return;

      if (useWorkflowStore.getState().isRunning) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          useWorkflowStore.getState().redo();
        } else {
          useWorkflowStore.getState().undo();
        }
        return;
      }

      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void useWorkflowStore.getState().copySelectedNodes();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const store = useWorkflowStore.getState();
        const allNodes = store.nodes;
        if (allNodes.length === 0) return;
        const selectChanges: NodeChange[] = allNodes.map((n) => ({
          type: 'select',
          id: n.id,
          selected: true,
        }));
        store.onNodesChange(selectChanges);
        return;
      }
      if (mod && !e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        useWorkflowStore.getState().createGroupFromSelection();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') setCtrlHeld(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // --- Paste image from clipboard as Import Image node ---
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (useWorkflowStore.getState().isRunning) return;
      const el = e.target as HTMLElement | null;
      if (!el) return;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) return;

      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (useWorkflowStore.getState().tryPasteWorkflowClipboardText(text)) {
        e.preventDefault();
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      let imageItem: DataTransferItem | null = null;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          imageItem = item;
          break;
        }
      }
      if (!imageItem) return;

      e.preventDefault();
      const blob = imageItem.getAsFile();
      if (!blob) return;

      const rf = reactFlowInstance.current;
      const container = containerRef.current;
      if (!rf || !container) return;

      const rect = container.getBoundingClientRect();
      const position = rf.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });

      void (async () => {
        const overrides = await buildImportImageData(blob, `clipboard-${Date.now()}.png`);
        addNode('importImage', position, overrides);
      })();
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [addNode]);

  const checkEdgesUnderPoint = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return;

    const threshold = 10;
    const storeEdges = useWorkflowStore.getState().edges;

    for (const edge of storeEdges) {
      if (cutEdgeIdsRef.current.has(edge.id)) continue;

      const edgeEl = container.querySelector(
        `[data-testid="rf__edge-${CSS.escape(edge.id)}"]`
      );
      if (!edgeEl) continue;

      const pathEl = edgeEl.querySelector('.react-flow__edge-path') as SVGPathElement | null;
      if (!pathEl) continue;

      const bbox = pathEl.getBoundingClientRect();
      if (
        clientX < bbox.left - threshold ||
        clientX > bbox.right + threshold ||
        clientY < bbox.top - threshold ||
        clientY > bbox.bottom + threshold
      ) {
        continue;
      }

      const screenCTM = pathEl.getScreenCTM();
      if (!screenCTM) continue;

      const totalLength = pathEl.getTotalLength();
      const step = Math.max(4, totalLength / 60);

      for (let d = 0; d <= totalLength; d += step) {
        const pt = pathEl.getPointAtLength(d);
        const screenPt = new DOMPoint(pt.x, pt.y).matrixTransform(screenCTM);
        const dx = screenPt.x - clientX;
        const dy = screenPt.y - clientY;
        if (dx * dx + dy * dy < threshold * threshold) {
          cutEdgeIdsRef.current.add(edge.id);
          edgeEl.classList.add('cut-marked');
          break;
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!isCutting) return;

    const container = containerRef.current;

    const handlePointerMove = (e: PointerEvent) => {
      const curr = { x: e.clientX, y: e.clientY };
      const last = lastCutPos.current;

      if (last) {
        const dx = curr.x - last.x;
        const dy = curr.y - last.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(dist / 5));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          checkEdgesUnderPoint(last.x + dx * t, last.y + dy * t);
        }
      } else {
        checkEdgesUnderPoint(curr.x, curr.y);
      }

      lastCutPos.current = curr;

      if (container) {
        const rect = container.getBoundingClientRect();
        setCutPoints((prev) => [
          ...prev,
          { x: curr.x - rect.left, y: curr.y - rect.top },
        ]);
      }
    };

    const handlePointerUp = () => {
      if (cutEdgeIdsRef.current.size > 0) {
        removeEdgesByIds([...cutEdgeIdsRef.current]);
      }
      document
        .querySelectorAll('.cut-marked')
        .forEach((el) => el.classList.remove('cut-marked'));
      cutEdgeIdsRef.current = new Set();
      lastCutPos.current = null;
      setCutPoints([]);
      setIsCutting(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isCutting, removeEdgesByIds, checkEdgesUnderPoint]);

  const handlePointerDownCapture = useCallback((e: React.PointerEvent) => {
    // Clear any leftover browser text selection when starting an interaction on
    // the canvas (but keep it if the user is clicking into an editing field).
    if (e.button === 0) {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const editable =
        tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable;
      if (!editable) {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) sel.removeAllRanges();
      }
    }
    if (useWorkflowStore.getState().isRunning) return;
    if (e.ctrlKey && e.button === 0) {
      e.stopPropagation();
      e.preventDefault();
      setIsCutting(true);
      cutEdgeIdsRef.current = new Set();
      lastCutPos.current = null;
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        setCutPoints([{ x: e.clientX - rect.left, y: e.clientY - rect.top }]);
      }
      checkEdgesUnderPoint(e.clientX, e.clientY);
    }
  }, [checkEdgesUnderPoint]);

  // --- Edge click (clear node selection so inspector doesn't show stale data) ---
  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, _edge: Edge) => {
      setSelectedNodeId(null);
    },
    [setSelectedNodeId]
  );

  // --- Standard ReactFlow callbacks ---
  const onInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance;
  }, []);

  const onPaneClick = useCallback(() => {
    if (ignoreNextPaneClickRef.current) {
      ignoreNextPaneClickRef.current = false;
      return;
    }
    setSelectedNodeId(null);
    setContextMenu(null);
  }, [setSelectedNodeId]);

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      if (useWorkflowStore.getState().isRunning) return;
      if (!reactFlowInstance.current) return;
      const flowPos = reactFlowInstance.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: flowPos.x,
        flowY: flowPos.y,
      });
      setMenuFilter('');
    },
    []
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (useWorkflowStore.getState().isRunning) return;
      if (state.toHandle != null) return;
      const fromNode = state.fromNode;
      const fromHandle = state.fromHandle;
      if (!fromNode || !fromHandle) return;

      const rf = reactFlowInstance.current;
      if (!rf) return;

      const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === fromNode.id);
      if (!storeNode?.type) return;

      const handleId = fromHandle.id;
      if (handleId == null || handleId === '') return;

      let portType: PortType | undefined;
      if (fromHandle.type === 'source') {
        portType = getNodeOutputs(storeNode.type, storeNode.data as Record<string, any>).find(
          (p) => p.id === handleId,
        )?.type;
      } else {
        portType = getNodeInputs(storeNode.type, storeNode.data).find((p) => p.id === handleId)?.type;
      }
      if (!portType) return;

      const allowed = getNodeTypesConnectableFromWireOrigin(fromHandle.type, portType);
      if (allowed.size === 0) return;

      const clientX =
        'clientX' in event
          ? event.clientX
          : event.changedTouches[0]?.clientX ?? 0;
      const clientY =
        'clientY' in event
          ? event.clientY
          : event.changedTouches[0]?.clientY ?? 0;

      const flowPos = rf.screenToFlowPosition({ x: clientX, y: clientY });

      ignoreNextPaneClickRef.current = true;
      setContextMenu({
        x: clientX,
        y: clientY,
        flowX: flowPos.x,
        flowY: flowPos.y,
        wireDrop: {
          originNodeId: storeNode.id,
          handleId,
          handleType: fromHandle.type,
        },
      });
      setMenuFilter('');
    },
    []
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (useWorkflowStore.getState().isRunning) return;
      const rf = reactFlowInstance.current;
      if (!rf) return;

      const nodeType = event.dataTransfer.getData('application/reactflow-type');
      if (nodeType && NODE_TYPE_DEFINITIONS[nodeType]) {
        const position = rf.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        addNode(nodeType, position);
        return;
      }

      const files = Array.from(event.dataTransfer.files ?? []).filter(isRasterImageFile);
      if (files.length === 0) return;

      const base = rf.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      void (async () => {
        try {
          const step = 50;
          const overrides = await Promise.all(
            files.map((f) => buildImportImageData(f, f.name)),
          );
          files.forEach((_file, i) => {
            addNode('importImage', { x: base.x + i * step, y: base.y + i * step }, overrides[i]);
          });
        } catch {
          /* ignore read errors */
        }
      })();
    },
    [addNode]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const dt = event.dataTransfer;
    if (dt.types.includes('application/reactflow-type')) {
      dt.dropEffect = 'move';
    } else if (dt.types.includes('Files')) {
      dt.dropEffect = 'copy';
    } else {
      dt.dropEffect = 'move';
    }
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (contextMenu) {
        if (event.key === 'Escape') {
          ignoreNextPaneClickRef.current = false;
          setContextMenu(null);
          return;
        }
        return;
      }
      if (useWorkflowStore.getState().isRunning) return;

      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const store = useWorkflowStore.getState();
      const { nodes, selectedNodeId, focusedGroupId, groups, clearGroupFocus, toggleGroupFocus } =
        store;

      if (event.key === 'f' || event.key === 'F') {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (focusedGroupId) {
          clearGroupFocus();
          event.preventDefault();
          return;
        }
        if (selectedNodeId) {
          const gid = findGroupIdForNode(groups, selectedNodeId);
          if (gid) {
            toggleGroupFocus(gid);
            event.preventDefault();
          }
        }
        return;
      }

      if (event.key === 'm' || event.key === 'M') {
        if (event.ctrlKey || event.metaKey) return;
        if (focusedGroupId) return;
        let targetIds = nodes.filter((n) => n.selected).map((n) => n.id);
        if (targetIds.length === 0 && selectedNodeId) targetIds = [selectedNodeId];
        if (targetIds.length === 0) return;
        event.preventDefault();
        if (event.altKey) {
          setBypassForNodeIds(targetIds, false);
        } else {
          setBypassForNodeIds(targetIds, true);
        }
      }
      if (event.key === 'p' || event.key === 'P') {
        if (event.ctrlKey || event.metaKey) return;
        let targetIds = nodes.filter((n) => n.selected).map((n) => n.id);
        if (targetIds.length === 0 && selectedNodeId) targetIds = [selectedNodeId];
        const pinnable = targetIds.filter((nid) =>
          isNodeTypePinnable(nodes.find((n) => n.id === nid)?.type),
        );
        if (pinnable.length === 0) return;
        event.preventDefault();
        // Alt unpins; otherwise pin unless everything selected is already pinned.
        const allPinned = pinnable.every(
          (nid) => nodes.find((n) => n.id === nid)?.data.pinned,
        );
        store.setPinnedForNodeIds(pinnable, event.altKey ? false : !allPinned);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelectedElements();
      }
    },
    [setBypassForNodeIds, deleteSelectedElements, contextMenu]
  );

  const handleAddFromMenu = useCallback(
    (type: string) => {
      if (!contextMenu) return;
      const wire = contextMenu.wireDrop;
      if (wire) {
        addNodeAndConnectFromHandle(
          type,
          { x: contextMenu.flowX, y: contextMenu.flowY },
          undefined,
          wire
        );
      } else {
        addNode(type, { x: contextMenu.flowX, y: contextMenu.flowY });
      }
      setContextMenu(null);
    },
    [contextMenu, addNode, addNodeAndConnectFromHandle]
  );

  // --- Context menu grouping ---
  const grouped = Object.values(NODE_TYPE_DEFINITIONS).reduce(
    (acc, def) => {
      if (!acc[def.category]) acc[def.category] = [];
      acc[def.category].push(def);
      return acc;
    },
    {} as Record<string, (typeof NODE_TYPE_DEFINITIONS)[string][]>
  );

  const wireDropAllowedTypes = useMemo(() => {
    const wd = contextMenu?.wireDrop;
    if (!wd) return null;
    const storeNode = nodes.find((n) => n.id === wd.originNodeId);
    if (!storeNode?.type) return null;
    let portType: PortType | undefined;
    if (wd.handleType === 'source') {
      portType = getNodeOutputs(storeNode.type, storeNode.data as Record<string, any>).find(
        (p) => p.id === wd.handleId,
      )?.type;
    } else {
      portType = getNodeInputs(storeNode.type, storeNode.data).find((p) => p.id === wd.handleId)?.type;
    }
    if (!portType) return null;
    return getNodeTypesConnectableFromWireOrigin(wd.handleType, portType);
  }, [contextMenu?.wireDrop, nodes]);

  const filteredGrouped = Object.entries(grouped).reduce(
    (acc, [cat, defs]) => {
      let defsInCategory = defs;
      if (wireDropAllowedTypes) {
        defsInCategory = defs.filter((d) => wireDropAllowedTypes.has(d.type));
      }
      const filtered = menuFilter
        ? defsInCategory.filter((d) =>
            d.label.toLowerCase().includes(menuFilter.toLowerCase())
          )
        : defsInCategory;
      if (filtered.length > 0) acc[cat] = filtered;
      return acc;
    },
    {} as Record<string, (typeof NODE_TYPE_DEFINITIONS)[string][]>
  );

  return (
    <div
      className={`canvas-container${ctrlHeld ? ' cut-ready' : ''}${isCutting ? ' cutting' : ''}`}
      ref={containerRef}
      onKeyDown={onKeyDown}
      onPointerDownCapture={handlePointerDownCapture}
      tabIndex={0}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={isRunning ? undefined : onNodesChange}
        onEdgesChange={isRunning ? undefined : onEdgesChange}
        onConnect={isRunning ? undefined : onConnect}
        onConnectEnd={isRunning ? undefined : onConnectEnd}
        onInit={onInit}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onPaneContextMenu={onPaneContextMenu}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onReconnectStart={isRunning ? undefined : onReconnectStart}
        onReconnect={isRunning ? undefined : onReconnect}
        onReconnectEnd={isRunning ? undefined : onReconnectEnd}
        onNodeDragStart={isRunning ? undefined : onNodeDragStart}
        onNodeDragStop={isRunning ? undefined : onNodeDragStop}
        onSelectionDragStart={isRunning ? undefined : onSelectionDragStart}
        onSelectionDragStop={isRunning ? undefined : onSelectionDragStop}
        nodeTypes={nodeTypes}
        nodesDraggable={!isRunning}
        nodesConnectable={!isRunning}
        edgesReconnectable={!isRunning}
        elementsSelectable={!isRunning}
        fitView
        minZoom={0.1}
        maxZoom={4}
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={null}
        multiSelectionKeyCode="Shift"
        selectionKeyCode="Shift"
        selectionMode={SelectionMode.Partial}
        colorMode="dark"
      >
        <Background gap={16} size={1} />
        <NodeGroups />
        <Controls />
        <MiniMap nodeStrokeWidth={3} pannable zoomable />
      </ReactFlow>

      <FocusModeCanvasChip />

      {isCutting && cutPoints.length > 1 && (
        <svg className="cut-line-overlay">
          <polyline
            points={cutPoints.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            strokeDasharray="6 3"
            strokeLinecap="round"
          />
        </svg>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <input
            className="context-menu-search"
            placeholder="Search nodes..."
            value={menuFilter}
            onChange={(e) => setMenuFilter(e.target.value)}
            autoFocus
          />
          <div className="context-menu-list">
            {Object.entries(filteredGrouped).map(([cat, defs]) => {
              const category = NODE_CATEGORIES[cat];
              return (
                <div key={cat}>
                  <div
                    className="context-menu-category"
                    style={{ color: category?.color }}
                  >
                    {category?.label || cat}
                  </div>
                  {defs.map((def) => (
                    <div
                      key={def.type}
                      className="context-menu-item"
                      onClick={() => handleAddFromMenu(def.type)}
                    >
                      <span
                        className="context-menu-dot"
                        style={{ background: category?.color }}
                      />
                      {def.label}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
