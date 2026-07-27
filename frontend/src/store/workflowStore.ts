import { create } from 'zustand';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import type { Node, Edge, Connection, NodeChange, EdgeChange } from '@xyflow/react';
import {
  NODE_TYPE_DEFINITIONS,
  PORT_TYPE_COLORS,
  canConnect,
  getNodeInputs,
  getNodeOutputs,
  pickSourceOutputHandleId,
  pickTargetInputHandleId,
  DEFAULT_PREVIEW_NODE_WIDTH,
  DEFAULT_PREVIEW_NODE_HEIGHT,
  isNodeTypePinnable,
} from '../types/nodeTypes';
import type { WorkflowTemplate } from '../types/templateTypes';
import { reconcileTemplate } from '../types/templateTypes';
import {
  DEFAULT_WORKFLOW_ICON_COLOR,
  resolveWorkflowIconTint,
} from '../constants/workflowIcons';
import { getWorkflow as fetchWorkflow, saveWorkflow } from '../utils/api';
import { getNodeImageOutputDataUrl } from '../utils/upstreamImage';
import { assetIsReachable, uploadDataUrlAsAsset } from '../utils/importImageData';

let nodeIdCounter = 0;
let groupIdCounter = 0;
/** Increments on each paste from the internal clipboard; reset when copying. */
let pasteGeneration = 0;

const MAX_UNDO = 20;

/** Editor run uses node.data from JSON; normalize visibility flags so the backend always sees real booleans. */
function normalizeEditorDataForRun(data: Record<string, any> | undefined): Record<string, any> {
  if (!data || typeof data !== 'object') return data ?? {};
  const layerCount = Math.max(0, Math.floor(Number(data.layerCount) || 0));
  const raw = data.layers;
  const layers: Record<string, any> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, any>) } : {};
  for (let i = 1; i <= layerCount; i++) {
    const k = `layer${i}`;
    const cfg = layers[k];
    if (cfg != null && typeof cfg === 'object' && !Array.isArray(cfg)) {
      layers[k] = {
        ...cfg,
        hidden: Boolean((cfg as Record<string, any>).hidden),
      };
    }
  }
  return {
    ...data,
    bgHidden: Boolean(data.bgHidden),
    layerCount,
    layers,
  };
}

/**
 * Strip regenerable / transient fields from node data before persisting.
 *
 * Image-heavy fields (baked previews, run results) are re-derived from their
 * upstream sources on load (the bake effects re-run), so writing them to disk
 * only bloats the saved JSON, the SQLite `workflows.data` column, and the 3s
 * autosave `JSON.stringify`. We drop every `_`-prefixed key plus `previewData`.
 * Real source data (e.g. `fileData`) is intentionally kept.
 */
function stripTransientNodeData(data: Record<string, any> | undefined): Record<string, any> {
  if (!data || typeof data !== 'object') return data ?? {};
  const out: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    if (key.startsWith('_')) continue;
    if (key === 'previewData') continue;
    out[key] = data[key];
  }
  return out;
}

/** Set or clear `pinned`, dropping the key entirely when false so saved nodes stay lean. */
function withPinnedFlag(data: Record<string, any>, pinned: boolean): Record<string, any> {
  if (pinned) return { ...data, pinned: true };
  const { pinned: _drop, ...rest } = data;
  return rest;
}

/** Guards against overlapping autosaves (a slow save spanning multiple ticks). */
let isSaving = false;

/**
 * One-time migration: externalize image bytes that older workflows stored
 * inline as base64 (`fileData`) into the file store, replacing them with a
 * lightweight `fileAssetId` reference. Runs in the background after a load so
 * it never blocks opening a workflow. Bails if the user switches workflows
 * mid-migration. The `_dirty` flag it sets lets the normal autosave persist
 * the slimmed-down graph.
 */
async function migrateInlineImageAssets(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
): Promise<void> {
  const wfId = get().workflowId;
  const targets = get().nodes.filter(
    (n) =>
      n.type === 'importImage' &&
      typeof (n.data as Record<string, any>)?.fileData === 'string' &&
      ((n.data as Record<string, any>).fileData as string).startsWith('data:') &&
      !(n.data as Record<string, any>).fileAssetId,
  );
  if (targets.length === 0) return;

  for (const node of targets) {
    const dataUrl = (node.data as Record<string, any>).fileData as string;
    const fileId = await uploadDataUrlAsAsset(dataUrl);
    if (!fileId) continue;
    // Only externalize once we've confirmed the asset can be served back —
    // otherwise (e.g. an older backend without the serving route) we'd drop a
    // working inline image and show nothing.
    if (!(await assetIsReachable(fileId))) continue;
    // The user may have navigated away or the node may be gone / already
    // migrated by the time the upload resolves.
    if (get().workflowId !== wfId) return;
    const current = get().nodes.find((n) => n.id === node.id);
    if (!current || (current.data as Record<string, any>).fileAssetId) continue;
    set({
      nodes: get().nodes.map((n) =>
        n.id === node.id
          ? { ...n, data: { ...n.data, fileAssetId: fileId, fileData: '' } }
          : n,
      ),
      _dirty: true,
    });
  }
}

