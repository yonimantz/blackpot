/**
 * Registry mapping a Preview 3D node id to a function that captures its
 * current WebGL view as a PNG data URL.
 *
 * The backend has no 3D renderer, so a `preview3d` node's "Image" output can
 * only ever be produced by the browser. `BaseNode.tsx` registers a capture
 * function while the node's `Model3dViewer` is mounted; `upstreamImage.ts`
 * (live wiring / group runs) and `workflowStore.ts` (full workflow runs) call
 * `captureModel3dImage` to pull a fresh snapshot on demand.
 */

type CaptureFn = () => string | null;

const registry = new Map<string, CaptureFn>();

export function registerModel3dCapture(nodeId: string, fn: CaptureFn): void {
  registry.set(nodeId, fn);
}

/** Only removes the entry if it still belongs to `fn`, guarding against an unmount/mount race. */
export function unregisterModel3dCapture(nodeId: string, fn: CaptureFn): void {
  if (registry.get(nodeId) === fn) registry.delete(nodeId);
}

export function captureModel3dImage(nodeId: string): string | null {
  const fn = registry.get(nodeId);
  return fn ? fn() : null;
}
