import { fetchCollectionImageBlob } from './api';

const urlById = new Map<string, Promise<string>>();

/** Session-persistent object URL for a collection image (fetched at most once per id). */
export function getCollectionImageObjectUrl(imageId: string): Promise<string> {
  let pending = urlById.get(imageId);
  if (!pending) {
    pending = (async () => {
      const blob = await fetchCollectionImageBlob(imageId);
      return URL.createObjectURL(blob);
    })();
    urlById.set(imageId, pending);
  }
  return pending;
}

export function invalidateCollectionImageCache(imageId: string): void {
  const pending = urlById.get(imageId);
  urlById.delete(imageId);
  if (pending) {
    void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
  }
}
