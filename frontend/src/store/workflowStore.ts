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
  isResizablePreviewNodeType,
} from '../types/nodeTypes';
import type { WorkflowTemplate } from '../types/templateTypes';
import { reconcileTemplate } from '../types/templateTypes';
import {
  DEFAULT_WORKFLOW_ICON_COLOR,
  resolveWorkflowIconTint,
} from '../constants/workflowIcons';
import { getWorkflow as fetchWorkflow, saveWorkflow } from '../utils/api';
import { getNodeImageOutputDataUrl, getNodeModel3dOutput } from '../utils/upstreamImage';
import { assetIsReachable, uploadDataUrlAsAsset } from '../utils/importImageData';
import { captureModel3dImage } from '../utils/model3dCapture';
import {
  collectPersistablePreviews,
  DEFAULT_PREVIEW_SLOT,
  PREVIEW_BEARING_FIELDS,
  uploadPreviewSlot,
  withoutPreviewAssetRefs,
} from '../utils/previewAssets';

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
 * Image-heavy fields (baked previews, run results) must never reach the saved
 * JSON: inlining base64 into the SQLite `workflows.data` column is what made
 * the 3s autosave `JSON.stringify` and tab switching slow. We drop every
 * `_`-prefixed key plus `previewData`. Real source data (e.g. `fileData`) is
 * intentionally kept, as are the `previewAsset*` ids — a few dozen bytes each,
 * pointing at the file store, which is how previews survive a reload without
 * their bytes ever entering the graph (see `utils/previewAssets.ts`).
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

/** The only `_`-prefixed fields a backend node handler actually reads. */
const RUN_PAYLOAD_KEPT_UNDERSCORE_FIELDS: ReadonlySet<string> = new Set([
  '_removeBgBaked',
  '_keyColorBaked',
  '_preview3dSnapshot',
]);

/**
 * Drop every other `_`-prefixed field before a node's data rides in the run
 * POST body. These are on-canvas preview bakes (`_cropPreview`, `_resizePreview`,
 * etc.) that exist purely for the live UI — the backend recomputes the real
 * output from the real params on every run, so shipping them just inflates
 * the request for nothing.
 */
function stripPreviewFieldsForRun(data: Record<string, any> | undefined): Record<string, any> {
  if (!data || typeof data !== 'object') return data ?? {};
  const out: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    if (key.startsWith('_') && !RUN_PAYLOAD_KEPT_UNDERSCORE_FIELDS.has(key)) continue;
    out[key] = data[key];
  }
  return out;
}

/**
 * Shapes one node for a run POST body. Editor layers are normalized, a 3D
 * preview rides along with a freshly captured snapshot (the backend has no 3D
 * renderer, so `execute_io_node` hands that back as the node's `image` output),
 * and on-canvas preview bakes are dropped. Payload-only: never written to `data`.
 */
function toRunNodePayload(node: Node) {
  let data = node.data as Record<string, any>;
  if (node.type === 'editor') {
    data = normalizeEditorDataForRun(data);
  } else if (node.type === 'preview3d' && !data?.bypassed) {
    const snapshot = captureModel3dImage(node.id);
    if (snapshot) data = { ...data, _preview3dSnapshot: snapshot };
  }
  data = stripPreviewFieldsForRun(data);
  return {
    id: node.id,
    type: node.type,
    data,
    position: node.position,
    ...(node.style ? { style: node.style } : {}),
    ...(node.width != null ? { width: node.width } : {}),
    ...(node.height != null ? { height: node.height } : {}),
  };
}

function toRunEdgePayload(edge: Edge) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  };
}

/**
 * A node's last known output for one port, in a form the backend can consume,
 * or null when nothing usable is cached. Image ports must resolve to real image
 * data — a saved preview only resolves to a URL the backend can't read — so a
 * node whose only image is a saved preview counts as uncached.
 */
