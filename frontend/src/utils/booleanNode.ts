import { useWorkflowStore } from '../store/workflowStore';
import {
  canConnect,
  getNodeInputs,
  getNodeOutputs,
  booleanPortType,
  type BooleanValueType,
} from '../types/nodeTypes';

/**
 * Switch a Boolean node's value type, instantly retyping the `a`/`b` inputs
 * and the `value` output. Any edge whose other end no longer matches the new
 * port type is dropped, mirroring how the Pick Random dropdown (and the FAL
 * AI model dropdown before it) prunes stale edges.
 */
export function setBooleanValueType(nodeId: string, next: BooleanValueType) {
  const { nodes, edges, updateNodeData, removeEdgesByIds } = useWorkflowStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;

  const nextPortType = booleanPortType(next);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edgesToRemove = edges
    .filter((e) => {
      if (e.target === nodeId && (e.targetHandle === 'a' || e.targetHandle === 'b')) {
        const sourceNode = nodeById.get(e.source);
        if (!sourceNode?.type) return true;
        const sourcePort = getNodeOutputs(sourceNode.type, sourceNode.data as Record<string, any>).find(
          (p) => p.id === e.sourceHandle,
        );
        return !sourcePort || !canConnect(sourcePort.type, nextPortType);
      }
      if (e.source === nodeId && e.sourceHandle === 'value') {
        const targetNode = nodeById.get(e.target);
        if (!targetNode?.type) return true;
        const targetPort = getNodeInputs(targetNode.type, targetNode.data as Record<string, any>).find(
          (p) => p.id === e.targetHandle,
        );
        return !targetPort || !canConnect(nextPortType, targetPort.type);
      }
      return false;
    })
    .map((e) => e.id);

  if (edgesToRemove.length > 0) {
    removeEdgesByIds(edgesToRemove);
  }
  updateNodeData(nodeId, { valueType: next, _result: undefined });
}
