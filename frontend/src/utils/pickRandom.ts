import { useWorkflowStore } from '../store/workflowStore';
import {
  MAX_PICK_RANDOM_INPUTS,
  canConnect,
  getNodeInputs,
  getNodeOutputs,
  pickRandomPortType,
  type PickRandomValueType,
} from '../types/nodeTypes';

/**
 * Switch a Pick Random node's value type, instantly retyping every `inN`
 * input and the `out` output. Any edge whose other end no longer matches the
 * new port type is dropped, mirroring how the FAL AI model dropdown prunes
 * stale reference-image edges.
 */
export function setPickRandomValueType(nodeId: string, next: PickRandomValueType) {
  const { nodes, edges, updateNodeData, removeEdgesByIds } = useWorkflowStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;

  const nextPortType = pickRandomPortType(next);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edgesToRemove = edges
    .filter((e) => {
      if (e.target === nodeId && typeof e.targetHandle === 'string' && e.targetHandle.startsWith('in')) {
        const sourceNode = nodeById.get(e.source);
        if (!sourceNode?.type) return true;
        const sourcePort = getNodeOutputs(sourceNode.type, sourceNode.data as Record<string, any>).find(
          (p) => p.id === e.sourceHandle,
        );
        return !sourcePort || !canConnect(sourcePort.type, nextPortType);
      }
      if (e.source === nodeId && e.sourceHandle === 'out') {
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

/** Add another `inN` input handle, up to `MAX_PICK_RANDOM_INPUTS`. */
export function addPickRandomInput(nodeId: string) {
  const { nodes, updateNodeData } = useWorkflowStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const count = (node.data?.inputCount as number) || 2;
  if (count >= MAX_PICK_RANDOM_INPUTS) return;
  updateNodeData(nodeId, { inputCount: count + 1 });
}

/** Remove the last `inN` input handle (never below 2), dropping its edge if wired. */
export function removePickRandomInput(nodeId: string) {
  const { nodes, edges, updateNodeData, removeEdgesByIds } = useWorkflowStore.getState();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const count = (node.data?.inputCount as number) || 2;
  if (count <= 2) return;
  const handleToRemove = `in${count}`;
  const edgesToRemove = edges
    .filter((e) => e.target === nodeId && e.targetHandle === handleToRemove)
    .map((e) => e.id);
  if (edgesToRemove.length > 0) {
    removeEdgesByIds(edgesToRemove);
  }
  updateNodeData(nodeId, { inputCount: count - 1 });
}
