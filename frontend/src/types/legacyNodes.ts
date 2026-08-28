/**
 * Node types removed when SpotOn moved to fal.ai as its only provider.
 * Keep in sync with `LEGACY_NODES` in backend/nodes/ai_nodes.py.
 *
 * Saved workflows are JSON graphs, so deleting a node type outright would leave
 * old graphs with nodes that have no component to render and no ports to hang
 * their edges on — the edges would be silently dropped on load. Instead these
 * types stay registered with their original port shape: the node still draws,
 * still keeps its wiring, and says which FAL AI model to switch to. It just
 * cannot be added to a new graph, and it fails the run with the same message.
 */

export interface LegacyNodeInfo {
  /** Name the node had before it was removed. */
  label: string;
  /** Model to pick on the FAL AI node that replaces it. */
  replacementModel: string;
}

export const LEGACY_NODE_TYPES: Record<string, LegacyNodeInfo> = {
  nanoBananaPro: { label: 'Nano Banana Pro', replacementModel: 'Nano Banana Pro' },
  nanoBanana2: { label: 'Nano Banana 2', replacementModel: 'Nano Banana' },
  nanoBanana2Free: { label: 'Nano Banana 2 Free', replacementModel: 'Nano Banana' },
  gptImage2: { label: 'GPT Image 2', replacementModel: 'FLUX.1 [dev]' },
};

export function isLegacyNodeType(type: string | undefined): boolean {
  return !!type && type in LEGACY_NODE_TYPES;
}

export function getLegacyNodeInfo(type: string | undefined): LegacyNodeInfo | undefined {
  return type ? LEGACY_NODE_TYPES[type] : undefined;
}

/** Matches the backend error text so the canvas and a run agree. */
export function legacyNodeMessage(type: string): string {
  const info = LEGACY_NODE_TYPES[type];
  if (!info) return '';
  return `"${info.label}" was removed when SpotOn moved to fal.ai only. Replace it with a FAL AI node set to "${info.replacementModel}".`;
}
