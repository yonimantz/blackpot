import type { PlaygroundModelEntry } from '../constants/playgroundModels';
import { cancelWorkflow, runWorkflowStreaming, uploadFile, type StreamCallbacks } from './api';

export interface PlaygroundReference {
  file?: File;
  previewUrl: string;
  dataUrl?: string;
  fileId?: string;
}

export interface BuildPlaygroundWorkflowResult {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  aiNodeId: string;
}

export function buildPlaygroundWorkflow(
  model: PlaygroundModelEntry,
  params: Record<string, unknown>,
  prompt: string,
  references: PlaygroundReference[],
): BuildPlaygroundWorkflowResult {
  const promptId = crypto.randomUUID();
  const aiId = crypto.randomUUID();
  const refCount = references.length;
  const refImageCount = model.refs.supported ? Math.max(refCount, 1) : 1;

  const nodes: Record<string, unknown>[] = [
    {
      id: promptId,
      type: 'prompt',
      position: { x: 0, y: 0 },
      data: { value: prompt, label: 'Prompt' },
    },
    {
      id: aiId,
      type: model.nodeType,
      position: { x: 240, y: 0 },
      data: {
        ...model.buildData(params, refCount),
        label: model.label,
        refImageCount,
      },
    },
  ];

  const edges: Record<string, unknown>[] = [
    {
      id: crypto.randomUUID(),
      source: promptId,
      target: aiId,
      sourceHandle: 'text',
      targetHandle: 'prompt',
    },
  ];

  references.forEach((ref, i) => {
    const importId = crypto.randomUUID();
    nodes.push({
      id: importId,
      type: 'importImage',
      position: { x: 0, y: 80 + i * 40 },
      data: {
        fileData: ref.dataUrl ?? '',
        fileAssetId: ref.fileId,
        label: `Reference ${i + 1}`,
      },
    });
    edges.push({
      id: crypto.randomUUID(),
      source: importId,
      target: aiId,
      sourceHandle: 'image',
      targetHandle: `referenceImage${i + 1}`,
    });
  });

  return { nodes, edges, aiNodeId: aiId };
}

async function ensureReferencesUploaded(refs: PlaygroundReference[]): Promise<PlaygroundReference[]> {
  const out: PlaygroundReference[] = [];
  for (const ref of refs) {
    if (ref.dataUrl) {
      out.push(ref);
      continue;
    }
    if (!ref.file) {
      throw new Error('Reference image is missing file data');
    }
    const { fileId, dataUrl } = await uploadFile(ref.file);
    out.push({ ...ref, dataUrl, fileId });
  }
  return out;
}

export interface RunPlaygroundOptions {
  model: PlaygroundModelEntry;
  params: Record<string, unknown>;
  prompt: string;
  references: PlaygroundReference[];
  signal?: AbortSignal;
  callbacks?: Pick<StreamCallbacks, 'onNodeStart'>;
  onImage?: (imageDataUrl: string) => void;
}

export async function runPlaygroundGeneration(options: RunPlaygroundOptions): Promise<string> {
  const { model, params, prompt, references, signal, callbacks, onImage } = options;
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error('Enter a prompt before generating.');
  }

  const uploadedRefs = references.length > 0 ? await ensureReferencesUploaded(references) : [];
  const { nodes, edges, aiNodeId } = buildPlaygroundWorkflow(
    model,
    params,
    trimmed,
    uploadedRefs,
  );

  let imageResult = '';
  let nodeError: string | null = null;

  await runWorkflowStreaming(
    { nodes, edges },
    {
      onNodeStart: callbacks?.onNodeStart,
      onNodeDone: (nodeId, result) => {
        if (nodeId !== aiNodeId) return;
        if (result?.error) {
          nodeError = String(result.error);
          return;
        }
        if (typeof result?.image === 'string' && result.image.length > 0) {
          imageResult = result.image;
          onImage?.(result.image);
        }
      },
      onError: (detail) => {
        nodeError = detail;
      },
    },
    signal,
  );

  if (nodeError) {
    throw new Error(nodeError);
  }
  if (!imageResult) {
    throw new Error('Generation finished but no image was returned.');
  }

  return imageResult;
}

export async function cancelPlaygroundRun(): Promise<void> {
  await cancelWorkflow();
}
