import { LEGACY_NODE_TYPES, isLegacyNodeType } from './legacyNodes';

export type PortType = 'image' | 'number' | 'color' | 'string' | 'boolean' | 'model3d' | 'any';

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
  /** Removed node kept registered so old graphs still render. See legacyNodes.ts. */
  legacy?: boolean;
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

/** Keep in sync with backend `read_nodes.MAX_PICK_RANDOM_INPUTS`. */
export const MAX_PICK_RANDOM_INPUTS = 12;

/** Selectable value types for the Pick Random node, and the port type each maps to. */
export const PICK_RANDOM_VALUE_TYPES = [
  { id: 'image', label: 'Image', port: 'image' },
  { id: 'color', label: 'Color', port: 'color' },
  { id: 'value', label: 'Value', port: 'number' },
  { id: 'text', label: 'Text', port: 'string' },
] as const;

export type PickRandomValueType = (typeof PICK_RANDOM_VALUE_TYPES)[number]['id'];

/** Port type for a Pick Random node's current `valueType`, defaulting to `image`. */
export function pickRandomPortType(valueType: unknown): PortType {
  const found = PICK_RANDOM_VALUE_TYPES.find((v) => v.id === valueType);
  return (found?.port ?? 'image') as PortType;
}

/** Inverse of `pickRandomPortType` — the `valueType` whose ports match `portType`,
 * defaulting to `image` for port types Pick Random doesn't have a dedicated mode for. */
export function pickRandomValueTypeForPort(portType: PortType): PickRandomValueType {
  const found = PICK_RANDOM_VALUE_TYPES.find((v) => v.port === portType);
  return found?.id ?? 'image';
}

/** Selectable value types for the Boolean node, and the port type each maps to. */
export const BOOLEAN_VALUE_TYPES = [
  { id: 'text', label: 'Text', port: 'string' },
  { id: 'value', label: 'Value', port: 'number' },
  { id: 'image', label: 'Image', port: 'image' },
  { id: 'color', label: 'Color', port: 'color' },
] as const;

export type BooleanValueType = (typeof BOOLEAN_VALUE_TYPES)[number]['id'];

/** Port type for a Boolean node's current `valueType`, defaulting to `text`. */
export function booleanPortType(valueType: unknown): PortType {
  const found = BOOLEAN_VALUE_TYPES.find((v) => v.id === valueType);
  return (found?.port ?? 'string') as PortType;
}

/** Inverse of `booleanPortType` — the `valueType` whose ports match `portType`,
 * defaulting to `text` for port types Boolean doesn't have a dedicated mode for. */
export function booleanValueTypeForPort(portType: PortType): BooleanValueType {
  const found = BOOLEAN_VALUE_TYPES.find((v) => v.port === portType);
  return found?.id ?? 'text';
}

/**
 * Default canvas size for a fresh Preview node. Locked at creation so
 * incoming run results don't make the node grow/shrink to fit the image —
 * the user can resize it manually with the NodeResizer if desired.
 */
export const DEFAULT_PREVIEW_NODE_WIDTH = 240;
export const DEFAULT_PREVIEW_NODE_HEIGHT = 220;

/**
 * Preview nodes whose body fills the node box, so they get the NodeResizer and
 * a locked default size instead of sizing to their content.
 */
export const RESIZABLE_PREVIEW_NODE_TYPES: ReadonlySet<string> = new Set([
  'preview',
  'preview3d',
  'import3d',
]);

export function isResizablePreviewNodeType(type: string | undefined): boolean {
  return !!type && RESIZABLE_PREVIEW_NODE_TYPES.has(type);
}

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
  return !!def && !def.legacy && PINNABLE_NODE_CATEGORIES.has(def.category);
}

export function isTemplateOutputNodeType(type: string | undefined): boolean {
  return !!type && TEMPLATE_OUTPUT_NODE_TYPES.has(type);
}

