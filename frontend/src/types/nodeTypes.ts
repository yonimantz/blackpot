export type PortType = 'image' | 'number' | 'color' | 'string' | 'boolean' | 'any';

export interface PortDefinition {
  id: string;
  label: string;
  type: PortType;
}

export interface NodeCategory {
  label: string;
  color: string;
}

export const NODE_CATEGORIES: Record<string, NodeCategory> = {
  io: { label: 'I/O', color: '#3b82f6' },
  tool: { label: 'Tools', color: '#f59e0b' },
  text: { label: 'Text', color: '#14b8a6' },
  value: { label: 'Values', color: '#8b5cf6' },
  read: { label: 'Read Data', color: '#22c55e' },
  ai: { label: 'AI Models', color: '#ec4899' },
};

export interface NodeTypeDefinition {
  type: string;
  label: string;
  category: string;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  defaults: Record<string, any>;
}

/** Keep in sync with backend `tool_nodes.MAX_COMPOSITOR_LAYERS`. */
export const MAX_COMPOSITOR_LAYERS = 24;

/** Keep in sync with backend `tool_nodes.MAX_VIGNETTE_LAYERS`. */
export const MAX_VIGNETTE_LAYERS = 4;

/** Canvas nodes that show editable or scrollable text and support drag-resize (like Preview). */
export const TEXT_RESIZABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'prompt',
  'combinePrompts',
  'refMapper',
  'sketch2Final',
  'studio',
]);

export function isTextResizableNodeType(type: string): boolean {
  return TEXT_RESIZABLE_NODE_TYPES.has(type);
}

