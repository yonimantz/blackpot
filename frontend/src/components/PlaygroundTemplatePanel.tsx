import { useWorkflowStore } from '../store/workflowStore';
import { templateEntryLabel } from '../types/templateTypes';
import TemplateFieldRenderer from './TemplateFieldRenderer';

export default function PlaygroundTemplatePanel({ disabled }: { disabled?: boolean }) {
  const template = useWorkflowStore((s) => s.template);
  const nodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const isRunning = useWorkflowStore((s) => s.isRunning);

  const fieldDisabled = Boolean(disabled || isRunning);

  const nodeById = (id: string) => nodes.find((n) => n.id === id);
  const items = template?.items ?? [];

  if (!template) {
    return (
      <div className="playground-template-panel">
        <p className="playground-template-empty">No template loaded.</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="playground-template-panel">
        <p className="playground-template-empty">This template has no input fields.</p>
      </div>
    );
  }

  return (
    <div className="playground-template-panel">
      {items.map((item) => {
        const node = nodeById(item.nodeId);
        if (!node?.type) return null;
        const heading = templateEntryLabel(node, item.label);
        const desc = item.description?.trim();
        const nodeData = (node.data ?? {}) as Record<string, any>;

        return (
          <section className="inspector-section playground-template-field" key={item.nodeId}>
            <div className="playground-template-field-heading">{heading}</div>
            {desc ? <p className="playground-template-field-desc">{desc}</p> : null}
            <div className={fieldDisabled ? 'playground-template-field-body playground-template-field-body--disabled' : 'playground-template-field-body'}>
              <TemplateFieldRenderer
                nodeId={item.nodeId}
                type={node.type}
                data={nodeData}
                updateNodeData={fieldDisabled ? () => {} : updateNodeData}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
