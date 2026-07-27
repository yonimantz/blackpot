import type { CSSProperties } from 'react';

import rawSpotOnIcon from '../assets/SpotOn-Icon.svg?raw';

/** Must match backend database.py allow-list */
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

/** Single icon used for every workflow; kept for backwards compatibility. */
export const DEFAULT_WORKFLOW_ICON_ID = 'wf1';

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

const ICON_MARKUP = svgMarkupForTint(rawSpotOnIcon);

/** Valid palette hex, or null if unknown / empty (legacy rows). */
export function normalizeWorkflowIconColor(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') return null;
  return PALETTE_HEX.has(raw) ? raw : null;
}

/** Rendering and UI default: legacy null → white. */
export function resolveWorkflowIconTint(raw: string | null | undefined): string {
  return normalizeWorkflowIconColor(raw) ?? DEFAULT_WORKFLOW_ICON_COLOR;
}

function WorkflowIconImage({ iconColor }: { iconColor?: string | null }) {
  const tint = resolveWorkflowIconTint(iconColor);
  return (
    <span
      className="workflow-icon-inline-wrap"
      style={{ color: tint }}
      dangerouslySetInnerHTML={{ __html: ICON_MARKUP }}
      aria-hidden
    />
  );
}

export function WorkflowIcon({
  iconColor,
  size = 32,
  className,
  style,
}: {
  iconId?: string | null;
  iconColor?: string | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
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
      <WorkflowIconImage iconColor={iconColor} />
    </span>
  );
}

/** All icon ids are accepted now that every workflow renders the same glyph. */
export function isValidWorkflowIconId(id: string): boolean {
  return typeof id === 'string' && id.length > 0;
}
