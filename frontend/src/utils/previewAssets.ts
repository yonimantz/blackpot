/**
 * Persisting node previews as files instead of graph data.
 *
 * `stripTransientNodeData` drops every image-bearing field before a workflow is
 * saved, because inlining base64 into `workflows.data` is what made autosave
 * and tab switching slow. The cost of that is real though: a reload used to
 * come back with empty previews, since only bakes rooted in an Import Image
 * node can re-derive themselves.
 *
 * So previews take the same route imported images already do — bytes go to the
 * file store, the graph keeps a short id. The workflow JSON stays tiny (which
 * was the whole point) and previews come back on load as ordinary cached HTTP
 * image loads, off the main thread.
 *
 * Pixel dimensions are preserved rather than downscaled to thumbnail size. The
 * saved copy stands in for the live value after a reload, and node logic reads
 * real sizes off it — crop rectangles, resize placement, the source-size
 * readouts. A 512px stand-in would silently corrupt all of those. WebP keeps
 * the file roughly a tenth of the PNG a run produces, and keeps alpha.
 */

import { uploadImageBlob } from './api';
import { dataUrlToBlob } from './imageObjectUrl';
import { getNodeImageOutputDataUrl } from './upstreamImage';

/** Marks an upload as a regenerable preview, so the backend sweep may collect it. */
export const PREVIEW_ASSET_KEY_PREFIX = 'pv-';

const PREVIEW_ASSET_QUALITY = 0.9;

/** Slot key for a node's single image output; divider handles use their handle id. */
export const DEFAULT_PREVIEW_SLOT = '';

const KEY_UNSAFE = /[^A-Za-z0-9_-]/g;

/**
 * Upload key for one preview slot. Derived from the owning workflow and node so
 * re-running overwrites the same file, and so the backend sweep can tell which
 * files no longer belong to anything.
 */
export function previewAssetUploadKey(
  workflowId: string,
  nodeId: string,
  slot: string,
): string {
  const parts = [
    PREVIEW_ASSET_KEY_PREFIX + workflowId.replace(KEY_UNSAFE, ''),
    nodeId.replace(KEY_UNSAFE, ''),
  ];
  if (slot) parts.push(slot.replace(KEY_UNSAFE, ''));
  return parts.join('-');
}

/**
 * The images on a node worth saving, keyed by slot. Resolved through the same
 * function the UI renders from, so what gets saved is exactly what was on
 * screen. Anything already externalized (an import's `fileAssetId`, or a
 * previously saved preview) resolves to an http URL and is skipped.
 */
export function collectPersistablePreviews(
  data: Record<string, any> | undefined,
): Record<string, string> {
  const slots: Record<string, string> = {};
  if (!data) return slots;

  const own = getNodeImageOutputDataUrl(data);
  if (typeof own === 'string' && own.startsWith('data:')) {
    slots[DEFAULT_PREVIEW_SLOT] = own;
  }

  const perHandle = data._dividerOutputs;
  if (perHandle && typeof perHandle === 'object' && !Array.isArray(perHandle)) {
    for (const [handleId, value] of Object.entries(perHandle as Record<string, unknown>)) {
      if (typeof value === 'string' && value.startsWith('data:')) {
        slots[handleId] = value;
      }
    }
  }

  return slots;
}

function extForMime(mime: string): string {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/gif') return 'gif';
  return 'png';
}

/**
 * Re-encode a preview data URL as WebP at its original pixel dimensions.
 * Falls back to the raw decoded bytes whenever the browser can't do the
 * re-encode — a bigger file still beats losing the preview.
 */
async function encodePreviewAsset(dataUrl: string): Promise<Blob | null> {
  const raw = dataUrlToBlob(dataUrl);
  if (!raw) return null;
  if (typeof OffscreenCanvas === 'undefined') return raw;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(raw);
  } catch {
    return raw;
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return raw;
    ctx.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({
      type: 'image/webp',
      quality: PREVIEW_ASSET_QUALITY,
    });
  } catch {
    return raw;
  } finally {
    bitmap.close();
  }
}

/**
 * Write one preview slot to the file store, returning the id it can be served
 * by (or null if encoding or the upload failed — the caller just keeps the
 * in-memory copy and tries again on the next change).
 */
export async function uploadPreviewSlot(
  workflowId: string,
  nodeId: string,
  slot: string,
  dataUrl: string,
): Promise<string | null> {
  const blob = await encodePreviewAsset(dataUrl);
  if (!blob) return null;
  const key = previewAssetUploadKey(workflowId, nodeId, slot);
  try {
    return await uploadImageBlob(blob, `${key}.${extForMime(blob.type)}`, key);
  } catch {
    return null;
  }
}

/** Node data fields that carry an image, and so warrant re-saving the preview. */
export const PREVIEW_BEARING_FIELDS: ReadonlySet<string> = new Set([
  'previewData',
  '_result',
  '_editorPreview',
  '_compositorPreview',
  '_cropPreview',
  '_rotatePreview',
  '_maskPreview',
  '_combinePreview',
  '_vignettePreview',
  '_blurPreview',
  '_stackPreview',
  '_keyColorBaked',
  '_removeBgBaked',
  '_resizePreview',
  '_dividerOutputs',
]);

/** Fields holding saved-preview references, dropped when a node is cloned or exported. */
export const PREVIEW_ASSET_FIELDS = [
  'previewAssetId',
  'previewAssetIds',
  'previewAssetRev',
] as const;

/**
 * Strip saved-preview references from node data. Clones need this because the
 * upload key is derived from the node id — a copy that kept the original's id
 * would overwrite the original's file on its next bake. Exports need it because
 * the files live in this install's store and nowhere else.
 */
export function withoutPreviewAssetRefs<T extends Record<string, any>>(data: T): T {
  let out: Record<string, any> | null = null;
  for (const field of PREVIEW_ASSET_FIELDS) {
    if (field in data) {
      out = out ?? { ...data };
      delete out[field];
    }
  }
  return (out ?? data) as T;
}