/** True while applying undo/redo so we do not record new history entries. */
let applyingHistory = false;
/** Skip per-frame history for node position updates during drag. */
let coalescePosition = false;
/** Nesting: selection drag + node drag must not double-push snapshots. */
let moveUndoSessionDepth = 0;
/** Skip per-frame history for dimension updates during resize. */
let coalesceDimensions = false;

/**
 * Coalesce rapid `updateNodeData` calls that touch the same node + same field
 * set into a single undo entry — same idea as `coalescePosition` but for data
 * edits (typing, pasting, slider drags). Without this, every keystroke/paste
 * pushes its own snapshot, churning the undo stack and making every paste pay
 * the full snapshot cost.
 */
const DATA_EDIT_COALESCE_MS = 800;
let lastDataEditCoalesceKey: string | null = null;
let lastDataEditCoalesceTs = 0;

/** Remove edges that target handles no longer defined on the node (e.g. after node schema changes). */
function dropEdgesToRemovedTargetHandles(nodes: Node[], edges: Edge[]): Edge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.filter((e) => {
    const target = byId.get(e.target);
    if (!target?.type) return true;
    const th = e.targetHandle ?? '';
    const inputs = getNodeInputs(target.type, target.data as Record<string, unknown>);
    return inputs.some((p) => p.id === th);
  });
}

interface WorkflowSnapshot {
  nodes: Node[];
  edges: Edge[];
  groups: NodeGroup[];
  focusedGroupId: string | null;
  selectedNodeId: string | null;
}

/**
 * Snapshot the graph for undo/redo. Every mutation in this store creates fresh
 * arrays/objects (spread + .map), so we can safely keep references instead of
 * deep-cloning. structuredClone of a workflow with image data URLs (Import
 * Image, baked previews, etc.) can take seconds and was previously paid on
 * every keystroke / paste, which froze the UI.
 */
function takeGraphSnapshot(s: {
  nodes: Node[];
  edges: Edge[];
  groups: NodeGroup[];
  focusedGroupId: string | null;
  selectedNodeId: string | null;
}): WorkflowSnapshot {
  return {
    nodes: s.nodes,
    edges: s.edges,
    groups: s.groups,
    focusedGroupId: s.focusedGroupId,
    selectedNodeId: s.selectedNodeId,
  };
}

function pushUndoSnapshot(get: () => WorkflowState, set: (partial: Partial<WorkflowState>) => void) {
  if (applyingHistory) return;
  const s = get();
  const snap = takeGraphSnapshot(s);
  // A non-data-edit push breaks any in-flight text-edit coalesce window so
  // the next keystroke still gets its own snapshot if it touches a different
  // operation.
  lastDataEditCoalesceKey = null;
  set({
    past: [...s.past, snap].slice(-MAX_UNDO),
    future: [],
  });
}

function shouldPushForNodeChanges(changes: NodeChange[]): boolean {
  if (applyingHistory || changes.length === 0) return false;
  if (changes.every((c) => c.type === 'select')) return false;
  if (coalescePosition && changes.every((c) => c.type === 'position')) return false;
  if (coalesceDimensions && changes.every((c) => c.type === 'dimensions')) return false;
  return true;
}

function shouldPushForEdgeChanges(changes: EdgeChange[]): boolean {
  if (applyingHistory || changes.length === 0) return false;
  return !changes.every((c) => c.type === 'select');
}

function resetUndoCoalesceState() {
  coalescePosition = false;
  coalesceDimensions = false;
  moveUndoSessionDepth = 0;
  lastDataEditCoalesceKey = null;
  lastDataEditCoalesceTs = 0;
}

/** When a compositor's background input is wired to an image, match canvas size to the image (no extra undo step). */
function scheduleCompositorCanvasSizeFromSource(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
  compositorNodeId: string,
  sourceData: Record<string, any>,
) {
  const src = getNodeImageOutputDataUrl(sourceData);
  if (!src || typeof src !== 'string') return;
  const img = new Image();
  img.onload = () => {
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return;
    const w = Math.max(1, Math.min(8192, nw));
    const h = Math.max(1, Math.min(8192, nh));
    const state = get();
    const node = state.nodes.find((n) => n.id === compositorNodeId);
    if (!node || node.type !== 'compositor') return;
    set({
      nodes: state.nodes.map((n) =>
        n.id === compositorNodeId ? { ...n, data: { ...n.data, width: w, height: h } } : n
      ),
      _dirty: true,
    });
  };
  img.onerror = () => {};
  img.src = src;
}

const GROUP_COLOR = '#8b5cf6';

export interface NodeGroup {
  id: string;
  name: string;
  nodeIds: string[];
  color: string;
}

/** Group that contains this node id, if any. */
export function findGroupIdForNode(groups: NodeGroup[], nodeId: string): string | null {
  for (const g of groups) {
    if (g.nodeIds.includes(nodeId)) return g.id;
  }
  return null;
}

/** Stored bypass OR focus overlay (nodes outside focused group appear bypassed). */
export function isNodeEffectivelyBypassed(
  nodeId: string,
  dataBypassed: boolean,
  focusedGroupId: string | null,
  groups: NodeGroup[],
): boolean {
  if (dataBypassed) return true;
  if (!focusedGroupId) return false;
  const g = groups.find((x) => x.id === focusedGroupId);
  if (!g) return false;
  return !g.nodeIds.includes(nodeId);
}

