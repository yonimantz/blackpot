import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  SelectionMode,
} from '@xyflow/react';
import type {
  ReactFlowInstance,
  Edge,
  Connection,
  FinalConnectionState,
  NodeChange,
  OnNodeDrag,
  OnMoveStart,
  OnMoveEnd,
  SelectionDragHandler,
  NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore } from '../store/workflowStore';
import { buildImportImageData } from '../utils/importImageData';
import { nodeTypes } from '../nodes/nodeRegistry';
import {
  NODE_TYPE_DEFINITIONS,
  NODE_CATEGORIES,
  PLACEABLE_NODE_DEFINITIONS,
  getNodeInputs,
  getNodeOutputs,
  getNodeTypesConnectableFromWireOrigin,
  pickRandomValueTypeForPort,
  booleanValueTypeForPort,
  isPlaceableNodeType,
  isNodeTypePinnable,
  type PortType,
} from '../types/nodeTypes';
import NodeGroups from './NodeGroups';
import Icon from '../icons/Icon';
import { iconForNodeType } from '../constants/nodeIcons';

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
  const clearCanvasSelection = useWorkflowStore((s) => s.clearCanvasSelection);
  const selectOnlyNode = useWorkflowStore((s) => s.selectOnlyNode);
  const addNode = useWorkflowStore((s) => s.addNode);
  const addNodeAndConnectFromHandle = useWorkflowStore((s) => s.addNodeAndConnectFromHandle);
  const setBypassForNodeIds = useWorkflowStore((s) => s.setBypassForNodeIds);
  const deleteSelectedElements = useWorkflowStore((s) => s.deleteSelectedElements);
  const removeEdgesByIds = useWorkflowStore((s) => s.removeEdgesByIds);
  const handleReconnect = useWorkflowStore((s) => s.handleReconnect);

  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextPaneClickRef = useRef(false);
  const pointerDraggedRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [menuFilter, setMenuFilter] = useState('');

  // Any press outside the menu dismisses it, including the press that starts a
  // pan or box-selection. Registered only while the menu is open, so the
  // pointer-up that opened it (wire drop / right click) cannot close it.
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      ignoreNextPaneClickRef.current = false;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', dismiss, true);
    return () => window.removeEventListener('pointerdown', dismiss, true);
  }, [contextMenu]);

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

  // Alt+drag duplicate: on drag start, leave a stationary copy of the dragged node(s) behind
  // and let the drag continue moving the originals as usual.
  const onNodeDragStart = useCallback<OnNodeDrag>((event, _node, nodes) => {
    pointerDraggedRef.current = true;
    document.body.classList.add('is-dragging-node');
    const store = useWorkflowStore.getState();
    store.beginMoveUndoSession();
    if (event.altKey) {
      store.duplicateNodesInPlace(nodes.map((n) => n.id));
    }
  }, []);
  const onNodeDragStop = useCallback(() => {
    document.body.classList.remove('is-dragging-node');
    useWorkflowStore.getState().endMoveUndoSession();
  }, []);
  const onSelectionDragStart = useCallback<SelectionDragHandler>((event, nodes) => {
    pointerDraggedRef.current = true;
    document.body.classList.add('is-dragging-node');
    const store = useWorkflowStore.getState();
    store.beginMoveUndoSession();
    if (event.altKey) {
      store.duplicateNodesInPlace(nodes.map((n) => n.id));
    }
  }, []);
  const onSelectionDragStop = useCallback(() => {
    document.body.classList.remove('is-dragging-node');
    useWorkflowStore.getState().endMoveUndoSession();
  }, []);

  const onMoveStart = useCallback<OnMoveStart>((event) => {
    if (event == null) return;
    if (event instanceof MouseEvent || event instanceof TouchEvent) {
      document.body.classList.add('is-panning');
    }
  }, []);
  const onMoveEnd = useCallback<OnMoveEnd>(() => {
    document.body.classList.remove('is-panning');
  }, []);

  useEffect(() => {
    return () => {
      document.body.classList.remove('is-connecting');
      document.body.classList.remove('is-dragging-node');
      document.body.classList.remove('is-panning');
      document.body.classList.remove('is-space-pan');
    };
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (isEditableTarget(e.target)) return;
      if (useWorkflowStore.getState().isRunning) return;
      document.body.classList.add('is-space-pan');
    };
    const clearSpacePan = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      document.body.classList.remove('is-space-pan');
    };
    const onWindowBlur = () => document.body.classList.remove('is-space-pan');

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', clearSpacePan, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', clearSpacePan, true);
      window.removeEventListener('blur', onWindowBlur);
      document.body.classList.remove('is-space-pan');
    };
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
    pointerDraggedRef.current = false;
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

  const onNodeClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      if (event.shiftKey || pointerDraggedRef.current) return;
      selectOnlyNode(node.id);
    },
    [selectOnlyNode]
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
    clearCanvasSelection();
    setContextMenu(null);
  }, [clearCanvasSelection]);

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

  const onConnectStart = useCallback(() => {
    document.body.classList.add('is-connecting');
  }, []);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      document.body.classList.remove('is-connecting');
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
      if (isPlaceableNodeType(nodeType)) {
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
      const { nodes, selectedNodeId } = store;

      if (event.key === 'm' || event.key === 'M') {
        if (event.ctrlKey || event.metaKey) return;
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
        let dataOverrides: Record<string, any> | undefined;
        if (type === 'pickRandom' || type === 'boolean') {
          // Pick Random and Boolean adapt to whatever they're wired to — seed
          // their valueType from the origin port so the new node (and its
          // edge) is already correctly typed instead of defaulting to image.
          const storeNode = nodes.find((n) => n.id === wire.originNodeId);
          if (storeNode?.type) {
            const originPort =
              wire.handleType === 'source'
                ? getNodeOutputs(storeNode.type, storeNode.data as Record<string, any>).find(
                    (p) => p.id === wire.handleId,
                  )
                : getNodeInputs(storeNode.type, storeNode.data).find((p) => p.id === wire.handleId);
            if (originPort) {
              dataOverrides = {
                valueType:
                  type === 'pickRandom'
                    ? pickRandomValueTypeForPort(originPort.type)
                    : booleanValueTypeForPort(originPort.type),
              };
            }
          }
        }
        addNodeAndConnectFromHandle(
          type,
          { x: contextMenu.flowX, y: contextMenu.flowY },
          dataOverrides,
          wire
        );
      } else {
        addNode(type, { x: contextMenu.flowX, y: contextMenu.flowY });
      }
      setContextMenu(null);
    },
    [contextMenu, nodes, addNode, addNodeAndConnectFromHandle]
  );

  // --- Context menu grouping ---
  const grouped = PLACEABLE_NODE_DEFINITIONS.reduce(
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
        onConnectStart={isRunning ? undefined : onConnectStart}
        onConnectEnd={isRunning ? undefined : onConnectEnd}
        onInit={onInit}
        onMoveStart={isRunning ? undefined : onMoveStart}
        onMoveEnd={isRunning ? undefined : onMoveEnd}
        onPaneClick={onPaneClick}
        onNodeClick={isRunning ? undefined : onNodeClick}
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
        selectionOnDrag
        panOnDrag={[1]}
        panActivationKeyCode="Space"
        colorMode="dark"
      >
        <Background gap={16} size={1} />
        <NodeGroups />
        <Controls />
        <MiniMap nodeStrokeWidth={3} pannable zoomable />
      </ReactFlow>

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
          ref={contextMenuRef}
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
                        className="context-menu-icon"
                        style={{ color: category?.color }}
                      >
                        <Icon name={iconForNodeType(def.type, def.category)} size={14} />
                      </span>
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
