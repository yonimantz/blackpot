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
  general: { label: 'General', color: '#9ca3af' },
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

/** Keep in sync with backend `tool_nodes.MAX_STACK_IMAGES`. */
export const MAX_STACK_IMAGES = 12;

/** Max number of image inputs on an Export Image node. */
export const MAX_EXPORT_IMAGES = 24;

/** Keep in sync with backend `tool_nodes.MAX_DIVIDER_OUTPUTS`. */
export const MAX_DIVIDER_OUTPUTS = 16;

/**
 * Default canvas size for a fresh Preview node. Locked at creation so
 * incoming run results don't make the node grow/shrink to fit the image —
 * the user can resize it manually with the NodeResizer if desired.
 */
export const DEFAULT_PREVIEW_NODE_WIDTH = 240;
export const DEFAULT_PREVIEW_NODE_HEIGHT = 220;

/** Canvas nodes that show editable or scrollable text and support drag-resize (like Preview). */
export const TEXT_RESIZABLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'prompt',
  'combinePrompts',
  'refMapper',
  'sketch2Final',
  'studio',
  'note',
]);

export function isTextResizableNodeType(type: string): boolean {
  return TEXT_RESIZABLE_NODE_TYPES.has(type);
}

/**
 * Categories whose nodes may be pinned into a workflow template. Tools and
 * Read Data are deliberately excluded: they are plumbing, not something a
 * template user should be asked about.
 */
export const PINNABLE_NODE_CATEGORIES: ReadonlySet<string> = new Set([
  'general',
  'io',
  'text',
  'value',
  'ai',
]);

/**
 * Pinned nodes of these types feed the template's result panel instead of
 * appearing as a form field.
 */
export const TEMPLATE_OUTPUT_NODE_TYPES: ReadonlySet<string> = new Set([
  'preview',
  'exportImage',
]);

export function isNodeTypePinnable(type: string | undefined): boolean {
  if (!type) return false;
  const def = NODE_TYPE_DEFINITIONS[type];
  return !!def && PINNABLE_NODE_CATEGORIES.has(def.category);
}

export function isTemplateOutputNodeType(type: string | undefined): boolean {
  return !!type && TEMPLATE_OUTPUT_NODE_TYPES.has(type);
}

