import {
  FAL_IMG2IMG_MODELS,
  FAL_MODEL_SPECS,
  FAL_MULTI_IMAGE_MODELS,
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
  /** False for endpoints with no `prompt` field (fal image-variation models). Defaults to true. */
  promptSupported?: boolean;
  /** True for endpoints that cannot run without a reference image. Defaults to false. */
  refsRequired?: boolean;
}

function pickDefaults(nodeType: string): Record<string, unknown> {
  const def = NODE_TYPE_DEFINITIONS[nodeType];
  if (!def) return {};
  const { apiKey: _a, prompt: _p, ...rest } = def.defaults;
  return { ...rest };
}

function falFields(falModelId: string): FieldSpec[] {
  const spec = FAL_MODEL_SPECS[falModelId];
  const fields: FieldSpec[] = [];
  if (spec?.sizeControl === 'aspectRatio') {
    fields.push({
      type: 'select',
      key: 'aspectRatio',
      label: 'Aspect ratio',
      options: spec.aspectOptions ?? [],
    });
  } else if (spec?.sizeControl === 'imageSize') {
    fields.push({
      type: 'select',
      key: 'imageSize',
      label: 'Image size',
      options: spec.sizeOptions ?? [],
    });
  }
  for (const extra of spec?.extraFields ?? []) {
    fields.push({
      type: 'select',
      key: extra.key,
      label: extra.label,
      options: extra.options,
    });
  }
  if (spec?.supportsSteps) {
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

function makeFalEntry(id: string): PlaygroundModelEntry {
  const spec = FAL_MODEL_SPECS[id];
  const defaults: Record<string, unknown> = {
    ...pickDefaults('falAi'),
    model: id,
  };
  if (spec?.sizeControl === 'aspectRatio' && defaults.aspectRatio === undefined) {
    defaults.aspectRatio = '1:1';
  }
  for (const extra of spec?.extraFields ?? []) {
    if (defaults[extra.key] === undefined) {
      defaults[extra.key] = extra.default;
    }
  }
  return {
    id: `fal_${id}`,
    label: spec?.label ?? id,
    provider: 'fal.ai',
    nodeType: 'falAi',
    defaultParams: defaults,
    buildData: (params, refCount) => buildFalData(id, params, refCount),
    fields: falFields(id),
    refs: falRefs(id),
    promptSupported: spec?.supportsPrompt !== false,
    refsRequired: !!spec?.requiresImage,
  };
}

export const PLAYGROUND_MODELS: PlaygroundModelEntry[] = Object.keys(FAL_MODEL_SPECS).map((id) =>
  makeFalEntry(id),
);

export function getPlaygroundModel(id: string): PlaygroundModelEntry | undefined {
  return PLAYGROUND_MODELS.find((m) => m.id === id);
}

export function getInitialParams(entry: PlaygroundModelEntry): Record<string, unknown> {
  return JSON.parse(JSON.stringify(entry.defaultParams)) as Record<string, unknown>;
}
