import type { CSSProperties, ReactElement } from 'react';

import raw1 from '@assets/1.svg?raw';
import raw2 from '@assets/2.svg?raw';
import raw3 from '@assets/3.svg?raw';
import raw4 from '@assets/4.svg?raw';
import raw5 from '@assets/5.svg?raw';
import raw6 from '@assets/6.svg?raw';
import raw7 from '@assets/7.svg?raw';
import raw8 from '@assets/8.svg?raw';
import raw9 from '@assets/9.svg?raw';

/** Must match backend database.py / firestore_backend.py allow-list */
export const DEFAULT_WORKFLOW_ICON_COLOR = '#ffffff';

export const WORKFLOW_ICON_PALETTE: { id: string; label: string; hex: string }[] = [
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'violet', label: 'Violet', hex: '#c4b5fd' },
  { id: 'mint', label: 'Mint', hex: '#6ee7b7' },
  { id: 'amber', label: 'Amber', hex: '#fcd34d' },
  { id: 'pink', label: 'Pink', hex: '#f9a8d4' },
  { id: 'sky', label: 'Sky', hex: '#7dd3fc' },
  { id: 'coral', label: 'Coral', hex: '#fca5a5' },
  { id: 'silver', label: 'Silver', hex: '#e5e7eb' },
];

const PALETTE_HEX = new Set(WORKFLOW_ICON_PALETTE.map((p) => p.hex));

/** Must match backend defaults in database.py / firestore_backend.py */
export const DEFAULT_WORKFLOW_ICON_ID = 'wf1';

const WORKFLOW_ICON_RAW = [raw1, raw2, raw3, raw4, raw5, raw6, raw7, raw8, raw9] as const;

/** Map old 16-icon ids to tile index (0–8) for existing workflows */
const LEGACY_ICON_INDEX: Record<string, number> = {
  cauldron: 0,
  potion: 1,
  mortar: 2,
  crystal: 3,
  scroll: 4,
  moon: 5,
  wand: 6,
  flame: 7,
  alembic: 8,
  herb: 0,
  pentacle: 1,
  raven: 2,
  book: 3,
  candle: 4,
  venom: 5,
  stars: 6,
};

function stripSvgPreamble(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .trim();
}

/** Inline SVG uses currentColor so tints match the glyph shape. */
function svgMarkupForTint(raw: string): string {
  const body = stripSvgPreamble(raw);
  return body.replace(/fill="#000000"/gi, 'fill="currentColor"');
}

export const WORKFLOW_ICONS: {
  id: string;
  label: string;
  Icon: () => ReactElement;
}[] = [
  { id: 'wf1', label: 'Cauldron', Icon: () => <WorkflowIconImage index={0} /> },
  { id: 'wf2', label: 'Elixir', Icon: () => <WorkflowIconImage index={1} /> },
  { id: 'wf3', label: 'Crescent', Icon: () => <WorkflowIconImage index={2} /> },
  { id: 'wf4', label: 'Crystal', Icon: () => <WorkflowIconImage index={3} /> },
  { id: 'wf5', label: 'Tome', Icon: () => <WorkflowIconImage index={4} /> },
  { id: 'wf6', label: 'Wand', Icon: () => <WorkflowIconImage index={5} /> },
  { id: 'wf7', label: 'Flame', Icon: () => <WorkflowIconImage index={6} /> },
  { id: 'wf8', label: 'Herb', Icon: () => <WorkflowIconImage index={7} /> },
  { id: 'wf9', label: 'Stars', Icon: () => <WorkflowIconImage index={8} /> },
];

/** Valid palette hex, or null if unknown / empty (legacy rows). */
export function normalizeWorkflowIconColor(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  return PALETTE_HEX.has(raw) ? raw : null;
}

/** Rendering and UI default: legacy null → white. */
export function resolveWorkflowIconTint(raw: string | null | undefined): string {
  return normalizeWorkflowIconColor(raw) ?? DEFAULT_WORKFLOW_ICON_COLOR;
}

function WorkflowIconImage({
  index,
  iconColor,
}: {
  index: number;
  iconColor?: string | null;
}) {
  const safe = Math.min(Math.max(0, index), WORKFLOW_ICON_RAW.length - 1);
  const raw = WORKFLOW_ICON_RAW[safe];
  const tint = resolveWorkflowIconTint(iconColor);

  return (
    <span
      className="workflow-icon-inline-wrap"
      style={{ color: tint }}
      dangerouslySetInnerHTML={{ __html: svgMarkupForTint(raw) }}
      aria-hidden
    />
  );
}

const ICON_MAP = Object.fromEntries(WORKFLOW_ICONS.map((e) => [e.id, e.Icon]));

function resolveSpriteIndex(iconId: string | null | undefined): number {
  if (!iconId) return 0;
  const idx = WORKFLOW_ICONS.findIndex((e) => e.id === iconId);
  if (idx >= 0) return idx;
  if (iconId in LEGACY_ICON_INDEX) return LEGACY_ICON_INDEX[iconId];
  return 0;
}

export function WorkflowIcon({
  iconId,
  iconColor,
  size = 32,
  className,
  style,
}: {
  iconId: string | null | undefined;
  iconColor?: string | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const index = resolveSpriteIndex(iconId);
  return (
    <span
      className={`workflow-sprite-wrap${className ? ` ${className}` : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        fontSize: size,
        lineHeight: 1,
        ...style,
      }}
    >
      <WorkflowIconImage index={index} iconColor={iconColor} />
    </span>
  );
}

export function isValidWorkflowIconId(id: string): boolean {
  return id in ICON_MAP || id in LEGACY_ICON_INDEX;
}