export const DEFAULT_IMAGE_TO_3D_MODEL = 'tripo_h31';

export const DEFAULT_UPSCALER_MODEL = 'esrgan';
export const DEFAULT_UPSCALER_SCALE = '2';

export type Model3dDisplayMode = 'textured' | 'wireframe' | 'mesh';

export const DEFAULT_MODEL3D_DISPLAY_MODE: Model3dDisplayMode = 'textured';

/**
 * Preview 3D display-mode tags. Kept here (not in Model3dViewer.tsx) so the
 * inspector and BaseNode can share the list and labels without importing the
 * three.js-backed viewer module, which would defeat its lazy chunk split.
 */
export const PREVIEW_3D_DISPLAY_MODES: {
  id: Model3dDisplayMode;
  label: string;
  hint: string;
}[] = [
  {
    id: 'textured',
    label: 'Textured',
    hint: "The model with its own materials and textures, if it has any",
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    hint: 'Wireframe drawn on top of the untextured mesh',
  },
  {
    id: 'mesh',
    label: 'Mesh',
    hint: 'Untextured surface only',
  },
];

export function normalizePreview3dDisplayMode(value: unknown): Model3dDisplayMode {
  return value === 'wireframe' || value === 'mesh' ? value : DEFAULT_MODEL3D_DISPLAY_MODE;
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
    defaults: {
      width: 512,
      height: 512,
      aspectLocked: true,
      resizeMode: 'stretch',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
    },
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
    defaults: {
      x: 0,
      y: 0,
      width: 256,
      height: 256,
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
    },
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
      // Keep in sync with backend `tool_nodes.DEFAULT_REMOVE_BG_MODEL`.
      model: 'General Use (Heavy)',
      operatingResolution: '1024x1024',
      refineForeground: true,
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
      { id: 'image1', label: 'Top', type: 'image' },
      { id: 'image2', label: 'Bottom', type: 'image' },
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
  math: {
    type: 'math',
    label: 'Math',
    category: 'value',
    inputs: [
      { id: 'a', label: 'A', type: 'number' },
      { id: 'b', label: 'B', type: 'number' },
    ],
    outputs: [{ id: 'value', label: 'Value', type: 'number' }],
    defaults: { a: 0, b: 0, operation: 'add' },
  },
  boolean: {
    type: 'boolean',
    label: 'Boolean',
    category: 'value',
    inputs: [
      { id: 'a', label: 'A', type: 'string' },
      { id: 'b', label: 'B', type: 'string' },
    ],
    outputs: [{ id: 'value', label: 'Value', type: 'string' }],
    defaults: { valueType: 'text', enabled: false },
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
  pickRandom: {
    type: 'pickRandom',
    label: 'Pick Random',
    category: 'read',
    inputs: [
      { id: 'in1', label: 'Input 1', type: 'image' },
      { id: 'in2', label: 'Input 2', type: 'image' },
    ],
    outputs: [{ id: 'out', label: 'Output', type: 'image' }],
    defaults: { valueType: 'image', inputCount: 2 },
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
  adjustments: {
    type: 'adjustments',
    label: 'Adjustments',
    category: 'tool',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: {
      hue: 0,
      saturation: 0,
      value: 0,
      levels: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 },
      _adjustmentsPreview: '',
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
  imageTo3d: {
    type: 'imageTo3d',
    label: 'Image to 3D',
    category: 'ai',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'model', label: '3D Model', type: 'model3d' }],
    defaults: {
      apiKey: '',
      model: DEFAULT_IMAGE_TO_3D_MODEL,
      textureQuality: 'standard',
      // Persisted after a successful run so downstream Preview 3D / Export 3D
      // can resolve the mesh after a reload (`_result` is stripped on save).
      modelAssetId: '',
    },
  },
  upscaler: {
    type: 'upscaler',
    label: 'Upscaler',
    category: 'ai',
    inputs: [{ id: 'image', label: 'Image', type: 'image' }],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    defaults: {
      apiKey: '',
      model: DEFAULT_UPSCALER_MODEL,
      scale: DEFAULT_UPSCALER_SCALE,
      prompt: '',
    },
  },
  preview3d: {
    type: 'preview3d',
    label: 'Preview 3D',
    category: 'io',
    inputs: [{ id: 'model', label: '3D Model', type: 'model3d' }],
    // The mesh passes straight through so Preview 3D can sit inline between
    // Image to 3D and Export 3D. `image` is a browser-only tap of whatever
    // the viewer currently shows (see model3dCapture.ts) — the backend has no
    // 3D renderer, so it can't compute this output itself.
    outputs: [
      { id: 'model', label: '3D Model', type: 'model3d' },
      { id: 'image', label: 'Image', type: 'image' },
    ],
    defaults: {
      // Last mesh shown in the viewer; survives save/reload (GLB stays on disk).
      modelAssetId: '',
      showGrid: true,
      transparentBg: true,
      keyLight: 2,
      fillLight: 0.6,
      shadowStrength: 0.5,
      lightAzimuth: 135,
      lightElevation: 45,
      displayMode: DEFAULT_MODEL3D_DISPLAY_MODE,
    },
  },
  export3d: {
    type: 'export3d',
    label: 'Export 3D',
    category: 'io',
    inputs: [{ id: 'model', label: '3D Model', type: 'model3d' }],
    outputs: [],
    defaults: {
      exportPath: '',
      fileName: 'model',
    },
  },
  import3d: {
    type: 'import3d',
    label: 'Import 3D',
    category: 'io',
    inputs: [],
    outputs: [{ id: 'model', label: '3D Model', type: 'model3d' }],
    // GLB/OBJ/FBX are all converted to GLB client-side before upload (see
    // model3dImport.ts), so modelAssetId always points at a GLB in MODELS_DIR
    // — sourceFormat/sourceName are provenance only, never re-read for output.
    defaults: {
      modelAssetId: '',
      sourceName: '',
      sourceFormat: '',
      sizeBytes: 0,
    },
  },
  // Every removed node was a prompt-plus-reference-images generator, so they all
  // share one port shape. Registering them keeps old graphs intact; see
  // legacyNodes.ts for why.
  ...Object.fromEntries(
    Object.entries(LEGACY_NODE_TYPES).map(([type, info]) => [
      type,
      {
        type,
        label: info.label,
        category: 'ai',
        inputs: [
          { id: 'prompt', label: 'Prompt', type: 'string' as PortType },
          { id: 'referenceImage1', label: 'Image 1', type: 'image' as PortType },
        ],
        outputs: [{ id: 'image', label: 'Image', type: 'image' as PortType }],
        defaults: { prompt: '', refImageCount: 1 },
        legacy: true,
      } satisfies NodeTypeDefinition,
    ]),
  ),
};

/** Node types a user can actually place; removed types are registered but not offered. */
export const PLACEABLE_NODE_DEFINITIONS: NodeTypeDefinition[] = Object.values(
  NODE_TYPE_DEFINITIONS,
).filter((def) => !def.legacy);

export function isPlaceableNodeType(type: string | undefined): boolean {
  return !!type && !!NODE_TYPE_DEFINITIONS[type] && !NODE_TYPE_DEFINITIONS[type].legacy;
}

export interface FalSelectOption {
  id: string;
  label: string;
}

/** A cost- or quality-affecting select field with no generic home (quality, resolution, ...). */
export interface FalExtraField {
  /** Node data key this field reads/writes. Keep in sync with backend extra_params[*].data_key. */
  key: string;
  label: string;
  options: FalSelectOption[];
  default: string;
}

export interface FalModelSpec {
  label: string;
  /** 'none' = no reference-image support at all; 'single' = image_url; 'multi' = image_urls (up to 8). */
  imageInput: 'none' | 'single' | 'multi';
  /** True for endpoints that cannot run without at least one reference image. */
  requiresImage?: boolean;
  /** False for pure image-variation endpoints that have no `prompt` field. Defaults to true. */
  supportsPrompt?: boolean;
  sizeControl: 'imageSize' | 'aspectRatio' | 'none';
  sizeOptions?: FalSelectOption[];
  aspectOptions?: FalSelectOption[];
  /** Whether this endpoint exposes num_inference_steps. Defaults to false. */
  supportsSteps?: boolean;
  extraFields?: FalExtraField[];
}

export const FAL_IMAGE_SIZE_OPTIONS: FalSelectOption[] = [
  { id: 'square_hd', label: 'Square HD (1024×1024)' },
  { id: 'square', label: 'Square (512×512)' },
  { id: 'portrait_4_3', label: 'Portrait 4:3' },
  { id: 'portrait_16_9', label: 'Portrait 16:9' },
  { id: 'landscape_4_3', label: 'Landscape 4:3' },
  { id: 'landscape_16_9', label: 'Landscape 16:9' },
];

export const FAL_ASPECT_RATIO_OPTIONS: FalSelectOption[] = [
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '21:9', label: '21:9' },
];

