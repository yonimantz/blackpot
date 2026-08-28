import { useState } from 'react';
import {
  NODE_CATEGORIES,
  NODE_TYPE_DEFINITIONS,
  PLACEABLE_NODE_DEFINITIONS,
} from '../types/nodeTypes';
import { useWorkflowStore } from '../store/workflowStore';
import Icon from '../icons/Icon';
import { paletteCategoryIcon } from '../constants/paletteCategoryIcons';

export default function NodePalette() {
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    general: true,
    io: true,
    tool: true,
    text: true,
    value: true,
    read: true,
    ai: true,
  });

  const grouped = PLACEABLE_NODE_DEFINITIONS.reduce(
    (acc, def) => {
      if (!acc[def.category]) acc[def.category] = [];
      acc[def.category].push(def);
      return acc;
    },
    {} as Record<string, typeof NODE_TYPE_DEFINITIONS[string][]>
  );

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    if (isRunning) { event.preventDefault(); return; }
    event.dataTransfer.setData('application/reactflow-type', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className={`node-palette ${isRunning ? 'palette-locked' : ''}`}>
      <div className="palette-header">Nodes</div>
      {Object.entries(grouped).map(([category, defs]) => {
        const cat = NODE_CATEGORIES[category];
        const categoryIcon = paletteCategoryIcon(category);
        return (
          <div key={category} className="palette-category">
            <div
              className="category-header"
              onClick={() =>
                setExpanded((e) => ({ ...e, [category]: !e[category] }))
              }
            >
              {categoryIcon ? (
                <Icon
                  name={categoryIcon}
                  size={14}
                  className="category-icon"
                  style={{ color: cat?.color }}
                />
              ) : (
                <span
                  className="category-dot"
                  style={{ background: cat?.color }}
                />
              )}
              <span className="category-label">{cat?.label || category}</span>
              <span className="category-arrow">
                <Icon name={expanded[category] ? 'down-small-line' : 'right-small-line'} size={12} />
              </span>
            </div>
            {expanded[category] && (
              <div className="category-items">
                {defs.map((def) => (
                  <div
                    key={def.type}
                    className="palette-item"
                    draggable
                    onDragStart={(e) => onDragStart(e, def.type)}
                    style={{ borderLeftColor: cat?.color }}
                  >
                    <span>{def.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
