export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

/** Plain fetch wrapper. Kept named `authFetch` so existing call sites stay unchanged. */
export async function authFetch(input: string | Request, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

async function waitForBackend(signal?: AbortSignal): Promise<void> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await authFetch(`${API_BASE}/health`, { signal });
      if (res.ok) return;
    } catch {
      /* backend not up yet */
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  throw new Error(
    'Cannot reach the SpotOn server. Close this tab and start SpotOn again.',
  );
}

export interface StreamCallbacks {
  onNodeStart?: (nodeId: string) => void;
  onNodeDone?: (nodeId: string, result: any) => void;
  onDone?: (results: Record<string, any>) => void;
  onError?: (detail: string) => void;
  onCancelled?: () => void;
}

export async function runWorkflowStreaming(
  workflow: {
    nodes: any[];
    edges: any[];
    workflow_id?: string | null;
    pre_outputs?: Record<string, Record<string, any>>;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  let res: Response;
  try {
    res = await authFetch(`${API_BASE}/run/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
      signal,
    });
  } catch (networkErr: any) {
    if (networkErr.name === 'AbortError') throw networkErr;
    await waitForBackend(signal);
    res = await authFetch(`${API_BASE}/run/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
      signal,
    });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const detail =
      err?.detail ??
      err?.message ??
      `Backend returned HTTP ${res.status} ${res.statusText}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  return new Promise((resolve, reject) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResults: Record<string, any> = {};

    function processEvents() {
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        let eventType = '';
        let dataStr = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataStr += line.slice(6);
          } else if (dataStr && !line.startsWith('event:')) {
            dataStr += line;
          }
        }

        if (!eventType || !dataStr) continue;

        let data: any;
        try {
          data = JSON.parse(dataStr);
        } catch {
          continue;
        }

        switch (eventType) {
          case 'node_start':
            callbacks.onNodeStart?.(data.nodeId);
            break;
          case 'node_done':
            callbacks.onNodeDone?.(data.nodeId, data.result);
            break;
          case 'cancelled':
            callbacks.onCancelled?.();
            break;
          case 'done':
            finalResults = data;
            callbacks.onDone?.(data);
            break;
          case 'error':
            callbacks.onError?.(data.detail);
            break;
        }
      }
    }

    function read() {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            if (buffer.trim()) processEvents();
            resolve(finalResults);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          processEvents();
          read();
        })
        .catch((err) => {
          reject(err);
        });
    }

    read();
  });
}

export async function cancelWorkflow(): Promise<void> {
  await authFetch(`${API_BASE}/run/cancel`, { method: 'POST' });
}

export interface ExportImageItem {
  image: string;
  fileName: string;
  format: string;
}

export interface ExportImagesResult {
  saved: string[];
  errors: string[];
}

/** Write each connected image to disk on demand (Export button). */
export async function exportImages(
  items: ExportImageItem[],
  exportPath = '',
): Promise<ExportImagesResult> {
  const res = await authFetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, exportPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const detail =
      err?.detail ??
      err?.message ??
      `Backend returned HTTP ${res.status} ${res.statusText}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export interface ExportModelItem {
  assetId: string;
  fileName: string;
}

/** Copy a generated GLB from MODELS_DIR to the export folder (Export button). */
export async function exportModels(
  items: ExportModelItem[],
  exportPath = '',
): Promise<ExportImagesResult> {
  const res = await authFetch(`${API_BASE}/export-3d`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, exportPath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const detail =
      err?.detail ??
      err?.message ??
      `Backend returned HTTP ${res.status} ${res.statusText}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return res.json();
}

/** Stable URL that streams a generated GLB by asset id (`{uuid}.glb`). */
export function getModelFileUrl(assetId: string): string {
  return `${API_BASE}/model/${assetId}`;
}

/**
 * Upload an already-GLB blob (Import 3D node) into MODELS_DIR and return its
 * asset id. The backend rejects anything that isn't a `.glb` — OBJ/FBX must be
 * converted client-side first (see `utils/model3dImport.ts`).
 */
export async function uploadModel(
  blob: Blob,
  fileName = 'model.glb',
): Promise<{ assetId: string; sizeBytes: number }> {
  const formData = new FormData();
  formData.append('file', blob, fileName);
  const res = await authFetch(`${API_BASE}/model`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || 'Model upload failed');
  }
  return res.json();
}

export async function uploadFile(file: File): Promise<{ fileId: string; dataUrl: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await authFetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

/**
 * Upload raw bytes (File or Blob) to the file store and return its id only.
 *
 * Passing `key` stores the bytes under that id instead of a fresh uuid, so
 * re-uploading overwrites in place. Used for node preview assets, which would
 * otherwise leave an orphaned file behind on every run.
 */
export async function uploadImageBlob(
  blob: Blob,
  filename = 'image.png',
  key?: string,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, filename);
  if (key) formData.append('key', key);
  const res = await authFetch(`${API_BASE}/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Upload failed');
  const json = (await res.json()) as { fileId: string };
  return json.fileId;
}

/**
 * Stable URL that serves a previously uploaded asset by id.
 *
 * Assets are served with a one-year cache header, which is right for imported
 * images (a uuid never changes content) but not for preview assets, which are
 * overwritten in place. Those pass `rev` so a re-run's image isn't masked by
 * the previous session's cached copy.
 */
export function getUploadFileUrl(fileId: string, rev?: number | null): string {
  const base = `${API_BASE}/upload/${fileId}`;
  return rev ? `${base}?v=${rev}` : base;
}

// ---------------------------------------------------------------------------
// Workflow CRUD
// ---------------------------------------------------------------------------

export interface WorkflowSummary {
  id: string;
  name: string;
  icon_id?: string;
  icon_color?: string | null;
  description?: string;
  /** True when the workflow has a published template (see `data.template`). */
  has_template?: boolean;
  updated_at: string;
  created_at: string;
}

export interface WorkflowFull {
  id: string;
  name: string;
  icon_id?: string;
  icon_color?: string | null;
  description?: string;
  data: { nodes: any[]; edges: any[]; groups?: any[]; template?: any };
  created_at: string;
  updated_at: string;
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const res = await authFetch(`${API_BASE}/workflows`);
  if (!res.ok) throw new Error('Failed to list workflows');
  return res.json();
}

export async function createWorkflow(payload: {
  name?: string;
  icon_id?: string;
  icon_color?: string | null;
  description?: string;
}): Promise<WorkflowFull> {
  const res = await authFetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: payload.name || 'Untitled Workflow',
      icon_id: payload.icon_id,
      icon_color: payload.icon_color ?? null,
      description: payload.description,
    }),
  });
  if (!res.ok) throw new Error('Failed to create workflow');
  return res.json();
}

