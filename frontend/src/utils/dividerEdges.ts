import type { Edge } from '@xyflow/react';

export type DividerSelection =
  | { id: string; kind: 'box'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'lasso'; points: Array<[number, number]> };

/**
 * Remap edges from a Divider node's `out1..outN` handles when selection order
 * or count changes. Handles are keyed by 1-based index into `prevSelections`;
 * each edge is reassigned to `out{j}` where `j` is the 1-based index of the
 * same selection id in `nextSelections`. Drops edges whose selection was removed.
 */
export function remapDividerSourceEdges(
  nodeId: string,
  prevSelections: DividerSelection[],
  nextSelections: DividerSelection[],
  edges: Edge[],
): Edge[] {
  const nextIndexById = new Map(nextSelections.map((s, i) => [s.id, i + 1]));
  return edges.flatMap((edge) => {
    if (edge.source !== nodeId) return [edge];
    const m = /^out(\d+)$/.exec(String(edge.sourceHandle || ''));
    if (!m) return [edge];
    const oldIdx = Number(m[1]);
    const oldSel = prevSelections[oldIdx - 1];
    if (!oldSel) return [];
    const newIdx = nextIndexById.get(oldSel.id);
    if (newIdx == null) return [];
    const nh = `out${newIdx}`;
    if (nh !== edge.sourceHandle) return [{ ...edge, sourceHandle: nh }];
    return [edge];
  });
}
