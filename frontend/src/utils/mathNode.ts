import type { Edge, Node } from '@xyflow/react';

export type MathOperationId = 'add' | 'subtract' | 'multiply' | 'divide';

export interface MathOperationDef {
  id: MathOperationId;
  label: string;
}

export const MATH_OPERATIONS: MathOperationDef[] = [
  { id: 'add', label: 'Add' },
  { id: 'subtract', label: 'Subtract' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'divide', label: 'Divide' },
];

export interface MathOperationResult {
  value: number | null;
  error: string | null;
}

/** Pure add/subtract/multiply/divide. Divide by zero is reported as an error
 * rather than returning Infinity/NaN, matching how other nodes fail loudly. */
export function applyMathOperation(a: number, b: number, operation: string): MathOperationResult {
  switch (operation as MathOperationId) {
    case 'subtract':
      return { value: a - b, error: null };
    case 'multiply':
      return { value: a * b, error: null };
    case 'divide':
      if (b === 0) return { value: null, error: 'Cannot divide by zero' };
      return { value: a / b, error: null };
    case 'add':
    default:
      return { value: a + b, error: null };
  }
}

/** Resolve a live numeric output for a node's given output handle, following
 * upstream Math/Number nodes so the on-canvas preview stays in sync without
 * requiring a run. Modeled on `resolveUpstreamTextOutput`. */
export function resolveUpstreamNumberOutput(
  nodeId: string,
  handleId: string | null | undefined,
  edges: Edge[],
  nodes: Node[],
  visited: Set<string> = new Set(),
): number | null {
  if (visited.has(nodeId)) return null;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const d = (node.data || {}) as Record<string, any>;

  if (node.type === 'math') {
    visited.add(nodeId);
    const state = resolveMathState(nodeId, edges, nodes, visited);
    visited.delete(nodeId);
    return state.result;
  }

  if (node.type === 'numberValue') {
    const v = Number(d.value);
    return Number.isFinite(v) ? v : null;
  }

  visited.add(nodeId);
  const fromResult = handleId ? d._result?.[handleId] : undefined;
  const raw = fromResult ?? d.value;
  visited.delete(nodeId);
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

export interface MathOperandState {
  value: number;
  linked: boolean;
}

export interface MathNodeState {
  operation: MathOperationId;
  a: MathOperandState;
  b: MathOperandState;
  result: number | null;
  error: string | null;
}

/** Full resolved state for a Math node: operand values (inline or linked),
 * the selected operation, and the computed live result/error. Shared by the
 * node body and the inspector so they never disagree. */
export function resolveMathState(
  nodeId: string,
  edges: Edge[],
  nodes: Node[],
  visited: Set<string> = new Set(),
): MathNodeState {
  const node = nodes.find((n) => n.id === nodeId);
  const d = (node?.data || {}) as Record<string, any>;
  const operation: MathOperationId = (d.operation as MathOperationId) || 'add';

  const resolveOperand = (portId: 'a' | 'b'): MathOperandState => {
    const edge = edges.find((e) => e.target === nodeId && e.targetHandle === portId);
    if (edge) {
      const linkedValue = resolveUpstreamNumberOutput(
        edge.source,
        edge.sourceHandle,
        edges,
        nodes,
        visited,
      );
      return { value: linkedValue ?? 0, linked: true };
    }
    const raw = Number(d[portId]);
    return { value: Number.isFinite(raw) ? raw : 0, linked: false };
  };

  const a = resolveOperand('a');
  const b = resolveOperand('b');
  const { value, error } = applyMathOperation(a.value, b.value, operation);

  return { operation, a, b, result: value, error };
}
