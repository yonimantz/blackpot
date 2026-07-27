import type { WorkflowTemplate } from '../types/templateTypes';
import { templateEntryLabel } from '../types/templateTypes';
import { getConnectedImageDataUrl, getNodeImageOutputDataUrl } from './upstreamImage';

export interface TemplateOutputResolved {
  nodeId: string;
  label: string;
  images: string[];
}

export interface TemplateLightboxImage {
  src: string;
  label: string;
  filename: string;
}

function imageFromOutputNode(
  node: { id: string; type?: string; data?: Record<string, any> },
  edges: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[],
  allNodes: { id: string; data?: Record<string, any> }[],
): string | null {
  if (node.type === 'preview') {
    const wired = getConnectedImageDataUrl(node.id, 'image', edges, allNodes);
    if (wired) return wired;
    const data = node.data ?? {};
    if (typeof data.previewData === 'string' && data.previewData) return data.previewData;
    const runImg = data._result?.image;
    if (typeof runImg === 'string' && runImg) return runImg;
    return null;
  }

  if (node.type === 'exportImage') {
    const count = Math.max(1, Number(node.data?.imageCount) || 1);
    for (let i = 1; i <= count; i++) {
      const handle = `image${i}`;
      const wired = getConnectedImageDataUrl(node.id, handle, edges, allNodes);
      if (wired) return wired;
    }
    return null;
  }

  return getNodeImageOutputDataUrl(node.data);
}

/** Collect display images for each pinned template output after a workflow run. */
export function resolveTemplateOutputImages(
  template: WorkflowTemplate | null | undefined,
  nodes: { id: string; type?: string; data?: Record<string, any> }[],
  edges: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[],
): TemplateOutputResolved[] {
  if (!template?.outputs?.length) return [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const resolved: TemplateOutputResolved[] = [];

  for (const out of template.outputs) {
    const node = nodeById.get(out.nodeId);
    if (!node) continue;

    const label = templateEntryLabel(node, out.label);
    const images: string[] = [];

    if (node.type === 'exportImage') {
      const count = Math.max(1, Number(node.data?.imageCount) || 1);
      for (let i = 1; i <= count; i++) {
        const handle = `image${i}`;
        const wired = getConnectedImageDataUrl(node.id, handle, edges, nodes);
        if (wired) images.push(wired);
      }
    } else {
      const img = imageFromOutputNode(node, edges, nodes);
      if (img) images.push(img);
    }

    resolved.push({ nodeId: out.nodeId, label, images });
  }

  return resolved;
}

/** Flatten template output groups into lightbox entries (stable order). */
export function templateOutputsToLightboxImages(
  outputs: TemplateOutputResolved[],
): TemplateLightboxImage[] {
  const items: TemplateLightboxImage[] = [];
  for (const out of outputs) {
    out.images.forEach((src, i) => {
      const suffix = out.images.length > 1 ? `-${i + 1}` : '';
      const safe = out.label.replace(/[^\w\-]+/g, '_').slice(0, 48) || 'output';
      items.push({
        src,
        label: out.images.length > 1 ? `${out.label} (${i + 1})` : out.label,
        filename: `${safe}${suffix}.png`,
      });
    });
  }
  return items;
}
