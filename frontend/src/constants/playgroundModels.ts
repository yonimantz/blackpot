import {
  FAL_ASPECT_RATIO_MODELS,
  FAL_IMG2IMG_MODELS,
  FAL_MULTI_IMAGE_MODELS,
  FAL_NO_SIZE_MODELS,
  GPT_IMAGE_2_MAX_REFERENCE_IMAGES,
  NODE_TYPE_DEFINITIONS,
} from '../types/nodeTypes';

export type FieldSpec =
  | {
      type: 'select';
      key: string;
      label: string;
      options: { id: string; label: string }[];
    }
  | {
      type: 'number';
      key: string;
      label: string;
      min?: number;
      max?: number;
    };

export interface PlaygroundModelEntry {
  id: string;
  label: string;
  provider: string;
  nodeType: string;
  defaultParams: Record<string, unknown>;
  buildData: (params: Record<string, unknown>, refCount: number) => Record<string, unknown>;
  fields: FieldSpec[];
  refs: { supported: boolean; max: number };
}

const NANO_PRO_ASPECT = [
  '1:1',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '9:16',
  '16:9',
  '21:9',
].map((id) => ({ id, label: id }));

const NANO2_ASPECT = [
  '1:1',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '9:16',
  '16:9',
  '21:9',
  '1:2',
  '2:1',
  '1:8',
  '8:1',
].map((id) => ({ id, label: id }));

export const FAL_IMAGE_SIZE_OPTIONS: { id: string; label: string }[] = [
  { id: 'square_hd', label: 'Square HD (1024×1024)' },
  { id: 'square', label: 'Square (512×512)' },
  { id: 'portrait_4_3', label: 'Portrait 4:3' },
  { id: 'portrait_16_9', label: 'Portrait 16:9' },
  { id: 'landscape_4_3', label: 'Landscape 4:3' },
  { id: 'landscape_16_9', label: 'Landscape 16:9' },
];

export const FAL_ASPECT_RATIO_OPTIONS: { id: string; label: string }[] = [
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:4', label: '3:4' },
  { id: '3:2', label: '3:2' },
  { id: '2:3', label: '2:3' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '21:9', label: '21:9' },
];

const GPT_SIZE_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: '1024x1024', label: '1:1 · 1K' },
  { id: '1536x1024', label: '3:2 · 1K' },
  { id: '1024x1536', label: '2:3 · 1K' },
  { id: '2048x2048', label: '1:1 · 2K' },
  { id: '2048x1152', label: '16:9 · 2K' },
  { id: '3840x2160', label: '16:9 · 4K' },
  { id: '2160x3840', label: '9:16 · 4K' },
];

function pickDefaults(nodeType: string): Record<string, unknown> {
  const def = NODE_TYPE_DEFINITIONS[nodeType];
  if (!def) return {};
  const { apiKey: _a, prompt: _p, ...rest } = def.defaults;
  return { ...rest };
}

function nanoFields(extendedAspect: boolean, include512: boolean): FieldSpec[] {
  const resolutionOpts = include512
    ? [
        { id: '512', label: '512' },
        { id: '1k', label: '1K' },
        { id: '2k', label: '2K' },
        { id: '4k', label: '4K' },
      ]
    : [
        { id: '1k', label: '1K' },
        { id: '2k', label: '2K' },
        { id: '4k', label: '4K' },
      ];
  const fields: FieldSpec[] = [];
  if (extendedAspect) {
    fields.push({
      type: 'select',
      key: 'thinkingMode',
      label: 'Thinking mode',
      options: [
        { id: 'off', label: 'Off' },
        { id: 'minimal', label: 'Minimal' },
        { id: 'high', label: 'High' },
        { id: 'dynamic', label: 'Dynamic' },
      ],
    });
  }
  fields.push(
    {
      type: 'select',
      key: 'aspectRatio',
      label: 'Aspect ratio',
      options: extendedAspect ? NANO2_ASPECT : NANO_PRO_ASPECT,
    },
    {
      type: 'select',
      key: 'resolution',
      label: 'Resolution',
      options: resolutionOpts,
    },
    {
      type: 'select',
      key: 'outputMimeType',
      label: 'Output format',
      options: [
        { id: 'image/png', label: 'PNG (lossless)' },
        { id: 'image/jpeg', label: 'JPEG' },
      ],
    },
    { type: 'number', key: 'seed', label: 'Seed (0 = random)', min: 0 },
  );
  return fields;
}

function buildNanoData(
  nodeType: 'nanoBananaPro' | 'nanoBanana2',
  params: Record<string, unknown>,
  refCount: number,
): Record<string, unknown> {
  return {
    ...pickDefaults(nodeType),
    ...params,
    prompt: '',
    refImageCount: Math.max(refCount, 1),
  };
}

function falFields(falModelId: string): FieldSpec[] {
  const usesAspectRatio = FAL_ASPECT_RATIO_MODELS.has(falModelId);
  const noSizeControl = FAL_NO_SIZE_MODELS.has(falModelId);
  const supportsInferenceSteps = !usesAspectRatio && !noSizeControl;
  const fields: FieldSpec[] = [];
  if (!noSizeControl) {
    if (usesAspectRatio) {
      fields.push({
        type: 'select',
        key: 'aspectRatio',
        label: 'Aspect ratio',
        options: FAL_ASPECT_RATIO_OPTIONS,
      });
    } else {
      fields.push({
        type: 'select',
        key: 'imageSize',
        label: 'Image size',
        options: FAL_IMAGE_SIZE_OPTIONS,
      });
    }
  }
  if (supportsInferenceSteps) {
    fields.push({
      type: 'number',
      key: 'numInferenceSteps',
      label: 'Inference steps (1–50)',
      min: 1,
      max: 50,
    });
  }
  fields.push({ type: 'number', key: 'seed', label: 'Seed (0 = random)', min: 0 });
  return fields;
}

