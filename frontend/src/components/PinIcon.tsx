interface PinIconProps {
  filled?: boolean;
  size?: number;
}

export default function PinIcon({ filled = false, size = 12 }: PinIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 1.5h4l-.6 3.2 2.1 2.1v1.4H4.5V6.8l2.1-2.1L6 1.5Z" />
      <path d="M8 8.2v6.3" fill="none" />
    </svg>
  );
}