export interface WorkflowState {
  nodes: Node[];
  edges: Edge[];
  groups: NodeGroup[];
  focusedGroupId: string | null;
  selectedNodeId: string | null;
  isRunning: boolean;
  runResults: Record<string, any>;
  activeNodeId: string | null;
  completedNodeIds: string[];

  workflowId: string | null;
  workflowName: string | null;
  workflowIconId: string | null;
  workflowIconColor: string;
  workflowDescription: string | null;
  /** Published template for this workflow, or null if it was never set. */
  template: WorkflowTemplate | null;
  _dirty: boolean;

  /** When set, Crop modal is open for this node (inspector or node button). */
  cropEditorModalNodeId: string | null;
  /** When set, Divider modal is open for this node (inspector or node button). */
  dividerEditorModalNodeId: string | null;

  past: WorkflowSnapshot[];
  future: WorkflowSnapshot[];

  undo: () => void;
  redo: () => void;
  beginMoveUndoSession: () => void;
  endMoveUndoSession: () => void;
  beginResizeUndoSession: () => void;
  endResizeUndoSession: () => void;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setSelectedNodeId: (id: string | null) => void;
  addNode: (type: string, position: { x: number; y: number }, dataOverrides?: Record<string, any>) => void;
  addNodeAndConnectFromHandle: (
    newNodeType: string,
    position: { x: number; y: number },
    dataOverrides: Record<string, any> | undefined,
    wire: { originNodeId: string; handleId: string; handleType: 'source' | 'target' },
  ) => void;
  updateNodeData: (nodeId: string, data: Record<string, any>) => void;
  /**
   * Ensure a preview node has explicit dimensions set so subsequent
   * `previewData` updates don't cause the node to auto-grow/shrink to
   * fit the image. Uses the currently measured size when available,
   * otherwise falls back to the preview default.
   */
  lockPreviewNodeSize: (nodeId: string) => void;
  toggleBypass: (nodeId: string) => void;
  setBypassForNodeIds: (nodeIds: string[], bypassed: boolean) => void;
  togglePin: (nodeId: string) => void;
  setPinnedForNodeIds: (nodeIds: string[], pinned: boolean) => void;
  /** Publish (or re-publish) the template. Pass null to unpublish. */
  setTemplate: (template: WorkflowTemplate | null) => void;
  deleteSelectedNodes: () => void;
  deleteSelectedElements: () => void;
  removeEdgesByIds: (ids: string[]) => void;
  handleReconnect: (oldEdge: Edge, newConnection: Connection) => void;
  setIsRunning: (running: boolean) => void;
  setRunResults: (results: Record<string, any>) => void;
  setActiveNodeId: (id: string | null) => void;
  markNodeCompleted: (id: string) => void;
  clearRunProgress: () => void;
  getWorkflowJSON: () => { nodes: any[]; edges: any[]; workflow_id?: string | null };
  getRunWorkflowPayload: () => { nodes: any[]; edges: any[]; workflow_id?: string | null };
  toggleGroupFocus: (groupId: string) => void;
  clearGroupFocus: () => void;
  duplicateSelectedNodes: () => void;
  createGroupFromSelection: () => void;
  ungroupNodes: (groupId: string) => void;
  deleteGroupNodes: (groupId: string) => void;
  updateGroupName: (groupId: string, name: string) => void;
  moveGroupNodes: (groupId: string, dx: number, dy: number) => void;

  loadWorkflow: (id: string) => Promise<boolean>;
  saveNow: () => Promise<void>;
  setWorkflowName: (name: string) => void;
  setWorkflowIconId: (iconId: string) => void;
  setWorkflowDescription: (description: string) => void;
  resetWorkflow: () => void;

  openCropEditorModal: (nodeId: string) => void;
  closeCropEditorModal: () => void;
  openDividerEditorModal: (nodeId: string) => void;
  closeDividerEditorModal: () => void;

  copySelectedNodes: () => Promise<void>;
  tryPasteWorkflowClipboardText: (text: string) => boolean;
}

const CLIPBOARD_PREFIX = 'spoton-workflow-clipboard:';

