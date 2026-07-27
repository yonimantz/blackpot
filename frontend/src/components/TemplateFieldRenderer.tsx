import { NodePropertyEditor } from './InspectorPanel';

export default function TemplateFieldRenderer({
  nodeId,
  type,
  data,
  updateNodeData,
}: {
  nodeId: string;
  type: string;
  data: Record<string, any>;
  updateNodeData: (id: string, data: Record<string, any>) => void;
}) {
  return (
    <NodePropertyEditor
      nodeId={nodeId}
      type={type}
      data={data}
      updateNodeData={updateNodeData}
    />
  );
}