export async function getWorkflow(id: string): Promise<WorkflowFull> {
  const res = await authFetch(`${API_BASE}/workflows/${id}`);
  if (!res.ok) throw new Error('Workflow not found');
  return res.json();
}

export async function saveWorkflow(
  id: string,
  payload: { name?: string; data?: any; icon_id?: string; icon_color?: string | null; description?: string },
): Promise<void> {
  const res = await authFetch(`${API_BASE}/workflows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save workflow');
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/workflows/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete workflow');
}

export async function renameWorkflow(id: string, name: string): Promise<void> {
  await saveWorkflow(id, { name });
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export type CollectionItemKind = 'image' | 'model3d';

export interface CollectionItem {
  id: string;
  workflow_id: string | null;
  filename: string;
  /** 'model3d' items are GLB files whose picture comes from a stored thumbnail. */
  kind?: CollectionItemKind;
  has_thumb?: boolean;
  width: number | null;
  height: number | null;
  created_at: string;
  folder_id?: string | null;
  prompt?: string | null;
  seed?: number | null;
  model?: string | null;
}

export interface CollectionFolder {
  id: string;
  name: string;
  created_at: string;
  item_count: number;
}

/** Omit folderId for ALL (unfiled only). Pass folder UUID to list that folder. */
export async function listCollection(folderId?: string | null): Promise<CollectionItem[]> {
  const q =
    folderId != null && folderId !== ''
      ? `?folder_id=${encodeURIComponent(folderId)}`
      : '';
  const res = await authFetch(`${API_BASE}/collection${q}`);
  if (!res.ok) throw new Error('Failed to list collection');
  return res.json();
}

export async function listCollectionFolders(): Promise<CollectionFolder[]> {
  const res = await authFetch(`${API_BASE}/collection/folders`);
  if (!res.ok) throw new Error('Failed to list folders');
  return res.json();
}

export async function createCollectionFolder(name: string): Promise<CollectionFolder> {
  const res = await authFetch(`${API_BASE}/collection/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to create folder');
  return res.json();
}

export async function renameCollectionFolder(id: string, name: string): Promise<CollectionFolder> {
  const res = await authFetch(`${API_BASE}/collection/folders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to rename folder');
  return res.json();
}

export async function deleteCollectionFolder(
  id: string,
  mode: 'unlink' | 'delete_items',
): Promise<void> {
  const res = await authFetch(
    `${API_BASE}/collection/folders/${encodeURIComponent(id)}?mode=${mode}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error('Failed to delete folder');
}

export async function moveCollectionItems(
  ids: string[],
  folderId: string | null,
): Promise<void> {
  const res = await authFetch(`${API_BASE}/collection/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, folder_id: folderId }),
  });
  if (!res.ok) throw new Error('Failed to move images');
}

export async function deleteCollectionItem(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/collection/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete image');
}

/** The item's own file: the image, or the GLB for a 3D model. */
export async function fetchCollectionImageBlob(id: string): Promise<Blob> {
  const res = await authFetch(`${API_BASE}/collection/${id}/file`);
  if (!res.ok) throw new Error('Failed to load image');
  return res.blob();
}

/** The item's picture: the image itself, or a 3D model's stored render. */
export async function fetchCollectionThumbBlob(id: string): Promise<Blob> {
  const res = await authFetch(`${API_BASE}/collection/${id}/thumb`);
  if (!res.ok) throw new Error('Failed to load thumbnail');
  return res.blob();
}

// ---------------------------------------------------------------------------
// App info
// ---------------------------------------------------------------------------

export async function getAppVersion(): Promise<string | null> {
  const res = await authFetch(`${API_BASE}/health`);
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return typeof body?.version === 'string' ? body.version : null;
}

// ---------------------------------------------------------------------------
// User settings (fal.ai API key)
// ---------------------------------------------------------------------------

export async function getFalKeyStatus(): Promise<{
  hasKey: boolean;
  managedByEnv: boolean;
}> {
  const res = await authFetch(`${API_BASE}/user/fal-key`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail || 'Failed to load key status');
  }
  return res.json();
}

export async function setUserFalKey(apiKey: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/user/fal-key`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail || 'Failed to save API key');
  }
}

export async function clearUserFalKey(): Promise<void> {
  const res = await authFetch(`${API_BASE}/user/fal-key`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail || 'Failed to clear API key');
  }
}