function duplicateSubgraphAtOffset(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
  templateNodes: Node[],
  templateInternalEdges: Edge[],
  offsetSteps: number,
): void {
  if (templateNodes.length === 0) return;

  pushUndoSnapshot(get, set);

  const { nodes, edges } = get();
  const idMap = new Map<string, string>();
  const dx = 50 * offsetSteps;
  const dy = 50 * offsetSteps;

  const newNodes = templateNodes.map((node) => {
    const newId = `node_${++nodeIdCounter}_${Date.now()}`;
    idMap.set(node.id, newId);
    const baseData =
      node.data && typeof node.data === 'object' ? (node.data as Record<string, any>) : {};
    return {
      ...node,
      id: newId,
      position: { x: node.position.x + dx, y: node.position.y + dy },
      data: { ...baseData },
      selected: true,
    };
  });

  const newEdges = templateInternalEdges.map((e) => ({
    ...e,
    id: `edge_dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  }));

  const deselectedOld = nodes.map((n) =>
    n.selected ? { ...n, selected: false } : n
  );

  set({
    nodes: [...deselectedOld, ...newNodes],
    edges: [...edges, ...newEdges],
    _dirty: true,
  });
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  groups: [],
  focusedGroupId: null,
  selectedNodeId: null,
  isRunning: false,
  runResults: {},
  activeNodeId: null,
  completedNodeIds: [],

  workflowId: null,
  workflowName: null,
  workflowIconId: null,
  workflowIconColor: DEFAULT_WORKFLOW_ICON_COLOR,
  workflowDescription: null,
  template: null,
  _dirty: false,

  cropEditorModalNodeId: null,
  dividerEditorModalNodeId: null,

  past: [],
  future: [],

  beginMoveUndoSession: () => {
    if (moveUndoSessionDepth === 0) {
      pushUndoSnapshot(get, set);
      coalescePosition = true;
    }
    moveUndoSessionDepth += 1;
  },

  endMoveUndoSession: () => {
    moveUndoSessionDepth = Math.max(0, moveUndoSessionDepth - 1);
    if (moveUndoSessionDepth === 0) {
      coalescePosition = false;
    }
  },

  beginResizeUndoSession: () => {
    pushUndoSnapshot(get, set);
    coalesceDimensions = true;
  },

  endResizeUndoSession: () => {
    coalesceDimensions = false;
  },

  undo: () => {
    const s = get();
    if (s.isRunning || s.past.length === 0) return;
    const current = takeGraphSnapshot(s);
    const prev = s.past[s.past.length - 1];
    const newPast = s.past.slice(0, -1);
    const newFuture = [...s.future, current].slice(-MAX_UNDO);
    applyingHistory = true;
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      groups: prev.groups,
      focusedGroupId: prev.focusedGroupId,
      selectedNodeId: prev.selectedNodeId,
      past: newPast,
      future: newFuture,
      _dirty: true,
    });
    applyingHistory = false;
    lastDataEditCoalesceKey = null;
  },

  redo: () => {
    const s = get();
    if (s.isRunning || s.future.length === 0) return;
    const current = takeGraphSnapshot(s);
    const next = s.future[s.future.length - 1];
    const newFuture = s.future.slice(0, -1);
    const newPast = [...s.past, current].slice(-MAX_UNDO);
    applyingHistory = true;
    set({
      nodes: next.nodes,
      edges: next.edges,
      groups: next.groups,
      focusedGroupId: next.focusedGroupId,
      selectedNodeId: next.selectedNodeId,
      past: newPast,
      future: newFuture,
      _dirty: true,
    });
    applyingHistory = false;
    lastDataEditCoalesceKey = null;
  },

  onNodesChange: (changes) => {
    if (shouldPushForNodeChanges(changes)) {
      pushUndoSnapshot(get, set);
    }
    // Selection state isn't persisted (saveNow never writes `selected`), so a
    // box-select shouldn't mark the workflow dirty — otherwise the 3s autosave
    // keeps re-uploading the whole graph (incl. base64 images) every selection.
    const selectionOnly = changes.every((c) => c.type === 'select');
    set({
      nodes: applyNodeChanges(changes, get().nodes),
      ...(selectionOnly ? {} : { _dirty: true }),
    });
    const selectionChange = changes.find(
      (c): c is NodeChange & { type: 'select'; id: string; selected: boolean } =>
        c.type === 'select' && 'selected' in c && (c as any).selected
    );
    if (selectionChange) {
      set({ selectedNodeId: selectionChange.id });
    }
  },

  onEdgesChange: (changes) => {
    if (shouldPushForEdgeChanges(changes)) {
      pushUndoSnapshot(get, set);
    }
    set({ edges: applyEdgeChanges(changes, get().edges), _dirty: true });
  },

  onConnect: (connection) => {
    const { nodes, edges } = get();
    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return;

    const sourceDef = NODE_TYPE_DEFINITIONS[sourceNode.type!];
    const targetDef = NODE_TYPE_DEFINITIONS[targetNode.type!];
    if (!sourceDef || !targetDef) return;

    const sourceOutputs = getNodeOutputs(sourceNode.type!, sourceNode.data as Record<string, any>);
    const sourcePort = sourceOutputs.find((p) => p.id === connection.sourceHandle);
    const targetInputs = getNodeInputs(targetNode.type!, targetNode.data);
    const targetPort = targetInputs.find((p) => p.id === connection.targetHandle);
    if (!sourcePort || !targetPort) return;

    if (!canConnect(sourcePort.type, targetPort.type)) return;

    const filteredEdges = edges.filter(
      (e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle)
    );

    const edgeColor = PORT_TYPE_COLORS[sourcePort.type] || '#aaa';
    const styledEdge = {
      ...connection,
      style: { stroke: edgeColor, strokeWidth: 2 },
    };
    pushUndoSnapshot(get, set);
    set({ edges: addEdge(styledEdge, filteredEdges), _dirty: true });

    if (targetNode.type === 'compositor' && connection.targetHandle === 'background') {
      scheduleCompositorCanvasSizeFromSource(
        get,
        set,
        connection.target,
        sourceNode.data as Record<string, any>,
      );
    }
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  openCropEditorModal: (nodeId) => set({ cropEditorModalNodeId: nodeId, selectedNodeId: nodeId }),

  closeCropEditorModal: () => set({ cropEditorModalNodeId: null }),

  openDividerEditorModal: (nodeId) => set({ dividerEditorModalNodeId: nodeId, selectedNodeId: nodeId }),

  closeDividerEditorModal: () => set({ dividerEditorModalNodeId: null }),

  addNode: (type, position, dataOverrides) => {
    const def = NODE_TYPE_DEFINITIONS[type];
    if (!def) return;
    pushUndoSnapshot(get, set);
    const id = `node_${++nodeIdCounter}_${Date.now()}`;
    const newNode: Node = {
      id,
      type,
      position,
      data: { ...def.defaults, label: def.label, bypassed: false, ...dataOverrides },
      selected: false,
      ...(type === 'preview'
        ? { width: DEFAULT_PREVIEW_NODE_WIDTH, height: DEFAULT_PREVIEW_NODE_HEIGHT }
        : {}),
    };
    set({ nodes: [...get().nodes, newNode], _dirty: true });
  },

  addNodeAndConnectFromHandle: (newNodeType, position, dataOverrides, wire) => {
    const def = NODE_TYPE_DEFINITIONS[newNodeType];
    if (!def) return;

    const { nodes, edges } = get();
    const originNode = nodes.find((n) => n.id === wire.originNodeId);
    if (!originNode) return;

    const originDef = NODE_TYPE_DEFINITIONS[originNode.type!];
    if (!originDef) return;

    const newData = { ...def.defaults, label: def.label, bypassed: false, ...dataOverrides };
    const id = `node_${++nodeIdCounter}_${Date.now()}`;

    let connection: Connection;

    if (wire.handleType === 'source') {
      const sourcePort = getNodeOutputs(originNode.type!, originNode.data as Record<string, any>).find(
        (p) => p.id === wire.handleId,
      );
      if (!sourcePort) return;
      const targetHandle = pickTargetInputHandleId(newNodeType, newData, sourcePort.type);
      if (!targetHandle) return;
      connection = {
        source: wire.originNodeId,
        sourceHandle: wire.handleId,
        target: id,
        targetHandle,
      };
    } else {
      const targetInputs = getNodeInputs(originNode.type!, originNode.data);
      const targetPort = targetInputs.find((p) => p.id === wire.handleId);
      if (!targetPort) return;
      const sourceHandle = pickSourceOutputHandleId(newNodeType, targetPort.type);
      if (!sourceHandle) return;
      connection = {
        source: id,
        sourceHandle,
        target: wire.originNodeId,
        targetHandle: wire.handleId,
      };
    }

    const newNode: Node = {
      id,
      type: newNodeType,
      position,
      data: newData,
      selected: false,
      ...(newNodeType === 'preview'
        ? { width: DEFAULT_PREVIEW_NODE_WIDTH, height: DEFAULT_PREVIEW_NODE_HEIGHT }
        : {}),
    };

    const resolvedSource = connection.source === id ? newNode : originNode;
    const resolvedTarget = connection.target === id ? newNode : originNode;

    const resolvedSourceDef = NODE_TYPE_DEFINITIONS[resolvedSource.type!];
    const resolvedTargetDef = NODE_TYPE_DEFINITIONS[resolvedTarget.type!];
    if (!resolvedSourceDef || !resolvedTargetDef) return;

    const sp = getNodeOutputs(resolvedSource.type!, resolvedSource.data as Record<string, any>).find(
      (p) => p.id === connection.sourceHandle,
    );
    const tInputs = getNodeInputs(resolvedTarget.type!, resolvedTarget.data);
    const tp = tInputs.find((p) => p.id === connection.targetHandle);
    if (!sp || !tp || !canConnect(sp.type, tp.type)) return;

    const filteredEdges = edges.filter(
      (e) => !(e.target === connection.target && e.targetHandle === connection.targetHandle),
    );

    const edgeColor = PORT_TYPE_COLORS[sp.type] || '#aaa';
    const styledEdge = {
      ...connection,
      style: { stroke: edgeColor, strokeWidth: 2 },
    };

    pushUndoSnapshot(get, set);
    set({
      nodes: [...nodes, newNode],
      edges: addEdge(styledEdge, filteredEdges),
      _dirty: true,
    });

    if (resolvedTarget.type === 'compositor' && connection.targetHandle === 'background') {
      scheduleCompositorCanvasSizeFromSource(
        get,
        set,
        connection.target,
        resolvedSource.data as Record<string, any>,
      );
    }
  },

  updateNodeData: (nodeId, data) => {
    const fieldKey = Object.keys(data).sort().join(',');
    const coalesceKey = `${nodeId}::${fieldKey}`;
    const now = Date.now();
    const sameRapidEdit =
      lastDataEditCoalesceKey === coalesceKey &&
      now - lastDataEditCoalesceTs < DATA_EDIT_COALESCE_MS;
    if (!sameRapidEdit) {
      pushUndoSnapshot(get, set);
    }
    lastDataEditCoalesceKey = coalesceKey;
    lastDataEditCoalesceTs = now;
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      ),
      _dirty: true,
    });
  },

  lockPreviewNodeSize: (nodeId) => {
    const nodes = get().nodes;
    const target = nodes.find((n) => n.id === nodeId);
    if (!target || target.type !== 'preview') return;
    if (target.width != null && target.height != null) return;
    const measured = (target as Node & { measured?: { width?: number; height?: number } })
      .measured;
    const width = target.width ?? measured?.width ?? DEFAULT_PREVIEW_NODE_WIDTH;
    const height = target.height ?? measured?.height ?? DEFAULT_PREVIEW_NODE_HEIGHT;
    set({
      nodes: nodes.map((n) => (n.id === nodeId ? { ...n, width, height } : n)),
      _dirty: true,
    });
  },

  toggleBypass: (nodeId) => {
    if (get().focusedGroupId) return;
    pushUndoSnapshot(get, set);
    const nodes = get().nodes;
    set({
      nodes: nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, bypassed: !n.data.bypassed } }
          : n
      ),
      _dirty: true,
    });
  },

  setBypassForNodeIds: (nodeIds, bypassed) => {
    if (get().focusedGroupId) return;
    const idSet = new Set(nodeIds);
    if (idSet.size === 0) return;
    const nodes = get().nodes;
    const needsChange = nodes.some(
      (n) => idSet.has(n.id) && Boolean(n.data.bypassed) !== bypassed
    );
    if (!needsChange) return;
    pushUndoSnapshot(get, set);
    set({
      nodes: nodes.map((n) =>
        idSet.has(n.id)
          ? { ...n, data: { ...n.data, bypassed } }
          : n
      ),
      _dirty: true,
    });
  },

  togglePin: (nodeId) => {
    const node = get().nodes.find((n) => n.id === nodeId);
    if (!node || !isNodeTypePinnable(node.type)) return;
    get().setPinnedForNodeIds([nodeId], !node.data.pinned);
  },

  setPinnedForNodeIds: (nodeIds, pinned) => {
    const idSet = new Set(nodeIds);
    if (idSet.size === 0) return;
    const { nodes, template } = get();
    const targets = nodes.filter(
      (n) => idSet.has(n.id) && isNodeTypePinnable(n.type) && Boolean(n.data.pinned) !== pinned,
    );
    if (targets.length === 0) return;
    const changed = new Set(targets.map((n) => n.id));
    pushUndoSnapshot(get, set);
    const nextNodes = nodes.map((n) =>
      changed.has(n.id) ? { ...n, data: withPinnedFlag(n.data as Record<string, any>, pinned) } : n,
    );
    set({
      nodes: nextNodes,
      // A published template must not drift from the pins it describes.
      template: template ? reconcileTemplate(template, nextNodes) : null,
      _dirty: true,
    });
  },

  setTemplate: (template) => {
    set({ template, _dirty: true });
  },

  toggleGroupFocus: (groupId) => {
    const { groups, focusedGroupId } = get();
    if (!groups.some((g) => g.id === groupId)) return;
    pushUndoSnapshot(get, set);
    if (focusedGroupId === groupId) {
      set({ focusedGroupId: null });
    } else {
      set({ focusedGroupId: groupId });
    }
  },

  clearGroupFocus: () => {
    if (!get().focusedGroupId) return;
    pushUndoSnapshot(get, set);
    set({ focusedGroupId: null });
  },

  deleteSelectedNodes: () => {
    const { nodes, edges, selectedNodeId } = get();
    if (!selectedNodeId) return;
    pushUndoSnapshot(get, set);
    set({
      nodes: nodes.filter((n) => n.id !== selectedNodeId),
      edges: edges.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
      ),
      selectedNodeId: null,
      _dirty: true,
    });
  },

  deleteSelectedElements: () => {
    const { nodes, edges, selectedNodeId, groups } = get();
    const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));

    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

    pushUndoSnapshot(get, set);

    const updatedGroups = groups
      .map((g) => ({
        ...g,
        nodeIds: g.nodeIds.filter((id) => !selectedNodeIds.has(id)),
      }))
      .filter((g) => g.nodeIds.length > 0);

    const { focusedGroupId } = get();
    const focusStillValid =
      focusedGroupId &&
      updatedGroups.some((g) => g.id === focusedGroupId);

    set({
      nodes: nodes.filter((n) => !selectedNodeIds.has(n.id)),
      edges: edges.filter(
        (e) =>
          !selectedEdgeIds.has(e.id) &&
          !selectedNodeIds.has(e.source) &&
          !selectedNodeIds.has(e.target)
      ),
      selectedNodeId:
        selectedNodeId && selectedNodeIds.has(selectedNodeId) ? null : selectedNodeId,
      groups: updatedGroups,
      ...(focusStillValid ? {} : { focusedGroupId: null }),
      _dirty: true,
    });
  },

  removeEdgesByIds: (ids) => {
    if (ids.length === 0) return;
    pushUndoSnapshot(get, set);
    const idSet = new Set(ids);
    set({ edges: get().edges.filter((e) => !idSet.has(e.id)), _dirty: true });
  },

  handleReconnect: (oldEdge, newConnection) => {
    const { nodes, edges } = get();
    const sourceNode = nodes.find((n) => n.id === newConnection.source);
    const targetNode = nodes.find((n) => n.id === newConnection.target);
    if (!sourceNode || !targetNode) return;

    const sourceDef = NODE_TYPE_DEFINITIONS[sourceNode.type!];
    const targetDef = NODE_TYPE_DEFINITIONS[targetNode.type!];
    if (!sourceDef || !targetDef) return;

    const sourceOutputs = getNodeOutputs(sourceNode.type!, sourceNode.data as Record<string, any>);
    const sourcePort = sourceOutputs.find((p) => p.id === newConnection.sourceHandle);
    const targetInputs = getNodeInputs(targetNode.type!, targetNode.data);
    const targetPort = targetInputs.find((p) => p.id === newConnection.targetHandle);
    if (!sourcePort || !targetPort) return;

    if (!canConnect(sourcePort.type, targetPort.type)) return;

    const filteredEdges = edges.filter(
      (e) =>
        e.id === oldEdge.id ||
        !(e.target === newConnection.target && e.targetHandle === newConnection.targetHandle)
    );

    const edgeColor = PORT_TYPE_COLORS[sourcePort.type] || '#aaa';
    const updatedEdge: Edge = {
      ...oldEdge,
      source: newConnection.source,
      target: newConnection.target,
      sourceHandle: newConnection.sourceHandle,
      targetHandle: newConnection.targetHandle,
      style: { stroke: edgeColor, strokeWidth: 2 },
    };

    pushUndoSnapshot(get, set);
    set({
      edges: filteredEdges.map((e) => (e.id === oldEdge.id ? updatedEdge : e)),
      _dirty: true,
    });
  },

  setIsRunning: (running) => set({ isRunning: running }),
  setRunResults: (results) => set({ runResults: results }),
  setActiveNodeId: (id) => set({ activeNodeId: id }),
  markNodeCompleted: (id) => set({ completedNodeIds: [...get().completedNodeIds, id] }),
  clearRunProgress: () => set({ activeNodeId: null, completedNodeIds: [] }),

  getWorkflowJSON: () => {
    const { nodes, edges, workflowId } = get();
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        data:
          n.type === 'editor'
            ? normalizeEditorDataForRun(n.data as Record<string, any>)
            : n.data,
        position: n.position,
        ...(n.style ? { style: n.style } : {}),
        ...(n.width != null ? { width: n.width } : {}),
        ...(n.height != null ? { height: n.height } : {}),
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
      workflow_id: workflowId,
    };
  },

  getRunWorkflowPayload: () => {
    const { nodes, edges, workflowId, focusedGroupId, groups } = get();
    const baseNodes = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      data:
        n.type === 'editor'
          ? normalizeEditorDataForRun(n.data as Record<string, any>)
          : n.data,
      position: n.position,
      ...(n.style ? { style: n.style } : {}),
      ...(n.width != null ? { width: n.width } : {}),
      ...(n.height != null ? { height: n.height } : {}),
    }));
    const baseEdges = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));
    const base = {
      nodes: baseNodes,
      edges: baseEdges,
      workflow_id: workflowId,
    };
    if (!focusedGroupId) return base;
    const group = groups.find((g) => g.id === focusedGroupId);
    if (!group) return base;
    const ids = new Set(group.nodeIds);
    return {
      ...base,
      nodes: baseNodes.filter((n) => ids.has(n.id)),
      edges: baseEdges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
  },

  duplicateSelectedNodes: () => {
    const { nodes, edges } = get();
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;
    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const internalEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
    );
    duplicateSubgraphAtOffset(get, set, selectedNodes, internalEdges, 1);
  },

  copySelectedNodes: async () => {
    const { nodes, edges } = get();
    const selectedNodes = nodes.filter((n) => n.selected);
    if (selectedNodes.length === 0) return;
    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const internalEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
    );
    pasteGeneration = 0;
    const payload = {
      v: 1 as const,
      nodes: structuredClone(selectedNodes),
      edges: structuredClone(internalEdges),
    };
    const str = CLIPBOARD_PREFIX + JSON.stringify(payload);
    try {
      await navigator.clipboard.writeText(str);
    } catch {
      // e.g. non-secure context or permission denied
    }
  },

  tryPasteWorkflowClipboardText: (text) => {
    if (!text.startsWith(CLIPBOARD_PREFIX)) return false;
    let parsed: { v?: number; nodes?: unknown; edges?: unknown };
    try {
      parsed = JSON.parse(text.slice(CLIPBOARD_PREFIX.length));
    } catch {
      return false;
    }
    if (parsed.v !== 1 || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
      return false;
    }
    const templateNodes = parsed.nodes as Node[];
    const templateEdges = (Array.isArray(parsed.edges) ? parsed.edges : []) as Edge[];
    const ids = new Set(templateNodes.map((n) => n?.id).filter(Boolean) as string[]);
    const internalEdges = templateEdges.filter(
      (e) => e && ids.has(e.source) && ids.has(e.target),
    );
    pasteGeneration += 1;
    duplicateSubgraphAtOffset(get, set, templateNodes, internalEdges, pasteGeneration);
    return true;
  },

  createGroupFromSelection: () => {
    const { nodes, groups } = get();
    const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    if (selectedNodeIds.length === 0) return;

    pushUndoSnapshot(get, set);

    const selectedSet = new Set(selectedNodeIds);
    const updatedGroups = groups
      .map((g) => ({
        ...g,
        nodeIds: g.nodeIds.filter((id) => !selectedSet.has(id)),
      }))
      .filter((g) => g.nodeIds.length > 0);

    const newGroup: NodeGroup = {
      id: `group_${++groupIdCounter}_${Date.now()}`,
      name: 'Group',
      nodeIds: selectedNodeIds,
      color: GROUP_COLOR,
    };

    const nextGroups = [...updatedGroups, newGroup];
    const { focusedGroupId } = get();
    const focusStillValid =
      focusedGroupId && nextGroups.some((g) => g.id === focusedGroupId);

    set({
      groups: nextGroups,
      ...(focusStillValid ? {} : { focusedGroupId: null }),
      _dirty: true,
    });
  },

  ungroupNodes: (groupId) => {
    const { groups, focusedGroupId } = get();
    pushUndoSnapshot(get, set);
    set({
      groups: groups.filter((g) => g.id !== groupId),
      ...(focusedGroupId === groupId ? { focusedGroupId: null } : {}),
      _dirty: true,
    });
  },

  deleteGroupNodes: (groupId) => {
    const { nodes, edges, groups, selectedNodeId, focusedGroupId } = get();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    pushUndoSnapshot(get, set);

    const nodeIdsToDelete = new Set(group.nodeIds);

    set({
      nodes: nodes.filter((n) => !nodeIdsToDelete.has(n.id)),
      edges: edges.filter(
        (e) => !nodeIdsToDelete.has(e.source) && !nodeIdsToDelete.has(e.target)
      ),
      groups: groups.filter((g) => g.id !== groupId),
      selectedNodeId:
        selectedNodeId && nodeIdsToDelete.has(selectedNodeId) ? null : selectedNodeId,
      ...(focusedGroupId === groupId ? { focusedGroupId: null } : {}),
      _dirty: true,
    });
  },

  updateGroupName: (groupId, name) => {
    pushUndoSnapshot(get, set);
    set({
      groups: get().groups.map((g) =>
        g.id === groupId ? { ...g, name } : g
      ),
      _dirty: true,
    });
  },

  moveGroupNodes: (groupId, dx, dy) => {
    const { nodes, groups } = get();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    pushUndoSnapshot(get, set);

    const nodeIdSet = new Set(group.nodeIds);
    set({
      nodes: nodes.map((n) =>
        nodeIdSet.has(n.id)
          ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
          : n
      ),
      _dirty: true,
    });
  },

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  loadWorkflow: async (id: string): Promise<boolean> => {
    try {
      const wf = await fetchWorkflow(id);
      const data = wf.data || { nodes: [], edges: [], groups: [] };
      const loadedNodes = data.nodes || [];
      const loadedEdges = dropEdgesToRemovedTargetHandles(loadedNodes, data.edges || []);
      resetUndoCoalesceState();
      set({
        workflowId: wf.id,
        workflowName: wf.name,
        workflowIconId: wf.icon_id ?? null,
        workflowIconColor: resolveWorkflowIconTint(wf.icon_color),
        workflowDescription: wf.description ?? '',
        nodes: loadedNodes,
        edges: loadedEdges,
        groups: data.groups || [],
        template: data.template ? reconcileTemplate(data.template, loadedNodes) : null,
        focusedGroupId: null,
        selectedNodeId: null,
        cropEditorModalNodeId: null,
        dividerEditorModalNodeId: null,
        runResults: {},
        _dirty: false,
        past: [],
        future: [],
      });
      // Externalize any legacy inline images in the background.
      void migrateInlineImageAssets(get, set);
      return true;
    } catch {
      return false;
    }
  },

  saveNow: async () => {
    const {
      workflowId,
      workflowName,
      workflowIconId,
      workflowIconColor,
      workflowDescription,
      nodes,
      edges,
      groups,
      template,
      _dirty,
    } = get();
    if (!workflowId || !_dirty) return;
    // Don't let a slow save overlap with the next autosave tick — otherwise two
    // big serializations/uploads pile up on the main thread.
    if (isSaving) return;
    isSaving = true;

    const data = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        data: stripTransientNodeData(n.data as Record<string, any>),
        position: n.position,
        ...(n.style ? { style: n.style } : {}),
        ...(n.width != null ? { width: n.width } : {}),
        ...(n.height != null ? { height: n.height } : {}),
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        style: e.style,
      })),
      groups,
      ...(template ? { template } : {}),
    };

    // Clear the dirty flag up-front: edits made *during* the await should
    // re-dirty the store so the next tick saves them, rather than being lost
    // when this save resolves and clears the flag.
    set({ _dirty: false });
    try {
      await saveWorkflow(workflowId, {
        name: workflowName || undefined,
        data,
        icon_id: workflowIconId || undefined,
        icon_color: workflowIconColor,
        description: workflowDescription ?? '',
      });
    } catch {
      // Save failed — mark dirty again so the next interval retries.
      set({ _dirty: true });
    } finally {
      isSaving = false;
    }
  },

  setWorkflowName: (name: string) => {
    set({ workflowName: name, _dirty: true });
  },

  setWorkflowIconId: (iconId: string) => {
    set({ workflowIconId: iconId, _dirty: true });
  },

  setWorkflowDescription: (description: string) => {
    set({ workflowDescription: description, _dirty: true });
  },

  resetWorkflow: () => {
    resetUndoCoalesceState();
    set({
      workflowId: null,
      workflowName: null,
      workflowIconId: null,
      workflowIconColor: DEFAULT_WORKFLOW_ICON_COLOR,
      workflowDescription: null,
      template: null,
      nodes: [],
      edges: [],
      groups: [],
      focusedGroupId: null,
      selectedNodeId: null,
      cropEditorModalNodeId: null,
      dividerEditorModalNodeId: null,
      runResults: {},
      _dirty: false,
      past: [],
      future: [],
    });
  },
}));