function falRefs(falModelId: string): { supported: boolean; max: number } {
  if (!FAL_IMG2IMG_MODELS.has(falModelId)) {
    return { supported: false, max: 0 };
  }
  return {
    supported: true,
    max: FAL_MULTI_IMAGE_MODELS.has(falModelId) ? 8 : 1,
  };
}

function buildFalData(
  falModelId: string,
  params: Record<string, unknown>,
  refCount: number,
): Record<string, unknown> {
  return {
    ...pickDefaults('falAi'),
    ...params,
    model: falModelId,
    prompt: '',
    refImageCount: Math.max(refCount, 1),
  };
}

function makeFalEntry(id: string, label: string): PlaygroundModelEntry {
  const defaults: Record<string, unknown> = {
    ...pickDefaults('falAi'),
    model: id,
  };
  if (FAL_ASPECT_RATIO_MODELS.has(id) && defaults.aspectRatio === undefined) {
    defaults.aspectRatio = '1:1';
  }
  return {
    id: `fal_${id}`,
    label,
    provider: 'fal.ai',
    nodeType: 'falAi',
    defaultParams: defaults,
    buildData: (params, refCount) => buildFalData(id, params, refCount),
    fields: falFields(id),
    refs: falRefs(id),
  };
}

const GPT_FIELDS: FieldSpec[] = [
  {
    type: 'select',
    key: 'imageSize',
    label: 'Output size',
    options: GPT_SIZE_OPTIONS,
  },
  {
    type: 'select',
    key: 'quality',
    label: 'Quality',
    options: [
      { id: 'auto', label: 'Auto' },
      { id: 'low', label: 'Low (fast)' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
  },
  {
    type: 'select',
    key: 'outputFormat',
    label: 'Output format',
    options: [
      { id: 'png', label: 'PNG' },
      { id: 'jpeg', label: 'JPEG' },
      { id: 'webp', label: 'WebP' },
    ],
  },
  {
    type: 'number',
    key: 'outputCompression',
    label: 'Compression (0–100%, JPEG/WebP)',
    min: 0,
    max: 100,
  },
  {
    type: 'select',
    key: 'moderation',
    label: 'Moderation',
    options: [
      { id: 'auto', label: 'Auto' },
      { id: 'low', label: 'Low' },
    ],
  },
];

export const PLAYGROUND_MODELS: PlaygroundModelEntry[] = [
  {
    id: 'nanoBananaPro',
    label: 'Nano Banana Pro',
    provider: 'Google Gemini',
    nodeType: 'nanoBananaPro',
    defaultParams: pickDefaults('nanoBananaPro'),
    buildData: (params, refCount) => buildNanoData('nanoBananaPro', params, refCount),
    fields: nanoFields(false, false),
    refs: { supported: true, max: 8 },
  },
  {
    id: 'nanoBanana2',
    label: 'Nano Banana 2',
    provider: 'Google Gemini',
    nodeType: 'nanoBanana2',
    defaultParams: pickDefaults('nanoBanana2'),
    buildData: (params, refCount) => buildNanoData('nanoBanana2', params, refCount),
    fields: nanoFields(true, true),
    refs: { supported: true, max: 8 },
  },
  {
    id: 'gptImage2',
    label: 'GPT Image 2',
    provider: 'OpenAI',
    nodeType: 'gptImage2',
    defaultParams: pickDefaults('gptImage2'),
    buildData: (params, refCount) => ({
      ...pickDefaults('gptImage2'),
      ...params,
      prompt: '',
      refImageCount: Math.max(refCount, 1),
    }),
    fields: GPT_FIELDS,
    refs: { supported: true, max: GPT_IMAGE_2_MAX_REFERENCE_IMAGES },
  },
  makeFalEntry('flux_dev', 'FLUX.1 [dev]'),
  makeFalEntry('flux_schnell', 'FLUX.1 [schnell] (fast)'),
  makeFalEntry('flux_pro_v11', 'FLUX1.1 [pro]'),
  makeFalEntry('flux_redux_dev', 'FLUX.1 [dev] Redux (image-to-image)'),
  makeFalEntry('sd35_large', 'Stable Diffusion 3.5 Large'),
  makeFalEntry('fast_sdxl', 'Fast SDXL'),
  makeFalEntry('nano_banana', 'Nano Banana (Gemini 2.5 Flash Image)'),
  makeFalEntry('nano_banana_edit', 'Nano Banana Edit (image-to-image)'),
  makeFalEntry('nano_banana_pro', 'Nano Banana Pro (FAL)'),
];

export function getPlaygroundModel(id: string): PlaygroundModelEntry | undefined {
  return PLAYGROUND_MODELS.find((m) => m.id === id);
}

export function getInitialParams(entry: PlaygroundModelEntry): Record<string, unknown> {
  return JSON.parse(JSON.stringify(entry.defaultParams)) as Record<string, unknown>;
}
