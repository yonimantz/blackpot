import type { MingcuteIconName } from '../icons/mingcuteIcons';

/** MingCute icons for left palette category headers (replaces colored dots). */
export const PALETTE_CATEGORY_ICONS: Partial<Record<string, MingcuteIconName>> = {
  general: 'pencil-fill',
  io: 'battery-automotive-fill',
  tool: 'tool-fill',
  text: 'text-2-fill',
  value: 'hashtag-fill',
  read: 'layout-top-open-line',
  ai: 'ai-fill',
};

export function paletteCategoryIcon(categoryKey: string): MingcuteIconName | undefined {
  return PALETTE_CATEGORY_ICONS[categoryKey];
}