const FAL_SIZE_WITH_AUTO: FalSelectOption[] = [
  { id: 'auto', label: 'Auto' },
  ...FAL_IMAGE_SIZE_OPTIONS,
];

const FAL_SEEDREAM_SIZE_OPTIONS: FalSelectOption[] = [
  { id: 'auto_2K', label: 'Auto (2K)' },
  { id: 'auto_1K', label: 'Auto (1K)' },
  ...FAL_IMAGE_SIZE_OPTIONS,
];

const FAL_NANO_BANANA_2_ASPECT_OPTIONS: FalSelectOption[] = [
  { id: 'auto', label: 'Auto' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '3:4', label: '3:4' },
  { id: '2:3', label: '2:3' },
  { id: '4:3', label: '4:3' },
  { id: '5:4', label: '5:4' },
  { id: '3:2', label: '3:2' },
  { id: '9:16', label: '9:16' },
  { id: '16:9', label: '16:9' },
  { id: '21:9', label: '21:9' },
  { id: '1:4', label: '1:4' },
  { id: '4:1', label: '4:1' },
  { id: '1:8', label: '1:8' },
  { id: '8:1', label: '8:1' },
];

/**
 * Single source of truth for every fal.ai model offered by the FAL AI node.
 * Keep in sync with backend `FAL_MODELS` in ai_nodes.py — same keys, same
 * capabilities. The dropdown order in the inspector and playground follows
 * this object's key order.
 */
