import type { MingcuteIconName } from '../icons/mingcuteIcons';

/**
 * MingCute icon for each key in `NODE_TYPE_DEFINITIONS` (see
 * Rendered on canvas context menu and inspector header — tinted with the node's
 * category color. Node headers and the left palette are label-only (no icons).
 * Legacy / model-variant node types fall through to `CATEGORY_ICONS` below.
 */
export const NODE_TYPE_ICONS: Record<string, MingcuteIconName> = {
  note: 'notebook-2-line',
  prompt: 'textbox-line',
  combinePrompts: 'text-2-line',
  refMapper: 'directions-line',
  sketch2Final: 'brush-2-line',
  studio: 'camera-2-line',

  importImage: 'upload-2-line',
  import3d: 'upload-2-line',
  exportImage: 'download-2-line',
  export3d: 'download-2-line',
  preview: 'eye-line',
  preview3d: 'group-line',

  resize: 'scale-line',
  crop: 'frame-line',
  blur: 'eye-close-line',
  rotate: 'flip-horizontal-line',
  getChannel: 'color-filter-line',
  setMask: 'face-mask-line',
  keyColor: 'color-picker-line',
  removeBg: 'eraser-line',
  simpleCombine: 'layer-line',
  stackImages: 'layers-line',
  divider: 'columns-2-line',
  editor: 'edit-2-line',
  compositor: 'layout-line',
  vignette: 'sun-line',
  adjustments: 'color-filter-line',

  numberValue: 'asterisk-line',
  colorValue: 'palette-line',
  math: 'formula-line',
  boolean: 'checkbox-line',
  getImageSize: 'rectangle-line',
  getColorPalette: 'palette-2-line',
  pickRandom: 'shuffle-2-line',

  imageScfPrompt: 'pic-ai-line',
  falAi: 'sparkles-2-line',
  imageTo3d: 'vector-group-line',
  upscaler: 'zoom-in-line',
};

/** Fallback icon by category, for node types not listed above (legacy nodes). */
export const CATEGORY_ICONS: Record<string, MingcuteIconName> = {
  general: 'dot-circle-line',
  io: 'transfer-line',
  tool: 'tool-line',
  text: 'text-line',
  value: 'asterisk-line',
  read: 'search-line',
  ai: 'sparkles-2-line',
};

export function iconForNodeType(type: string | undefined, category: string | undefined): MingcuteIconName {
  if (type && NODE_TYPE_ICONS[type]) return NODE_TYPE_ICONS[type];
  if (category && CATEGORY_ICONS[category]) return CATEGORY_ICONS[category];
  return 'dot-circle-line';
}
