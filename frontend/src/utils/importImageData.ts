import { getUploadFileUrl, uploadImageBlob } from './api';
import { dataUrlToBlob } from './imageObjectUrl';

/** Read a File/Blob as a base64 data URL (fallback path when upload fails). */
export function readFileAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Build the `data` fields for an Import Image node from raw bytes.
 *
 * Prefers externalizing the image to the file store (so the graph JSON stays
 * tiny — the whole point of the perf work) and keeps only a `fileAssetId`
 * reference. If the upload fails (e.g. backend not reachable yet), it falls
 * back to inlining base64 so importing still works offline; that inline copy
 * gets migrated to an asset on the next load.
 */
export async function buildImportImageData(
  file: File | Blob,
  filePath: string,
): Promise<Record<string, any>> {
  const name = filePath || 'image.png';
  try {
    const fileId = await uploadImageBlob(file, name);
    return { fileAssetId: fileId, fileData: '', filePath: name };
  } catch {
    const dataUrl = await readFileAsDataURL(file);
    return { fileData: dataUrl, fileAssetId: '', filePath: name };
  }
}

/**
 * Upload an inline base64 data URL to the file store, returning the new asset
 * id (or null on failure). Used by the one-time migration that externalizes
 * images embedded in legacy workflows.
 */
function extForMime(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'png';
}

export async function uploadDataUrlAsAsset(dataUrl: string): Promise<string | null> {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return null;
  try {
    return await uploadImageBlob(blob, `image.${extForMime(blob.type)}`);
  } catch {
    return null;
  }
}

/**
 * Confirm an uploaded asset can actually be served back. Used by the migration
 * so we never drop the inline `fileData` copy when the serving route isn't
 * available yet (e.g. an older backend that hasn't been restarted).
 */
export async function assetIsReachable(fileId: string): Promise<boolean> {
  try {
    const res = await fetch(getUploadFileUrl(fileId));
    return res.ok;
  } catch {
    return false;
  }
}