export const FAL_MODEL_SPECS: Record<string, FalModelSpec> = {
  flux_dev: {
    label: 'FLUX.1 [dev]',
    imageInput: 'none',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
    supportsSteps: true,
  },
  flux_schnell: {
    label: 'FLUX.1 [schnell] (fast)',
    imageInput: 'none',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
    supportsSteps: true,
  },
  flux_pro_v11: {
    label: 'FLUX1.1 [pro]',
    imageInput: 'none',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
  },
  flux_redux_dev: {
    label: 'FLUX.1 [dev] Redux (image variation, no prompt)',
    imageInput: 'single',
    requiresImage: true,
    supportsPrompt: false,
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
    supportsSteps: true,
  },
  sd35_large: {
    label: 'Stable Diffusion 3.5 Large',
    imageInput: 'none',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
    supportsSteps: true,
  },
  fast_sdxl: {
    label: 'Fast SDXL',
    imageInput: 'single',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
    supportsSteps: true,
  },
  nano_banana: {
    label: 'Nano Banana (Gemini 2.5 Flash Image)',
    imageInput: 'none',
    sizeControl: 'aspectRatio',
    aspectOptions: FAL_ASPECT_RATIO_OPTIONS,
  },
  nano_banana_edit: {
    label: 'Nano Banana Edit (image-to-image)',
    imageInput: 'multi',
    requiresImage: true,
    sizeControl: 'none',
  },
  nano_banana_pro: {
    label: 'Nano Banana Pro',
    imageInput: 'multi',
    sizeControl: 'aspectRatio',
    aspectOptions: FAL_ASPECT_RATIO_OPTIONS,
  },
  gpt_image_2: {
    label: 'GPT Image 2',
    imageInput: 'multi',
    sizeControl: 'imageSize',
    sizeOptions: FAL_SIZE_WITH_AUTO,
    extraFields: [
      {
        key: 'quality',
        label: 'Quality',
        options: [
          { id: 'auto', label: 'Auto' },
          { id: 'low', label: 'Low' },
          { id: 'medium', label: 'Medium' },
          { id: 'high', label: 'High (default, most expensive)' },
        ],
        default: 'high',
      },
    ],
  },
  flux_2_pro: {
    label: 'FLUX.2 [pro]',
    imageInput: 'multi',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
  },
  nano_banana_2: {
    label: 'Nano Banana 2',
    imageInput: 'multi',
    sizeControl: 'aspectRatio',
    aspectOptions: FAL_NANO_BANANA_2_ASPECT_OPTIONS,
    extraFields: [
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { id: '0.5K', label: '0.5K' },
          { id: '1K', label: '1K (default)' },
          { id: '2K', label: '2K (1.5× cost)' },
          { id: '4K', label: '4K (2× cost)' },
        ],
        default: '1K',
      },
    ],
  },
  seedream_v5_pro: {
    label: 'Seedream 5 Pro',
    imageInput: 'multi',
    sizeControl: 'imageSize',
    sizeOptions: FAL_SEEDREAM_SIZE_OPTIONS,
  },
  ideogram_v4: {
    label: 'Ideogram 4',
    imageInput: 'single',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
    extraFields: [
      {
        key: 'renderingSpeed',
        label: 'Rendering speed',
        options: [
          { id: 'TURBO', label: 'Turbo (cheapest)' },
          { id: 'BALANCED', label: 'Balanced (default)' },
          { id: 'QUALITY', label: 'Quality (most expensive)' },
        ],
        default: 'BALANCED',
      },
    ],
  },
  recraft_v41: {
    label: 'Recraft V4.1',
    imageInput: 'none',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
  },
  z_image_turbo: {
    label: 'Z-Image Turbo',
    imageInput: 'single',
    sizeControl: 'imageSize',
    sizeOptions: FAL_IMAGE_SIZE_OPTIONS,
    supportsSteps: true,
  },
};