function cachedNodeOutput(node: Node, handleId: string | null | undefined): any {
  const data = (node.data || {}) as Record<string, any>;
  const outputs = getNodeOutputs(node.type!, data);
  const port =
    outputs.find((p) => p.id === handleId) ?? (outputs.length === 1 ? outputs[0] : undefined);
  if (!port || port.type === 'image') {
    return getNodeImageOutputDataUrl(data, handleId, node.id, { includeSaved: false });
  }
  if (port.type === 'model3d') {
    return getNodeModel3dOutput(data);
  }
  const handleKey = handleId || 'image';
  return data._result?.[handleKey] ?? data.text ?? data.value ?? null;
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

/**
 * Preview persistence: after an image lands on a node, its bytes go to the file
 * store and the node keeps only an id (see `utils/previewAssets.ts`).
 *
 * Debounced per node so a slider drag or a burst of typing that re-bakes on
 * every frame pays for one upload rather than dozens, and deduped by source
 * string so a re-bake that reproduces the same image doesn't re-upload it.
 */
const PREVIEW_PERSIST_DEBOUNCE_MS = 1500;
const previewPersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const previewPersistLastSource = new Map<string, string>();

function resetPreviewPersistState() {
  for (const timer of previewPersistTimers.values()) clearTimeout(timer);
  previewPersistTimers.clear();
  previewPersistLastSource.clear();
}

function schedulePreviewPersist(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
  nodeId: string,
) {
  const pending = previewPersistTimers.get(nodeId);
  if (pending) clearTimeout(pending);
  previewPersistTimers.set(
    nodeId,
    setTimeout(() => {
      previewPersistTimers.delete(nodeId);
      void persistNodePreviews(get, set, nodeId);
    }, PREVIEW_PERSIST_DEBOUNCE_MS),
  );
}

async function persistNodePreviews(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
  nodeId: string,
): Promise<void> {
  const wfId = get().workflowId;
  if (!wfId) return;
  const node = get().nodes.find((n) => n.id === nodeId);
  if (!node) return;

  const uploaded: Record<string, string> = {};
  for (const [slot, dataUrl] of Object.entries(
    collectPersistablePreviews(node.data as Record<string, any>),
  )) {
    const cacheKey = `${wfId}::${nodeId}::${slot}`;
    if (previewPersistLastSource.get(cacheKey) === dataUrl) continue;
    const assetId = await uploadPreviewSlot(wfId, nodeId, slot, dataUrl);
    if (!assetId) continue;
    // The user may have switched workflows or deleted the node while the
    // upload was in flight.
    if (get().workflowId !== wfId) return;
    previewPersistLastSource.set(cacheKey, dataUrl);
    uploaded[slot] = assetId;
  }
  if (Object.keys(uploaded).length === 0) return;

  const current = get().nodes.find((n) => n.id === nodeId);
  if (!current) return;
  const currentData = current.data as Record<string, any>;
  const patch: Record<string, any> = { previewAssetRev: Date.now() };
  if (uploaded[DEFAULT_PREVIEW_SLOT]) {
    patch.previewAssetId = uploaded[DEFAULT_PREVIEW_SLOT];
  }
  const perHandle = Object.entries(uploaded).filter(([slot]) => slot !== DEFAULT_PREVIEW_SLOT);
  if (perHandle.length > 0) {
    const existing = currentData.previewAssetIds;
    patch.previewAssetIds = {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      ...Object.fromEntries(perHandle),
    };
  }

  // Written straight to state rather than through `updateNodeData`: this is
  // background bookkeeping, so it must not land on the undo stack or restart
  // the persist it was triggered by.
  set({
    nodes: get().nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
    ),
    _dirty: true,
  });
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
  selectedNodeId: string | null;
}): WorkflowSnapshot {
  return {
    nodes: s.nodes,
    edges: s.edges,
    groups: s.groups,
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

export interface WorkflowState {
  nodes: Node[];
  edges: Edge[];
  groups: NodeGroup[];
  selectedNodeId: string | null;
  isRunning: boolean;
  runResults: Record<string, any>;
  activeNodeId: string | null;
  completedNodeIds: string[];
  /** Group currently being run via its own Play button, if any. Transient — not undo/dirty tracked. */
  runningGroupId: string | null;
  /** Group whose Play button is hovered, for the gentle canvas highlight. Transient — not undo/dirty tracked. */
  hoveredRunGroupId: string | null;

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
  /** Drop every node/edge selection and the inspector target. */
  clearCanvasSelection: () => void;
  /** Select exactly this node; Shift+click multi-select is left to React Flow. */
  selectOnlyNode: (id: string) => void;
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
  /** Records one node's result mid-run so its error/skipped state shows live. */
  setNodeRunResult: (id: string, result: any) => void;
  setActiveNodeId: (id: string | null) => void;
  markNodeCompleted: (id: string) => void;
  clearRunProgress: () => void;
  setRunningGroupId: (id: string | null) => void;
  setHoveredRunGroupId: (id: string | null) => void;
  getWorkflowJSON: () => { nodes: any[]; edges: any[]; workflow_id?: string | null };
  getRunWorkflowPayload: () => { nodes: any[]; edges: any[]; workflow_id?: string | null };
  /**
   * Payload to run only a group's nodes. Every ancestor feeding the group is
   * resolved so the group never runs against an empty input: one with a usable
   * cached output is sent as a bare stub pre-seeded via `pre_outputs` and never
   * re-executes, while one without is pulled into the run and executed.
   */
  getGroupRunPayload: (groupId: string) => {
    nodes: any[];
    edges: any[];
    workflow_id?: string | null;
    pre_outputs: Record<string, Record<string, any>>;
  };
  duplicateSelectedNodes: () => void;
  /**
   * Alt+drag duplicate: leaves an unselected copy of the given nodes (and the edges between
   * them) behind at their current position. The originals are left untouched so an in-progress
   * drag keeps moving them.
   */
  duplicateNodesInPlace: (nodeIds: string[]) => void;
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
      data: withoutPreviewAssetRefs({ ...baseData }),
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

/**
 * Clones `nodeIds` (and the edges between them) at their current position, leaving the clones
 * unselected and the originals completely untouched. Used for Alt+drag duplicate, where the
 * originals keep dragging under the cursor while a stationary copy is left behind.
 *
 * Does not push its own undo snapshot — callers wrap the whole drag gesture in a single undo
 * entry via `beginMoveUndoSession`.
 */
function leaveDuplicateBehind(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
  nodeIds: string[],
): void {
  const idSet = new Set(nodeIds);
  const { nodes, edges } = get();
  const nodesToClone = nodes.filter((n) => idSet.has(n.id));
  if (nodesToClone.length === 0) return;

  const idMap = new Map<string, string>();
  const newNodes = nodesToClone.map((node) => {
    const newId = `node_${++nodeIdCounter}_${Date.now()}`;
    idMap.set(node.id, newId);
    const baseData =
      node.data && typeof node.data === 'object' ? (node.data as Record<string, any>) : {};
    return {
      ...node,
      id: newId,
      data: withoutPreviewAssetRefs({ ...baseData }),
      selected: false,
      dragging: false,
    };
  });

  // Duplicate every edge that *feeds into* a duplicated node — this covers both edges
  // internal to the duplicated set (both ends remapped) and incoming edges from an
  // external/unselected source (only the target end remapped), so the clone keeps the
  // same input wiring the original had. Outgoing edges to an external target are
  // intentionally not duplicated: a target handle only ever accepts one connection, and
  // that slot is already taken by the original's edge.
  const edgesToClone = edges.filter((e) => idSet.has(e.target));
  const newEdges = edgesToClone.map((e) => ({
    ...e,
    id: `edge_dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target)!,
    selected: false,
  }));

  set({
    nodes: [...nodes, ...newNodes],
    edges: [...edges, ...newEdges],
    _dirty: true,
  });
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  groups: [],
  selectedNodeId: null,
  isRunning: false,
  runResults: {},
  activeNodeId: null,
  completedNodeIds: [],
  runningGroupId: null,
  hoveredRunGroupId: null,

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
    const nextNodes = applyNodeChanges(changes, get().nodes);
    set({
      nodes: nextNodes,
      ...(selectionOnly ? {} : { _dirty: true }),
      ...(changes.some((c) => c.type === 'select')
        ? { selectedNodeId: nextNodes.find((n) => n.selected)?.id ?? null }
        : {}),
    });
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

  clearCanvasSelection: () => {
    const { nodes, edges, selectedNodeId } = get();
    const anyNode = nodes.some((n) => n.selected);
    const anyEdge = edges.some((e) => e.selected);
    if (!anyNode && !anyEdge && selectedNodeId == null) return;
    set({
      nodes: anyNode ? nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) : nodes,
      edges: anyEdge ? edges.map((e) => (e.selected ? { ...e, selected: false } : e)) : edges,
      selectedNodeId: null,
    });
  },

  selectOnlyNode: (id) => {
    const { nodes, edges, selectedNodeId } = get();
    const alreadyOnly =
      selectedNodeId === id &&
      nodes.every((n) => Boolean(n.selected) === (n.id === id)) &&
      edges.every((e) => !e.selected);
    if (alreadyOnly) return;
    set({
      nodes: nodes.map((n) => {
        const selected = n.id === id;
        return n.selected === selected ? n : { ...n, selected };
      }),
      edges: edges.some((e) => e.selected)
        ? edges.map((e) => (e.selected ? { ...e, selected: false } : e))
        : edges,
      selectedNodeId: id,
    });
  },

  openCropEditorModal: (nodeId) => set({ cropEditorModalNodeId: nodeId, selectedNodeId: nodeId }),

  closeCropEditorModal: () => set({ cropEditorModalNodeId: null }),

  openDividerEditorModal: (nodeId) => set({ dividerEditorModalNodeId: nodeId, selectedNodeId: nodeId }),

  closeDividerEditorModal: () => set({ dividerEditorModalNodeId: null }),

  addNode: (type, position, dataOverrides) => {
    const def = NODE_TYPE_DEFINITIONS[type];
    if (!def || def.legacy) return;
    pushUndoSnapshot(get, set);
    const id = `node_${++nodeIdCounter}_${Date.now()}`;
    const newNode: Node = {
      id,
      type,
      position,
      data: { ...def.defaults, label: def.label, bypassed: false, ...dataOverrides },
      selected: false,
      ...(isResizablePreviewNodeType(type)
        ? { width: DEFAULT_PREVIEW_NODE_WIDTH, height: DEFAULT_PREVIEW_NODE_HEIGHT }
        : {}),
    };
    set({ nodes: [...get().nodes, newNode], _dirty: true });
  },

  addNodeAndConnectFromHandle: (newNodeType, position, dataOverrides, wire) => {
    const def = NODE_TYPE_DEFINITIONS[newNodeType];
    if (!def || def.legacy) return;

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
      const sourceHandle = pickSourceOutputHandleId(newNodeType, targetPort.type, newData);
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
      ...(isResizablePreviewNodeType(newNodeType)
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
    const fields = Object.keys(data);
    const fieldKey = fields.slice().sort().join(',');
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
    if (fields.some((f) => PREVIEW_BEARING_FIELDS.has(f))) {
      schedulePreviewPersist(get, set, nodeId);
    }
  },

  lockPreviewNodeSize: (nodeId) => {
    const nodes = get().nodes;
    const target = nodes.find((n) => n.id === nodeId);
    if (!target || !isResizablePreviewNodeType(target.type)) return;
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
  setNodeRunResult: (id, result) =>
    set({ runResults: { ...get().runResults, [id]: result } }),
  setActiveNodeId: (id) => set({ activeNodeId: id }),
  markNodeCompleted: (id) => set({ completedNodeIds: [...get().completedNodeIds, id] }),
  clearRunProgress: () => set({ activeNodeId: null, completedNodeIds: [] }),
  setRunningGroupId: (id) => set({ runningGroupId: id }),
  setHoveredRunGroupId: (id) => set({ hoveredRunGroupId: id }),

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
    const { nodes, edges, workflowId } = get();
    return {
      nodes: nodes.map(toRunNodePayload),
      edges: edges.map(toRunEdgePayload),
      workflow_id: workflowId,
    };
  },

  getGroupRunPayload: (groupId) => {
    const { nodes, edges, workflowId, groups } = get();
    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      return { nodes: [], edges: [], workflow_id: workflowId, pre_outputs: {} };
    }

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const incomingByTarget = new Map<string, Edge[]>();
    for (const edge of edges) {
      const list = incomingByTarget.get(edge.target);
      if (list) list.push(edge);
      else incomingByTarget.set(edge.target, [edge]);
    }

    // Nodes the backend will actually execute, and nodes whose output is
    // already known and only needs to be handed over.
    const execIds = new Set(group.nodeIds.filter((id) => nodeById.has(id)));
    const preOutputs: Record<string, Record<string, any>> = {};

    // Walk the whole ancestry backwards so no input into the group is left
    // empty: an ancestor with a usable cached output is pre-seeded, and one
    // without is pulled into the run so it produces that output for real.
    const queue = [...execIds];
    const walked = new Set<string>();
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (walked.has(nodeId)) continue;
      walked.add(nodeId);

      for (const edge of incomingByTarget.get(nodeId) ?? []) {
        const source = nodeById.get(edge.source);
        if (!source) continue;
        if (execIds.has(source.id)) {
          queue.push(source.id);
          continue;
        }
        const handleKey = edge.sourceHandle || 'image';
        if (handleKey in (preOutputs[source.id] ?? {})) continue;

        const value = cachedNodeOutput(source, edge.sourceHandle);
        if (value != null && value !== '') {
          preOutputs[source.id] = { ...preOutputs[source.id], [handleKey]: value };
        } else {
          // Nothing cached to stand in for this port, so the ancestor has to
          // run. Any value already pre-seeded from it is dropped — executing
          // produces every port itself — and its own ancestors get walked next.
          delete preOutputs[source.id];
          execIds.add(source.id);
          queue.push(source.id);
        }
      }
    }

    const preSeededIds = Object.keys(preOutputs);
    const includedIds = new Set([...execIds, ...preSeededIds]);

    return {
      nodes: [
        ...[...execIds].map((id) => toRunNodePayload(nodeById.get(id)!)),
        // Pre-seeded ancestors ride along as bare stubs — the real value
        // travels in pre_outputs, so the backend never executes them.
        ...preSeededIds.map((id) => ({ id, type: nodeById.get(id)!.type, data: {} })),
      ],
      edges: edges
        .filter((e) => includedIds.has(e.source) && execIds.has(e.target))
        .map(toRunEdgePayload),
      workflow_id: workflowId,
      pre_outputs: preOutputs,
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

  duplicateNodesInPlace: (nodeIds) => {
    leaveDuplicateBehind(get, set, nodeIds);
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

    set({
      groups: nextGroups,
      _dirty: true,
    });
  },

  ungroupNodes: (groupId) => {
    const { groups } = get();
    pushUndoSnapshot(get, set);
    set({
      groups: groups.filter((g) => g.id !== groupId),
      _dirty: true,
    });
  },

  deleteGroupNodes: (groupId) => {
    const { nodes, edges, groups, selectedNodeId } = get();
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
      resetPreviewPersistState();
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
    resetPreviewPersistState();
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
