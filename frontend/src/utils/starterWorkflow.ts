import {
  DEFAULT_PREVIEW_NODE_HEIGHT,
  DEFAULT_PREVIEW_NODE_WIDTH,
  NODE_TYPE_DEFINITIONS,
  PORT_TYPE_COLORS,
} from '../types/nodeTypes';

function nodeData(type: string, overrides?: Record<string, unknown>) {
  const def = NODE_TYPE_DEFINITIONS[type];
  return { ...def.defaults, label: def.label, bypassed: false, ...overrides };
}

export function buildStarterWorkflowData() {
  const promptId = crypto.randomUUID();
  const falId = crypto.randomUUID();
  const previewId = crypto.randomUUID();

  return {
    nodes: [
      {
        id: promptId,
        type: 'prompt',
        position: { x: 0, y: 0 },
        data: nodeData('prompt'),
      },
      {
        id: falId,
        type: 'falAi',
        position: { x: 340, y: 0 },
        data: nodeData('falAi', { model: 'nano_banana_pro', aspectRatio: '1:1' }),
      },
      {
        id: previewId,
        type: 'preview',
        position: { x: 700, y: 0 },
        data: nodeData('preview'),
        width: DEFAULT_PREVIEW_NODE_WIDTH,
        height: DEFAULT_PREVIEW_NODE_HEIGHT,
      },
    ],
    edges: [
      {
        id: crypto.randomUUID(),
        source: promptId,
        target: falId,
        sourceHandle: 'text',
        targetHandle: 'prompt',
        style: { stroke: PORT_TYPE_COLORS.string, strokeWidth: 2 },
      },
      {
        id: crypto.randomUUID(),
        source: falId,
        target: previewId,
        sourceHandle: 'image',
        targetHandle: 'image',
        style: { stroke: PORT_TYPE_COLORS.image, strokeWidth: 2 },
      },
    ],
    groups: [],
  };
}