/** Model dropdown options, in `FAL_MODEL_SPECS` order. */
export const FAL_MODEL_OPTIONS: FalSelectOption[] = Object.entries(FAL_MODEL_SPECS).map(
  ([id, spec]) => ({ id, label: spec.label }),
);

function falModelKeysWhere(predicate: (spec: FalModelSpec) => boolean): ReadonlySet<string> {
  return new Set(
    Object.entries(FAL_MODEL_SPECS)
      .filter(([, spec]) => predicate(spec))
      .map(([id]) => id),
  );
}

/**
 * fal.ai models that accept reference image input(s). Keep in sync with backend
 * FAL_MODELS: either the model's own endpoint takes an image, or it declares an
 * edit_endpoint that the backend switches to once an image is connected.
 */
export const FAL_IMG2IMG_MODELS: ReadonlySet<string> = falModelKeysWhere(
  (spec) => spec.imageInput !== 'none',
);

/** fal.ai models that cannot run at all without a reference image. Keep in sync with backend requires_image. */
export const FAL_REQUIRES_IMAGE_MODELS: ReadonlySet<string> = falModelKeysWhere(
  (spec) => !!spec.requiresImage,
);

/**
 * fal.ai models whose endpoint has no `prompt` field — they re-imagine the input
 * image instead of following text. Keep in sync with backend supports_prompt.
 */
