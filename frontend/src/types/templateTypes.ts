import {
  isNodeTypePinnable,
  isTemplateOutputNodeType,
  NODE_TYPE_DEFINITIONS,
} from './nodeTypes';

export const WORKFLOW_TEMPLATE_VERSION = 1;

/** One pinned input node, as presented in the template form. */
export interface WorkflowTemplateItem {
  nodeId: string;
  /** Author-friendly name shown instead of the node's own label. */
  label?: string;
  /** Short helper copy shown under the label. */
  description?: string;
}

/** One pinned output node, whose image lands in the result panel. */
export interface WorkflowTemplateOutput {
  nodeId: string;
  label?: string;
}

/**
 * A published, simplified face for a workflow. Stored inside the workflow's
 * own `data` blob, so it is versioned, saved, and deleted alongside it.
 *
 * The set of pinned nodes lives on the nodes themselves (`data.pinned`); this
 * object only carries the presentation layer — order and author copy.
 */
export interface WorkflowTemplate {
  version: number;
  items: WorkflowTemplateItem[];
  outputs: WorkflowTemplateOutput[];
  updatedAt: string;
}

/** Minimal node shape the template helpers need. */
export interface TemplateNodeLike {
  id: string;
  type?: string;
  data?: Record<string, any>;
}

export interface TemplateEdgeLike {
  source: string;
  target: string;
  targetHandle?: string | null;
}

export function isNodePinned(node: TemplateNodeLike): boolean {
  return Boolean(node.data?.pinned) && isNodeTypePinnable(node.type);
}

/** Pinned nodes that become form fields. */
export function pinnedInputNodes(nodes: TemplateNodeLike[]): TemplateNodeLike[] {
  return nodes.filter((n) => isNodePinned(n) && !isTemplateOutputNodeType(n.type));
}

/** Pinned nodes that become results. */
export function pinnedOutputNodes(nodes: TemplateNodeLike[]): TemplateNodeLike[] {
  return nodes.filter((n) => isNodePinned(n) && isTemplateOutputNodeType(n.type));
}

export function emptyTemplate(): WorkflowTemplate {
  return {
    version: WORKFLOW_TEMPLATE_VERSION,
    items: [],
    outputs: [],
    updatedAt: new Date().toISOString(),
  };
}

/** Display name for a pinned node: author override, then node label, then type label. */
export function templateEntryLabel(
  node: TemplateNodeLike | undefined,
  override?: string,
): string {
  const trimmed = (override || '').trim();
  if (trimmed) return trimmed;
  const nodeLabel = typeof node?.data?.label === 'string' ? node.data.label.trim() : '';
  if (nodeLabel) return nodeLabel;
  return (node?.type && NODE_TYPE_DEFINITIONS[node.type]?.label) || 'Node';
}

/**
 * Bring a stored template back in line with the current graph: drop entries for
 * nodes that were deleted or unpinned, and append nodes that were pinned since
 * the template was last saved. Author-set order and copy are preserved.
 */
export function reconcileTemplate(
  template: WorkflowTemplate | null | undefined,
  nodes: TemplateNodeLike[],
): WorkflowTemplate {
  const base = template ?? emptyTemplate();

  const reconcileList = <T extends { nodeId: string }>(
    stored: T[],
    live: TemplateNodeLike[],
    make: (nodeId: string) => T,
  ): T[] => {
    const liveIds = new Set(live.map((n) => n.id));
    const kept = stored.filter((entry) => liveIds.has(entry.nodeId));
    const seen = new Set(kept.map((entry) => entry.nodeId));
    const added = live.filter((n) => !seen.has(n.id)).map((n) => make(n.id));
    return [...kept, ...added];
  };

  return {
    version: WORKFLOW_TEMPLATE_VERSION,
    items: reconcileList(base.items ?? [], pinnedInputNodes(nodes), (nodeId) => ({ nodeId })),
    outputs: reconcileList(base.outputs ?? [], pinnedOutputNodes(nodes), (nodeId) => ({ nodeId })),
    updatedAt: base.updatedAt,
  };
}

/**
 * A sensible default set of pins for a graph that has never been templated:
 * every pinnable node that nothing feeds into (those are the graph's real
 * inputs) plus every Preview node (those are its results).
 */
export function suggestPinnedNodeIds(
  nodes: TemplateNodeLike[],
  edges: TemplateEdgeLike[],
): string[] {
  const hasIncoming = new Set(edges.map((e) => e.target));
  return nodes
    .filter((n) => {
      if (!isNodeTypePinnable(n.type)) return false;
      if (isTemplateOutputNodeType(n.type)) return n.type === 'preview';
      return !hasIncoming.has(n.id);
    })
    .map((n) => n.id);
}

/**
 * Input handle ids on a node that are already driven by an edge. The template
 * form hides the matching fields so a user is never asked for a value the
 * graph supplies.
 */
export function wiredInputHandles(nodeId: string, edges: TemplateEdgeLike[]): Set<string> {
  const wired = new Set<string>();
  for (const e of edges) {
    if (e.target !== nodeId) continue;
    if (e.targetHandle) wired.add(e.targetHandle);
  }
  return wired;
}