export const NODE_TYPE_DEFINITIONS: Record<string, NodeTypeDefinition> = {
  prompt: {
    type: 'prompt',
    label: 'Prompt',
    category: 'text',
    inputs: [],
    outputs: [{ id: 'text', label: 'Text', type: 'string' }],
    defaults: { value: '' },
  },
  combinePrompts: {
    type: 'combinePrompts',
    label: 'Combine Prompts',
    category: 'text',
    inputs: [
      { id: 'text1', label: 'Text 1', type: 'string' },
      { id: 'text2', label: 'Text 2', type: 'string' },
    ],
    outputs: [{ id: 'combined', label: 'Combined', type: 'string' }],
    defaults: { inputCount: 2, separator: '\n' },
  },
  refMapper: {
    type: 'refMapper',
    label: 'RefMapper',
    category: 'text',
    inputs: [],
    outputs: [{ id: 'text', label: 'Text', type: 'string' }],
    defaults: { refMapperEntries: [] },
  },
  sketch2Final: {
    type: 'sketch2Final',
    label: 'Sketch2Final',
    category: 'text',
    inputs: [{ id: 'prompt', label: 'Prompt', type: 'string' }],
    outputs: [{ id: 'text', label: 'Text', type: 'string' }],
    defaults: {
      value: '',
      sketchLevel: 'rough',
      coloredSketch: false,
    },
  },
  studio: {
    type: 'studio',
    label: 'Studio',
    category: 'text',
    inputs: [],
    outputs: [{ id: 'text', label: 'Text', type: 'string' }],
    defaults: {
      studioLens: 'standard',
      studioShot: 'mediumShot',
      studioView: 'eyeLevel',
      studioIncludeLens: true,
      studioIncludeShot: true,
      studioIncludeView: true,
    },
  },
  importImage: {
    type: 'importImage',
    label: 'Import Image',
    category: 'io',
    inputs: [],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { filePath: '', fileData: '' },
  },
  exportImage: {
    type: 'exportImage',
    label: 'Export Image',
    category: 'io',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [],
    defaults: { fileName: 'output', format: 'png', exportPath: '' },
  },
  preview: {
    type: 'preview',
    label: 'Preview',
    category: 'io',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [],
    defaults: { previewData: '' },
  },
  resize: {
    type: 'resize',
    label: 'Resize',
    category: 'tool',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'width', label: 'Width', type: 'number' },
      { id: 'height', label: 'Height', type: 'number' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { width: 512, height: 512, keepAspect: true },
  },
  crop: {
    type: 'crop',
    label: 'Crop',
    category: 'tool',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'x', label: 'X', type: 'number' },
      { id: 'y', label: 'Y', type: 'number' },
      { id: 'width', label: 'Width', type: 'number' },
      { id: 'height', label: 'Height', type: 'number' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { x: 0, y: 0, width: 256, height: 256 },
  },
  setAlpha: {
    type: 'setAlpha',
    label: 'Set Alpha',
    category: 'tool',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'alpha', label: 'Alpha', type: 'number' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { alpha: 1.0 },
  },
  blur: {
    type: 'blur',
    label: 'Blur',
    category: 'tool',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'radius', label: 'Radius', type: 'number' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { radius: 2 },
  },
  rotate: {
    type: 'rotate',
    label: 'Rotate / Flip',
    category: 'tool',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'angle', label: 'Angle', type: 'number' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { angle: 0, flipH: false, flipV: false },
  },
  numberValue: {
    type: 'numberValue',
    label: 'Number',
    category: 'value',
    inputs: [],
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    defaults: { value: 0 },
  },
  colorValue: {
    type: 'colorValue',
    label: 'Color Picker',
    category: 'value',
    inputs: [],
    outputs: [{ id: 'value', label: 'Color', type: 'color' }],
    defaults: { value: '#ffffff' },
  },
  getImageSize: {
    type: 'getImageSize',
    label: 'Get Image Size',
    category: 'read',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [
      { id: 'width', label: 'Width', type: 'number' },
      { id: 'height', label: 'Height', type: 'number' },
    ],
    defaults: {},
  },
  getColorPalette: {
    type: 'getColorPalette',
    label: 'Get Color Palette',
    category: 'read',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [
      { id: 'image', label: 'Swatch', type: 'image' },
      { id: 'colors', label: 'Colors', type: 'string' },
    ],
    defaults: { count: 5 },
  },
  nanoBananaPro: {
    type: 'nanoBananaPro',
    label: 'Nano Banana Pro',
    category: 'ai',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'string' },
      { id: 'referenceImage1', label: 'Image 1', type: 'image' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: {
      apiKey: '',
      prompt: '',
      aspectRatio: '1:1',
      resolution: '1k',
      outputMimeType: 'image/png',
      seed: 0,
      refImageCount: 1,
    },
  },
  editor: {
    type: 'editor',
    label: 'Editor',
    category: 'tool',
    inputs: [
      { id: 'bgLayer', label: 'BG Layer', type: 'image' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { layerCount: 0, layers: {} },
  },
  compositor: {
    type: 'compositor',
    label: 'Compositor',
    category: 'tool',
    inputs: [{ id: 'background', label: 'Background', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { width: 512, height: 512, layers: [] },
  },
  vignette: {
    type: 'vignette',
    label: 'Vignette',
    category: 'tool',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: {
      vignetteLayers: [
        {
          id: 'vig-default',
          shape: 'circle',
          color: '#000000',
          opacity: 0.5,
          blendMode: 'normal',
          size: 0.5,
          feather: 0.5,
        },
      ],
    },
  },
  nanoBanana2: {
    type: 'nanoBanana2',
    label: 'Nano Banana 2',
    category: 'ai',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'string' },
      { id: 'referenceImage1', label: 'Image 1', type: 'image' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: {
      apiKey: '',
      prompt: '',
      aspectRatio: '1:1',
      resolution: '1k',
      outputMimeType: 'image/png',
      seed: 0,
      refImageCount: 1,
      thinkingMode: 'off',
    },
  },
  imageScfPrompt: {
    type: 'imageScfPrompt',
    label: 'Image SCF Prompt',
    category: 'ai',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'text', label: 'Text', type: 'string' }],
    defaults: {
      apiKey: '',
      analyzeStyle: true,
      analyzeContent: true,
      analyzeFeel: true,
    },
  },
  gptImage2: {
    type: 'gptImage2',
    label: 'GPT Image 2',
    category: 'ai',
    inputs: [{ id: 'prompt', label: 'Prompt', type: 'string' }],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: {
      apiKey: '',
      prompt: '',
      imageSize: 'auto',
      quality: 'auto',
      outputFormat: 'png',
      outputCompression: 80,
      moderation: 'auto',
      refImageCount: 1,
    },
  },
};

/** OpenAI image edits — multiple reference files; capped for stability. */
export const GPT_IMAGE_2_MAX_REFERENCE_IMAGES = 8;

export const PORT_TYPE_COLORS: Record<PortType, string> = {
  image: '#60a5fa',
  number: '#818cf8',
  color: '#fb7185',
  string: '#4ade80',
  boolean: '#facc15',
  any: '#a1a1aa',
};

export function getNodeInputs(type: string, data?: Record<string, any>): PortDefinition[] {
  const def = NODE_TYPE_DEFINITIONS[type];
  if (!def) return [];

  if (type === 'combinePrompts') {
    const count = (data?.inputCount as number) || 2;
    return Array.from({ length: count }, (_, i) => ({
      id: `text${i + 1}`,
      label: `Text ${i + 1}`,
      type: 'string' as PortType,
    }));
  }

  if (type === 'editor') {
    const layerCount = (data?.layerCount as number) || 0;
    return [
      { id: 'bgLayer', label: 'BG Layer', type: 'image' as PortType },
      ...Array.from({ length: layerCount }, (_, i) => ({
        id: `layer${i + 1}`,
        label: `Layer ${i + 1}`,
        type: 'image' as PortType,
      })),
    ];
  }

  if (type === 'nanoBananaPro' || type === 'nanoBanana2' || type === 'gptImage2') {
    const count = (data?.refImageCount as number) || 1;
    return [
      { id: 'prompt', label: 'Prompt', type: 'string' as PortType },
      ...Array.from({ length: count }, (_, i) => ({
        id: `referenceImage${i + 1}`,
        label: `Image ${i + 1}`,
        type: 'image' as PortType,
      })),
    ];
  }

  return def.inputs;
}

export function canConnect(sourceType: PortType, targetType: PortType): boolean {
  if (sourceType === 'any' || targetType === 'any') return true;
  return sourceType === targetType;
}

/** Node types that can be placed when dragging a wire from an output (`source`) or into an input (`target`). */
export function getNodeTypesConnectableFromWireOrigin(
  handleType: 'source' | 'target',
  portType: PortType,
): Set<string> {
  const result = new Set<string>();
  for (const def of Object.values(NODE_TYPE_DEFINITIONS)) {
    if (handleType === 'source') {
      const inputs = getNodeInputs(def.type, def.defaults);
      if (inputs.some((inp) => canConnect(portType, inp.type))) {
        result.add(def.type);
      }
    } else {
      if (def.outputs.some((out) => canConnect(out.type, portType))) {
        result.add(def.type);
      }
    }
  }
  return result;
}

/** First input on the new node that accepts an edge from a source port of `sourcePortType` (definition order). */
export function pickTargetInputHandleId(
  newNodeType: string,
  newNodeData: Record<string, any>,
  sourcePortType: PortType,
): string | null {
  const inputs = getNodeInputs(newNodeType, newNodeData);
  const p = inputs.find((inp) => canConnect(sourcePortType, inp.type));
  return p?.id ?? null;
}

/** First output on the new node that can feed a target input of `targetPortType` (definition order). */
export function pickSourceOutputHandleId(
  newNodeType: string,
  targetPortType: PortType,
): string | null {
  const def = NODE_TYPE_DEFINITIONS[newNodeType];
  if (!def) return null;
  const p = def.outputs.find((out) => canConnect(out.type, targetPortType));
  return p?.id ?? null;
}