export const FAL_NO_PROMPT_MODELS: ReadonlySet<string> = falModelKeysWhere(
  (spec) => spec.supportsPrompt === false,
);

/** fal.ai models that accept multiple reference images (image_urls list). */
export const FAL_MULTI_IMAGE_MODELS: ReadonlySet<string> = falModelKeysWhere(
  (spec) => spec.imageInput === 'multi',
);

/** fal.ai models that use aspect_ratio strings (Nano Banana family) instead of image_size presets. */
export const FAL_ASPECT_RATIO_MODELS: ReadonlySet<string> = falModelKeysWhere(
  (spec) => spec.sizeControl === 'aspectRatio',
);

/** fal.ai models with no size control at all (edit endpoints derive size from input). */
export const FAL_NO_SIZE_MODELS: ReadonlySet<string> = falModelKeysWhere(
  (spec) => spec.sizeControl === 'none',
);

/**
 * fal.ai models in the image_size family that still have no num_inference_steps
 * field. Keep in sync with backend supports_steps.
 */
export const FAL_NO_STEPS_MODELS: ReadonlySet<string> = falModelKeysWhere(
  (spec) => spec.sizeControl === 'imageSize' && !spec.supportsSteps,
);

export const PORT_TYPE_COLORS: Record<PortType, string> = {
  image: '#60a5fa',
  number: '#818cf8',
  color: '#fb7185',
  string: '#4ade80',
  boolean: '#facc15',
  model3d: '#c084fc',
  any: '#a1a1aa',
};

/** Descriptor that travels a `model3d` port. Bytes stay on disk. */
export interface Model3dDescriptor {
  assetId: string;
  url: string;
  format: string;
  sizeBytes?: number;
}

export interface ImageTo3dModelSpec {
  label: string;
  extraFields?: FalExtraField[];
}

/**
 * Models offered by the Image to 3D node. Keep in sync with backend
 * `IMAGE_TO_3D_MODELS` in ai_nodes.py — same keys.
 */
export const IMAGE_TO_3D_MODEL_SPECS: Record<string, ImageTo3dModelSpec> = {
  tripo_h31: {
    label: 'Tripo H3.1 (textured)',
    extraFields: [
      {
        key: 'textureQuality',
        label: 'Texture quality',
        options: [
          { id: 'standard', label: 'Standard' },
          { id: 'detailed', label: 'Detailed' },
        ],
        default: 'standard',
      },
    ],
  },
  hunyuan_v21: {
    label: 'Hunyuan3D 2.1 (PBR textured)',
  },
  // Hunyuan Rapid only emits GLB in geometry-only mode; textured mode returns
  // OBJ + MTL, which this pipeline cannot carry. Fast draft, no textures.
  hunyuan_rapid: {
    label: 'Hunyuan 3D 3.1 Rapid (fast, untextured)',
  },
};

export const IMAGE_TO_3D_MODEL_OPTIONS: FalSelectOption[] = Object.entries(
  IMAGE_TO_3D_MODEL_SPECS,
).map(([id, spec]) => ({ id, label: spec.label }));

export interface UpscalerModelSpec {
  label: string;
  /** True for models with a `prompt` field (Clarity). Defaults to false (ESRGAN). */
  supportsPrompt?: boolean;
}

/**
 * Models offered by the Upscaler node. Keep in sync with backend
 * `UPSCALER_MODELS` in ai_nodes.py — same keys.
 */
export const UPSCALER_MODEL_SPECS: Record<string, UpscalerModelSpec> = {
  esrgan: {
    label: 'Real-ESRGAN (fast)',
  },
  clarity: {
    label: 'Clarity Upscaler (quality)',
    supportsPrompt: true,
  },
};

