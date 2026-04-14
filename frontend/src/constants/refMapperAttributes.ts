import type { Edge, Node } from '@xyflow/react';
import { buildStudioOutputString } from './studioAttributes';

export interface RefMapperAttribute {
  id: string;
  label: string;
  /** Use `{n}` for the reference image index (1–14). */
  phrase: string;
}

export interface RefMapperEntry {
  id: string;
  imageIndex: number;
  attributes: string[];
}

export const REFMAPPER_MAX_IMAGE_INDEX = 14;
export const REFMAPPER_MAX_ENTRIES = 14;

export const REFMAPPER_OPENING_LINE =
  'Take from the following references only what is mentioned below.';

export const REFMAPPER_ATTRIBUTES_ORDERED: RefMapperAttribute[] = [
  {
    id: 'pose',
    label: 'Pose',
    phrase: 'From image {n}, use the pose as reference for the subject.',
  },
  {
    id: 'colorPalette',
    label: 'Color palette',
    phrase:
      'From image {n}, take the color palette—hue relationships, saturation, and value—and apply that same structure to the result.',
  },
  {
    id: 'brushwork',
    label: 'Brushwork',
    phrase:
      'From image {n}, analyze the brushwork and the painting style and reproduce them as faithfully as possible in the output.',
  },
  {
    id: 'composition',
    label: 'Composition',
    phrase:
      'From image {n}, analyze the composition and use it as a guide for framing, balance, and spatial arrangement in the result.',
  },
  {
    id: 'atmosphere',
    label: 'Atmosphere',
    phrase:
      'From image {n}, capture the atmosphere, mood, and overall feel, and carry that same sensibility into the result.',
  },
];

const BY_ID: Record<string, RefMapperAttribute> = Object.fromEntries(
  REFMAPPER_ATTRIBUTES_ORDERED.map((a) => [a.id, a]),
);

const LEGACY_ATTR_MAP: Record<string, string> = {
  composition: 'composition',
  pose: 'pose',
  atmosphere: 'atmosphere',
  painterlyStyle: 'brushwork',
  colorsPalette: 'colorPalette',
};

const ORDERED_IDS = REFMAPPER_ATTRIBUTES_ORDERED.map((a) => a.id);

export function newRefMapperEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function clampImageIndex(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(REFMAPPER_MAX_IMAGE_INDEX, Math.max(1, Math.round(n)));
}

function migrateEntryRow(raw: unknown): RefMapperEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id =
    typeof o.id === 'string' && o.id.length > 0 ? o.id : newRefMapperEntryId();
  const imageIndex = clampImageIndex(Number(o.imageIndex));
  const attrsIn = Array.isArray(o.attributes) ? o.attributes : [];
  const attributes = ORDERED_IDS.filter((aid) =>
    attrsIn.some((x) => String(x) === aid),
  );
  return { id, imageIndex, attributes };
}

function legacyToEntries(data: Record<string, any>): RefMapperEntry[] {
  const rawCount = Number(data.refImageCount) || 2;
  const refCount = Math.min(8, Math.max(1, rawCount));
  const refAttrs =
    data.refAttributes && typeof data.refAttributes === 'object'
      ? (data.refAttributes as Record<string, string[]>)
      : {};
  const out: RefMapperEntry[] = [];
  for (let i = 1; i <= refCount; i++) {
    const key = String(i);
    let ids = refAttrs[key];
    if (!Array.isArray(ids)) ids = [];
    const mapped = ORDERED_IDS.filter((aid) =>
      ids.some((oldId) => LEGACY_ATTR_MAP[String(oldId)] === aid),
    );
    if (mapped.length === 0) continue;
    out.push({
      id: `legacy-slot-${i}`,
      imageIndex: clampImageIndex(i),
      attributes: mapped,
    });
  }
  return out;
}

/** Normalized entries for UI and text building (legacy `refAttributes` / `refImageCount` supported). */
export function normalizeRefMapperEntries(data: Record<string, any>): RefMapperEntry[] {
  if (Array.isArray(data.refMapperEntries)) {
    return data.refMapperEntries
      .map((r) => migrateEntryRow(r))
      .filter((e): e is RefMapperEntry => e != null);
  }
  if (
    (data.refAttributes && typeof data.refAttributes === 'object') ||
    data.refImageCount != null
  ) {
    return legacyToEntries(data);
  }
  return [];
}

function lineForAttribute(attrId: string, imageIndex: number): string {
  const meta = BY_ID[attrId];
  if (!meta) return '';
  return meta.phrase.replace(/\{n\}/g, String(imageIndex));
}

