/** Studio node: lens / shot / view. Keep phrase copy in sync with `backend/nodes/text_nodes.py`. */

export type StudioLens = 'wideAngle' | 'standard' | 'telephoto' | 'macro';
export type StudioShot =
  | 'wideShot'
  | 'mediumShot'
  | 'closeUp'
  | 'extremeCloseUp'
  | 'longShot'
  | 'arrivalShot';
export type StudioView =
  | 'eyeLevel'
  | 'lowAngle'
  | 'highAngle'
  | 'birdsEye'
  | 'orthoFront'
  | 'orthoBack'
  | 'orthoLeft'
  | 'orthoRight'
  | 'orthoTop'
  | 'orthoBottom';

export const STUDIO_LENS_OPTIONS: { value: StudioLens; label: string }[] = [
  { value: 'wideAngle', label: 'Wide-angle (14–35mm)' },
  { value: 'standard', label: 'Standard (50mm)' },
  { value: 'telephoto', label: 'Telephoto (85mm+)' },
  { value: 'macro', label: 'Macro' },
];

export const STUDIO_SHOT_OPTIONS: { value: StudioShot; label: string }[] = [
  { value: 'wideShot', label: 'Wide shot' },
  { value: 'mediumShot', label: 'Medium shot' },
  { value: 'closeUp', label: 'Close-up' },
  { value: 'extremeCloseUp', label: 'Extreme close-up' },
  { value: 'longShot', label: 'Long shot' },
  { value: 'arrivalShot', label: 'Arrival shot' },
];

export const STUDIO_VIEW_ANGLE_OPTIONS: { value: StudioView; label: string }[] = [
  { value: 'eyeLevel', label: 'Eye level' },
  { value: 'lowAngle', label: 'Low angle' },
  { value: 'highAngle', label: 'High angle' },
  { value: 'birdsEye', label: "Bird's eye" },
];

export const STUDIO_VIEW_ORTHO_OPTIONS: { value: StudioView; label: string }[] = [
  { value: 'orthoFront', label: 'Front' },
  { value: 'orthoBack', label: 'Back' },
  { value: 'orthoLeft', label: 'Left' },
  { value: 'orthoRight', label: 'Right' },
  { value: 'orthoTop', label: 'Top' },
  { value: 'orthoBottom', label: 'Bottom' },
];

const LENS_PHRASES: Record<StudioLens, string> = {
  wideAngle:
    'Lens: wide-angle (14–35mm)—captures space; expect mild edge distortion.',
  standard: 'Lens: standard (50mm)—similar to human vision; neutral perspective.',
  telephoto:
    'Lens: telephoto (85mm+)—compresses distance; shallow depth of field, blurred backgrounds.',
  macro: 'Lens: macro—focuses extremely close; enlarged fine detail.',
};

const SHOT_PHRASES: Record<StudioShot, string> = {
  wideShot: 'Shot: wide shot—broad framing of the scene.',
  mediumShot: 'Shot: medium shot—balanced subject and context.',
  closeUp: 'Shot: close-up—face or key subject fills most of the frame.',
  extremeCloseUp: 'Shot: extreme close-up—tight on a small detail.',
  longShot: 'Shot: long shot—full subject in environment, readable distance.',
  arrivalShot:
    'Shot: arrival shot—emphasize the subject entering the space and establishing presence.',
};

const VIEW_PHRASES: Record<StudioView, string> = {
  eyeLevel: 'Camera: eye level.',
  lowAngle: 'Camera: low angle, looking up at the subject.',
  highAngle: 'Camera: high angle, looking down at the subject.',
  birdsEye: "Camera: bird's eye view, from above.",
  orthoFront: 'View: orthographic front (parallel projection, head-on).',
  orthoBack: 'View: orthographic back (parallel projection from behind).',
  orthoLeft: 'View: orthographic left side (parallel projection).',
  orthoRight: 'View: orthographic right side (parallel projection).',
  orthoTop: 'View: orthographic top (parallel projection, from above).',
  orthoBottom: 'View: orthographic bottom (parallel projection, from below).',
};

const DEFAULT_LENS: StudioLens = 'standard';
const DEFAULT_SHOT: StudioShot = 'mediumShot';
const DEFAULT_VIEW: StudioView = 'eyeLevel';

const ALL_LENS = new Set<string>(STUDIO_LENS_OPTIONS.map((o) => o.value));
const ALL_SHOT = new Set<string>(STUDIO_SHOT_OPTIONS.map((o) => o.value));
const ALL_VIEW = new Set<string>([
  ...STUDIO_VIEW_ANGLE_OPTIONS.map((o) => o.value),
  ...STUDIO_VIEW_ORTHO_OPTIONS.map((o) => o.value),
]);

export function normalizeStudioLens(raw: unknown): StudioLens {
  const s = String(raw || '').trim();
  return ALL_LENS.has(s) ? (s as StudioLens) : DEFAULT_LENS;
}

export function normalizeStudioShot(raw: unknown): StudioShot {
  const s = String(raw || '').trim();
  return ALL_SHOT.has(s) ? (s as StudioShot) : DEFAULT_SHOT;
}

export function normalizeStudioView(raw: unknown): StudioView {
  const s = String(raw || '').trim();
  return ALL_VIEW.has(s) ? (s as StudioView) : DEFAULT_VIEW;
}

/** Category toggles default to on when missing (existing workflows). */
export function studioIncludeLens(data: Record<string, any>): boolean {
  return data.studioIncludeLens !== false;
}

export function studioIncludeShot(data: Record<string, any>): boolean {
  return data.studioIncludeShot !== false;
}

export function studioIncludeView(data: Record<string, any>): boolean {
  return data.studioIncludeView !== false;
}

export function buildStudioOutputString(data: Record<string, any>): string {
  const lens = normalizeStudioLens(data.studioLens);
  const shot = normalizeStudioShot(data.studioShot);
  const view = normalizeStudioView(data.studioView);
  const parts: string[] = [];
  if (studioIncludeLens(data)) parts.push(LENS_PHRASES[lens]);
  if (studioIncludeShot(data)) parts.push(SHOT_PHRASES[shot]);
  if (studioIncludeView(data)) parts.push(VIEW_PHRASES[view]);
  return parts.join('\n');
}