export const UPSCALER_MODEL_OPTIONS: FalSelectOption[] = Object.entries(
  UPSCALER_MODEL_SPECS,
).map(([id, spec]) => ({ id, label: spec.label }));

/** Shared by both upscaler models — see their fal OpenAPI schemas (1–4, or 1–8 for ESRGAN). */
export const UPSCALER_SCALE_OPTIONS: FalSelectOption[] = [
  { id: '2', label: '2x' },
  { id: '4', label: '4x' },
];

/** Upscaler models with a `prompt` field. Keep in sync with backend supports_prompt. */
export const UPSCALER_PROMPT_MODELS: ReadonlySet<string> = new Set(
  Object.entries(UPSCALER_MODEL_SPECS)
    .filter(([, spec]) => !!spec.supportsPrompt)
    .map(([id]) => id),
);

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

  // Keep the removed generators' dynamic reference ports so a saved graph does
  // not lose the edges wired into Image 2 and beyond.
  if (isLegacyNodeType(type)) {
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

  if (type === 'pickRandom') {
    const portType = pickRandomPortType(data?.valueType);
    const count = Math.max(2, Math.min(MAX_PICK_RANDOM_INPUTS, (data?.inputCount as number) || 2));
    return Array.from({ length: count }, (_, i) => ({
      id: `in${i + 1}`,
      label: `Input ${i + 1}`,
      type: portType,
    }));
  }

  if (type === 'boolean') {
    const portType = booleanPortType(data?.valueType);
    return [
      { id: 'a', label: 'A', type: portType },
      { id: 'b', label: 'B', type: portType },
    ];
  }

  if (type === 'falAi') {
    const model = (data?.model as string) || 'flux_dev';
    const promptPorts: PortDefinition[] = FAL_NO_PROMPT_MODELS.has(model)
      ? []
      : [{ id: 'prompt', label: 'Prompt', type: 'string' as PortType }];
    if (!FAL_IMG2IMG_MODELS.has(model)) {
      return promptPorts;
    }
    const supportsMulti = FAL_MULTI_IMAGE_MODELS.has(model);
    const requested = (data?.refImageCount as number) || 1;
    const count = supportsMulti ? Math.max(1, requested) : 1;
    return [
      ...promptPorts,
      ...Array.from({ length: count }, (_, i) => ({
        id: `referenceImage${i + 1}`,
        label: `Image ${i + 1}`,
        type: 'image' as PortType,
      })),
    ];
  }

  if (type === 'upscaler') {
    const model = (data?.model as string) || DEFAULT_UPSCALER_MODEL;
    const ports: PortDefinition[] = [{ id: 'image', label: 'Image', type: 'image' as PortType }];
    if (UPSCALER_PROMPT_MODELS.has(model)) {
      ports.push({ id: 'prompt', label: 'Prompt', type: 'string' as PortType });
    }
    return ports;
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

  if (type === 'pickRandom') {
    return [{ id: 'out', label: 'Output', type: pickRandomPortType(data?.valueType) }];
  }

  if (type === 'boolean') {
    return [{ id: 'value', label: 'Value', type: booleanPortType(data?.valueType) }];
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
  for (const def of PLACEABLE_NODE_DEFINITIONS) {
    // Pick Random and Boolean adapt their ports to whatever they're wired to,
    // so they're always a valid drop target/source regardless of the dragged
    // port's type.
    if (def.type === 'pickRandom' || def.type === 'boolean') {
      result.add(def.type);
      continue;
    }
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
  newNodeData?: Record<string, any>,
): string | null {
  const def = NODE_TYPE_DEFINITIONS[newNodeType];
  if (!def) return null;
  const outputs = getNodeOutputs(newNodeType, newNodeData ?? def.defaults);
  const p = outputs.find((out) => canConnect(out.type, targetPortType));
  return p?.id ?? null;
}

