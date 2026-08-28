import { useEffect, useState } from 'react';

/**
 * Decode a `data:` URL into a Blob without allocating a giant intermediate
 * string graph. Returns null if the input isn't a parseable data URL.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const header = dataUrl.slice(5, comma); // strip leading "data:"
  const isBase64 = /;base64$/i.test(header);
  const mime = header.replace(/;base64$/i, '') || 'application/octet-stream';
  const payload = dataUrl.slice(comma + 1);

  try {
    if (isBase64) {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  } catch {
    return null;
  }
}

/**
 * Render large images via an object URL instead of passing a multi-megabyte
 * base64 `data:` string straight into `<img src>`. Object URLs are tiny
 * strings, so React reconciliation and DOM diffing stay cheap, and the browser
 * keeps a single decoded bitmap. The object URL is revoked when the source
 * changes or the component unmounts.
 *
 * Plain (non-data) URLs are passed through untouched — which is exactly what
 * the externalized-asset path (Phase 5) produces.
 */
export function useImageObjectUrl(src: string | null | undefined): string {
  const [resolved, setResolved] = useState<string>(() =>
    src && !src.startsWith('data:') ? src : '',
  );

  useEffect(() => {
    if (!src) {
      setResolved('');
      return;
    }
    if (!src.startsWith('data:')) {
      setResolved(src);
      return;
    }
    const blob = dataUrlToBlob(src);
    if (!blob) {
      setResolved(src);
      return;
    }
    const objUrl = URL.createObjectURL(blob);
    setResolved(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [src]);

  return resolved;
}

export function mimeFromFilename(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return null;
}

export async function blobToPngBlob(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas context');
    ctx.drawImage(bmp, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    return png;
  } finally {
    bmp.close();
  }
}

export async function copyImageToClipboard(blob: Blob, filename: string): Promise<void> {
  let mime = blob.type;
  if (!mime?.startsWith('image/')) {
    mime = mimeFromFilename(filename) || 'image/png';
    blob = new Blob([await blob.arrayBuffer()], { type: mime });
  }

  const write = (b: Blob, type: string) =>
    navigator.clipboard.write([new ClipboardItem({ [type]: Promise.resolve(b) })]);

  try {
    await write(blob, mime);
    return;
  } catch {
    /* WebP / odd types often rejected; PNG is widely accepted */
  }

  if (mime !== 'image/png') {
    const png = await blobToPngBlob(blob);
    await write(png, 'image/png');
    return;
  }

  throw new Error('clipboard write failed');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Fetch a remote or data URL into a Blob for copy/download. */
export async function imageSrcToBlob(src: string, fallbackFilename: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const blob = dataUrlToBlob(src);
    if (blob) return blob;
    throw new Error('invalid data URL');
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error('fetch failed');
  const blob = await res.blob();
  if (blob.type?.startsWith('image/')) return blob;
  const mime = mimeFromFilename(fallbackFilename) || 'image/png';
  return new Blob([await blob.arrayBuffer()], { type: mime });
}

/**
 * Turn any preview src (data URL, `/api/upload/{id}`, remote URL) into a
 * `data:` URL the backend can decode. Saved images now live in the file store
 * and resolve to HTTP paths; fal upload still needs the actual bytes.
 */
export async function imageSrcToDataUrl(src: string): Promise<string> {
  if (src.startsWith('data:')) return src;
  const blob = await imageSrcToBlob(src, 'image.png');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not encode image'));
    reader.readAsDataURL(blob);
  });
}
