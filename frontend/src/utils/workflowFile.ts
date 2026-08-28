/**
 * `.blpw` (Blueprint Workflow) export / import format.
 *
 * Files are JSON written with a custom extension so they can be associated
 * with this app and visually distinguished from arbitrary `.json` exports.
 * The file embeds the workflow metadata (name, icon, description) alongside
 * the full graph payload — everything needed to reproduce the workflow in a
 * fresh project on import.
 */

import type { WorkflowFull } from './api';
import { getUploadFileUrl } from './api';
import { withoutPreviewAssetRefs } from './previewAssets';
import {
  DEFAULT_WORKFLOW_ICON_COLOR,
  DEFAULT_WORKFLOW_ICON_ID,
  WORKFLOW_ICON_PALETTE,
  isValidWorkflowIconId,
} from '../constants/workflowIcons';

export const BLPW_EXTENSION = '.blpw';
export const BLPW_FORMAT_TAG = 'blpw';
export const BLPW_FORMAT_VERSION = 1;
export const BLPW_MIME_TYPE = 'application/x-blpw+json';

export interface BlpwFile {
  format: typeof BLPW_FORMAT_TAG;
  version: number;
  name: string;
  icon_id: string;
  icon_color: string;
  description: string;
  data: { nodes: unknown[]; edges: unknown[]; groups?: unknown[] };
  exported_at: string;
}

export interface BlpwImportResult {
  name: string;
  icon_id: string;
  icon_color: string;
  description: string;
  data: { nodes: unknown[]; edges: unknown[]; groups: unknown[] };
}

const PALETTE_HEX = new Set(WORKFLOW_ICON_PALETTE.map((p) => p.hex));

function safeFileNameStem(raw: string): string {
  const trimmed = (raw || '').trim() || 'workflow';
  // Strip characters that Windows / macOS / Linux disallow in file names,
  // plus any low-ASCII control codes (looped to keep the regex literal-safe).
  let cleaned = trimmed.replace(/[\\/:*?"<>|]+/g, ' ');
  let stripped = '';
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i);
    stripped += code < 32 ? ' ' : cleaned[i];
  }
  cleaned = stripped.replace(/\s+/g, ' ').trim();
  return cleaned || 'workflow';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Make nodes portable: re-inline externalized images (`fileAssetId`) back into
 * `fileData` so the exported `.blpw` is self-contained on a machine where the
 * asset files don't exist, and drop saved-preview references, which point at
 * this install's file store and would only resolve to broken images elsewhere.
 * Previews are regenerable, so the importing machine rebuilds them on its first
 * bake or run.
 */
async function prepareNodesForExport(nodes: unknown[]): Promise<unknown[]> {
  return Promise.all(
    nodes.map(async (n) => {
      if (!isObj(n)) return n;
      if (!isObj(n.data)) return n;
      const d = withoutPreviewAssetRefs(n.data);
      const assetId = d.fileAssetId;
      if (typeof assetId !== 'string' || !assetId || d.fileData) {
        return { ...n, data: d };
      }
      try {
        const res = await fetch(getUploadFileUrl(assetId));
        if (!res.ok) return { ...n, data: d };
        const dataUrl = await blobToDataUrl(await res.blob());
        return { ...n, data: { ...d, fileData: dataUrl, fileAssetId: '' } };
      } catch {
        return { ...n, data: d };
      }
    }),
  );
}

/** Build the export payload, then download it as `<name>.blpw`. */
export async function exportWorkflowToFile(wf: WorkflowFull): Promise<void> {
  const nodes = await prepareNodesForExport(wf.data?.nodes ?? []);
  const payload: BlpwFile = {
    format: BLPW_FORMAT_TAG,
    version: BLPW_FORMAT_VERSION,
    name: wf.name || 'Untitled Workflow',
    icon_id: wf.icon_id || DEFAULT_WORKFLOW_ICON_ID,
    icon_color: wf.icon_color || DEFAULT_WORKFLOW_ICON_COLOR,
    description: wf.description ?? '',
    data: {
      nodes,
      edges: wf.data?.edges ?? [],
      groups: wf.data?.groups ?? [],
    },
    exported_at: new Date().toISOString(),
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: BLPW_MIME_TYPE });
  triggerDownload(blob, `${safeFileNameStem(payload.name)}${BLPW_EXTENSION}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a parsed `.blpw` payload and normalize it into a shape ready for
 * `createWorkflow` + `saveWorkflow`. Throws a user-readable Error on invalid
 * input.
 */
export function parseBlpwPayload(raw: unknown): BlpwImportResult {
  if (!isObj(raw)) {
    throw new Error('File is not a valid Blueprint workflow.');
  }
  if (raw.format !== BLPW_FORMAT_TAG) {
    throw new Error('Unrecognized file format. Expected a .blpw workflow.');
  }
  if (typeof raw.version !== 'number' || raw.version > BLPW_FORMAT_VERSION) {
    throw new Error('Unsupported .blpw version. Update the app and try again.');
  }
  const data = raw.data;
  if (!isObj(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('Workflow data is missing or malformed.');
  }
  const groups = Array.isArray(data.groups) ? (data.groups as unknown[]) : [];

  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : 'Untitled Workflow';

  const iconId =
    typeof raw.icon_id === 'string' && isValidWorkflowIconId(raw.icon_id)
      ? raw.icon_id
      : DEFAULT_WORKFLOW_ICON_ID;

  const iconColor =
    typeof raw.icon_color === 'string' && PALETTE_HEX.has(raw.icon_color)
      ? raw.icon_color
      : DEFAULT_WORKFLOW_ICON_COLOR;

  const description =
    typeof raw.description === 'string' ? raw.description : '';

  return {
    name,
    icon_id: iconId,
    icon_color: iconColor,
    description,
    data: {
      nodes: data.nodes as unknown[],
      edges: data.edges as unknown[],
      groups,
    },
  };
}

/** Read a File as text and parse it as a `.blpw` workflow. */
export async function readBlpwFile(file: File): Promise<BlpwImportResult> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  return parseBlpwPayload(parsed);
}
