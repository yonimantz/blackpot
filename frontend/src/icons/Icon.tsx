import { MINGCUTE_ICONS, type MingcuteIconName } from './mingcuteIcons';

export type { MingcuteIconName };

interface IconProps {
  name: MingcuteIconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Renders one inlined MingCute icon. Bodies come from the generated
 * `mingcuteIcons.ts` map (see `scripts/fetch-icons.mjs`) — fully offline,
 * no runtime request or extra dependency. */
export default function Icon({ name, size = 16, className, style }: IconProps) {
  return (
    <svg
      className={className ? `mc-icon ${className}` : 'mc-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: MINGCUTE_ICONS[name] }}
    />
  );
}