/** Reference-instruction text only (no base prompt). Wire the output into Combine Prompts with your main prompt. */
export function buildRefMapperOutputString(data: Record<string, any>): string {
  const entries = normalizeRefMapperEntries(data);
  const lines: string[] = [];
  for (const entry of entries) {
    const n = clampImageIndex(entry.imageIndex);
    for (const aid of ORDERED_IDS) {
      if (!entry.attributes.includes(aid)) continue;
      const line = lineForAttribute(aid, n);
      if (line) lines.push(line);
    }
  }
  if (lines.length === 0) return '';
  return [REFMAPPER_OPENING_LINE, '', ...lines].join('\n');
}

export const SKETCH2_FINAL_OPENING_LINE = 'Render this sketch into a polished version';

/** Always appended at the end of the Sketch2Final template block (exact wording for the model). */
export const SKETCH2_FINAL_REMOVE_SOURCE_LINES = 'remove all visible lineart and sketch lines';

export type Sketch2FinalLevel = 'scratch' | 'rough' | 'detailed';

const SKETCH2_FINAL_LEVEL_PARAGRAPHS: Record<Sketch2FinalLevel, string> = {
  scratch: 'This is a doodle sketch. Use for high-level direction only.',
  rough: 'This is a rough sketch. Use as a core guide.',
  detailed: 'This is a high detailed sketch. Replicate all linework with 100% accuracy.',
};

function normalizeSketch2FinalLevel(data: Record<string, any>): Sketch2FinalLevel {
  const raw = String(data.sketchLevel || 'rough').toLowerCase();
  if (raw === 'scratch' || raw === 'rough' || raw === 'detailed') return raw;
  return 'rough';
}

/** Local prompt text (on-node / inspector); supports legacy `fallbackPrompt`. */
export function sketch2FinalLocalPrompt(data: Record<string, any>): string {
  const v = data.value ?? data.fallbackPrompt;
  return String(v ?? '').trim();
}

/** Sketch instructions only (level + colored toggle + {@link SKETCH2_FINAL_REMOVE_SOURCE_LINES}). */
export function buildSketch2FinalSketchBlock(data: Record<string, any>): string {
  const level = normalizeSketch2FinalLevel(data);
  const para = SKETCH2_FINAL_LEVEL_PARAGRAPHS[level];
  const colorClause = data.coloredSketch ? 'Use color from sketch' : 'Color it professionally';
  return `${para} ${colorClause}. ${SKETCH2_FINAL_REMOVE_SOURCE_LINES}`;
}

export function buildSketch2FinalOutputString(
  data: Record<string, any>,
  basePrompt: string,
): string {
  const body = (basePrompt || '').trim();
  const sketchBlock = buildSketch2FinalSketchBlock(data);
  const parts = [SKETCH2_FINAL_OPENING_LINE];
  if (body) parts.push(body);
  parts.push(sketchBlock);
  return parts.join('\n\n');
}

/** Resolve live string output for a node (prompt, Sketch2Final, RefMapper, Combine Prompts, etc.). */
export function resolveUpstreamTextOutput(
  nodeId: string,
  edges: Edge[],
  nodes: Node[],
  visited: Set<string> = new Set(),
): string {
  if (visited.has(nodeId)) return '';
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return '';

  const d = (node.data || {}) as Record<string, any>;

  if (node.type === 'refMapper') {
    visited.add(nodeId);
    const out = buildRefMapperOutputString(d);
    visited.delete(nodeId);
    return out;
  }

  if (node.type === 'studio') {
    visited.add(nodeId);
    const out = buildStudioOutputString(d);
    visited.delete(nodeId);
    return out;
  }

  if (node.type === 'sketch2Final') {
    visited.add(nodeId);
    const promptEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'prompt');
    let base = '';
    if (promptEdge) {
      base = resolveUpstreamTextOutput(promptEdge.source, edges, nodes, new Set(visited)).trim();
    }
    if (!base) base = sketch2FinalLocalPrompt(d);
    visited.delete(nodeId);
    return buildSketch2FinalOutputString(d, base);
  }

  if (node.type === 'combinePrompts') {
    visited.add(nodeId);
    const inputCount = Math.max(2, Number(d.inputCount) || 2);
    const separator = typeof d.separator === 'string' ? d.separator : '\n';
    const parts: string[] = [];
    for (let i = 1; i <= inputCount; i++) {
      const te = edges.find((e) => e.target === nodeId && e.targetHandle === `text${i}`);
      if (te) {
        const piece = resolveUpstreamTextOutput(te.source, edges, nodes, new Set(visited)).trim();
        if (piece) parts.push(piece);
      }
    }
    visited.delete(nodeId);
    return parts.join(separator);
  }

  visited.add(nodeId);
  const v = d.value ?? d.text ?? d.combined;
  if (v != null && String(v).length > 0) return String(v);
  return '';
}