export const NODE_TYPE_DEFINITIONS: Record<string, NodeTypeDefinition> = {
  note: {
    type: 'note',
    label: 'Note',
    category: 'general',
    inputs: [],
    outputs: [],
    defaults: { value: '' },
  },
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
    inputs: [{ id: 'image1', label: 'Image 1', type: 'image' }],
    outputs: [],
    defaults: {
      exportPath: '',
      imageCount: 1,
      exportItems: [{ fileName: 'output', format: 'png' }],
    },
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
    defaults: { width: 512, height: 512, aspectLocked: true },
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
  getChannel: {
    type: 'getChannel',
    label: 'Get Channel',
    category: 'read',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [
      { id: 'alpha', label: 'Alpha', type: 'image' },
      { id: 'red', label: 'Red', type: 'image' },
      { id: 'green', label: 'Green', type: 'image' },
      { id: 'blue', label: 'Blue', type: 'image' },
    ],
    defaults: {},
  },
  setMask: {
    type: 'setMask',
    label: 'Set Mask',
    category: 'tool',
    inputs: [
      { id: 'image', label: 'Image', type: 'image' },
      { id: 'mask', label: 'Mask', type: 'image' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { invert: false },
  },
  keyColor: {
    type: 'keyColor',
    label: 'Key Color',
    category: 'tool',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image (RGBA)', type: 'image' }],
    defaults: {
      keyColor: '#00ff00',
      threshold: 0.3,
      softness: 0.15,
      manualMaskData: '',
      _keyColorBaked: '',
    },
  },
  removeBg: {
    type: 'removeBg',
    label: 'Remove Background',
    category: 'tool',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image (RGBA)', type: 'image' }],
    defaults: {
      model: 'isnet-general-use',
      alphaMatting: false,
      fgThreshold: 240,
      bgThreshold: 10,
      erodeSize: 10,
      threshold: 0,
      feather: 0,
      erode: 0,
      dilate: 0,
      invert: false,
      bgFill: 'transparent',
      _removeBgBaked: '',
    },
  },
  simpleCombine: {
    type: 'simpleCombine',
    label: 'Simple Combine',
    category: 'tool',
    inputs: [
      { id: 'image1', label: 'Image 1 (overlay)', type: 'image' },
      { id: 'image2', label: 'Image 2 (base)', type: 'image' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: { opacity: 1.0 },
  },
  stackImages: {
    type: 'stackImages',
    label: 'Stack Images',
    category: 'tool',
    inputs: [
      { id: 'image1', label: 'Image 1', type: 'image' },
      { id: 'image2', label: 'Image 2', type: 'image' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: {
      direction: 'horizontal',
      stretch: false,
      imageCount: 2,
    },
  },
  divider: {
    type: 'divider',
    label: 'Divider',
    category: 'tool',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: Array.from({ length: MAX_DIVIDER_OUTPUTS }, (_, i) => ({
      id: `out${i + 1}`,
      label: `Out ${i + 1}`,
      type: 'image' as PortType,
    })),
    defaults: { selections: [], _dividerOutputs: {} },
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
    defaults: { layerCount: 0, layers: {}, bgHidden: false },
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
      // Optional overrides for OpenAI-compatible gateways (e.g. Playtika ML
      // Model Gateway). Leave blank to use OPENAI_BASE_URL / OPENAI_IMAGE_MODEL
      // from backend env, or fall back to api.openai.com + 'gpt-image-2'.
      baseUrl: '',
      modelName: '',
      prompt: '',
      imageSize: 'auto',
      quality: 'auto',
      outputFormat: 'png',
      outputCompression: 80,
      moderation: 'auto',
      refImageCount: 1,
    },
  },
  falAi: {
    type: 'falAi',
    label: 'FAL AI',
    category: 'ai',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'string' },
      { id: 'referenceImage1', label: 'Image 1', type: 'image' },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: {
      apiKey: '',
      prompt: '',
      model: 'flux_dev',
      imageSize: 'square_hd',
      numInferenceSteps: 28,
      seed: 0,
      refImageCount: 1,
    },
  },
};

/** fal.ai models that accept reference image input(s). Keep in sync with backend FAL_MODELS image_input field. */
export const FAL_IMG2IMG_MODELS: ReadonlySet<string> = new Set([
  'flux_redux_dev',
  'fast_sdxl',
  'nano_banana_edit',
  'nano_banana_pro',
]);

/** fal.ai models that accept multiple reference images (image_urls list). */
export const FAL_MULTI_IMAGE_MODELS: ReadonlySet<string> = new Set([
  'nano_banana_edit',
  'nano_banana_pro',
]);

/** fal.ai models that use aspect_ratio strings (Nano Banana family) instead of image_size presets. */
export const FAL_ASPECT_RATIO_MODELS: ReadonlySet<string> = new Set([
  'nano_banana',
  'nano_banana_pro',
]);

/** fal.ai models with no size control at all (edit endpoints derive size from input). */
export const FAL_NO_SIZE_MODELS: ReadonlySet<string> = new Set([
  'nano_banana_edit',
]);

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

  if (type === 'stackImages') {
    const count = Math.max(1, Math.min(MAX_STACK_IMAGES, (data?.imageCount as number) || 2));
    return Array.from({ length: count }, (_, i) => ({
      id: `image${i + 1}`,
      label: `Image ${i + 1}`,
      type: 'image' as PortType,
    }));
  }

  if (type === 'exportImage') {
    const count = Math.max(1, Math.min(MAX_EXPORT_IMAGES, (data?.imageCount as number) || 1));
    return Array.from({ length: count }, (_, i) => ({
      id: `image${i + 1}`,
      label: `Image ${i + 1}`,
      type: 'image' as PortType,
    }));
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

  if (type === 'falAi') {
    const model = (data?.model as string) || 'flux_dev';
    const supportsRefImage = FAL_IMG2IMG_MODELS.has(model);
    if (!supportsRefImage) {
      return [{ id: 'prompt', label: 'Prompt', type: 'string' as PortType }];
    }
    const supportsMulti = FAL_MULTI_IMAGE_MODELS.has(model);
    const requested = (data?.refImageCount as number) || 1;
    const count = supportsMulti ? Math.max(1, requested) : 1;
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

export function getNodeOutputs(type: string, data?: Record<string, any>): PortDefinition[] {
  const def = NODE_TYPE_DEFINITIONS[type];
  if (!def) return [];

  if (type === 'divider') {
    const raw = data?.selections;
    const count = Array.isArray(raw) ? raw.length : 0;
    const clamped = Math.max(0, Math.min(MAX_DIVIDER_OUTPUTS, count));
    return def.outputs.slice(0, clamped);
  }

  return def.outputs;
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

