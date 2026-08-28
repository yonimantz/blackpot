import Icon from '../icons/Icon';
import {
  ANCHOR_ICONS,
  ANCHOR_LABELS,
  ANCHOR_ROWS,
  type AnchorPosition,
  type CropAnchor,
} from '../utils/anchorPlacement';

/** Larger nudge when the user holds Shift on an offset arrow. */
const OFFSET_SHIFT_STEP = 10;

/**
 * 3×3 grid for picking the anchor point — corners, middle edges and center.
 * Rendered both inside node bodies (`compact`) and in the inspector / modals.
 */
export function AnchorPicker({
  value,
  onChange,
  disabled,
  compact,
  inNode,
}: {
  value: CropAnchor;
  onChange: (anchor: AnchorPosition) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Adds the React Flow escape classes so clicks don't drag the node. */
  inNode?: boolean;
}) {
  const guard = inNode ? ' nopan nodrag' : '';
  return (
    <div
      className={`anchor-picker${compact ? ' compact' : ''}`}
      role="group"
      aria-label="Anchor"
      onMouseDown={inNode ? (e) => e.stopPropagation() : undefined}
    >
      {ANCHOR_ROWS.map((row, rowIndex) => (
        <div className="anchor-picker-row" key={rowIndex}>
          {row.map((anchor) => (
            <button
              key={anchor}
              type="button"
              className={`anchor-cell${value === anchor ? ' on' : ''}${guard}`}
              title={ANCHOR_LABELS[anchor]}
              aria-label={ANCHOR_LABELS[anchor]}
              aria-pressed={value === anchor}
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onChange(anchor);
              }}
            >
              <Icon name={ANCHOR_ICONS[anchor]} size={11} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Left/right and up/down nudge for the anchored position, in pixels.
 * Arrows step by 1 px, or by 10 px with Shift held.
 */
export function OffsetControl({
  x,
  y,
  onChange,
  disabled,
  compact,
  inNode,
}: {
  x: number;
  y: number;
  onChange: (next: { x: number; y: number }) => void;
  disabled?: boolean;
  compact?: boolean;
  inNode?: boolean;
}) {
  const guard = inNode ? ' nopan nodrag' : '';
  const step = (e: React.MouseEvent) => (e.shiftKey ? OFFSET_SHIFT_STEP : 1);

  const nudge = (e: React.MouseEvent, axis: 'x' | 'y', dir: -1 | 1) => {
    e.stopPropagation();
    const delta = dir * step(e);
    onChange(axis === 'x' ? { x: x + delta, y } : { x, y: y + delta });
  };

  return (
    <div
      className={`offset-control${compact ? ' compact' : ''}`}
      role="group"
      aria-label="Offset position"
      onMouseDown={inNode ? (e) => e.stopPropagation() : undefined}
    >
      <div className="offset-row">
        <span className="offset-axis-label">X</span>
        <button
          type="button"
          className={`offset-btn${guard}`}
          title="Move left (Shift = 10 px)"
          aria-label="Move left"
          disabled={disabled}
          onClick={(e) => nudge(e, 'x', -1)}
        >
          <Icon name="arrow-left-line" size={11} />
        </button>
        <input
          className={`offset-input${guard} nowheel`}
          type="number"
          value={x}
          disabled={disabled}
          aria-label="Horizontal offset in pixels"
          onKeyDown={inNode ? (e) => e.stopPropagation() : undefined}
          onChange={(e) => onChange({ x: parseInt(e.target.value, 10) || 0, y })}
        />
        <button
          type="button"
          className={`offset-btn${guard}`}
          title="Move right (Shift = 10 px)"
          aria-label="Move right"
          disabled={disabled}
          onClick={(e) => nudge(e, 'x', 1)}
        >
          <Icon name="arrow-right-line" size={11} />
        </button>
      </div>
      <div className="offset-row">
        <span className="offset-axis-label">Y</span>
        <button
          type="button"
          className={`offset-btn${guard}`}
          title="Move up (Shift = 10 px)"
          aria-label="Move up"
          disabled={disabled}
          onClick={(e) => nudge(e, 'y', -1)}
        >
          <Icon name="arrow-up-line" size={11} />
        </button>
        <input
          className={`offset-input${guard} nowheel`}
          type="number"
          value={y}
          disabled={disabled}
          aria-label="Vertical offset in pixels"
          onKeyDown={inNode ? (e) => e.stopPropagation() : undefined}
          onChange={(e) => onChange({ x, y: parseInt(e.target.value, 10) || 0 })}
        />
        <button
          type="button"
          className={`offset-btn${guard}`}
          title="Move down (Shift = 10 px)"
          aria-label="Move down"
          disabled={disabled}
          onClick={(e) => nudge(e, 'y', 1)}
        >
          <Icon name="arrow-down-line" size={11} />
        </button>
      </div>
      <button
        type="button"
        className={`offset-reset${guard}`}
        title="Reset offset to 0, 0"
        disabled={disabled || (x === 0 && y === 0)}
        onClick={(e) => {
          e.stopPropagation();
          onChange({ x: 0, y: 0 });
        }}
      >
        Reset
      </button>
    </div>
  );
}

/** Anchor grid + offset nudger side by side, with a shared caption row. */
export function AnchorOffsetControls({
  anchor,
  offsetX,
  offsetY,
  onAnchorChange,
  onOffsetChange,
  disabled,
  compact,
  inNode,
  note,
  onFreeSelect,
}: {
  anchor: CropAnchor;
  offsetX: number;
  offsetY: number;
  onAnchorChange: (anchor: AnchorPosition) => void;
  onOffsetChange: (next: { x: number; y: number }) => void;
  disabled?: boolean;
  compact?: boolean;
  inNode?: boolean;
  note?: string;
  /** When given, adds a pill for the freely dragged position (Crop only). */
  onFreeSelect?: () => void;
}) {
  return (
    <div className={`anchor-offset-controls${compact ? ' compact' : ''}`}>
      <div className="anchor-offset-row">
        <AnchorPicker
          value={anchor}
          onChange={onAnchorChange}
          disabled={disabled}
          compact={compact}
          inNode={inNode}
        />
        <OffsetControl
          x={offsetX}
          y={offsetY}
          onChange={onOffsetChange}
          disabled={disabled}
          compact={compact}
          inNode={inNode}
        />
      </div>
      {(note || onFreeSelect) && (
        <div className="anchor-offset-note">
          {onFreeSelect && (
            <button
              type="button"
              className={`tool-pill${anchor === 'free' ? ' on' : ''}${inNode ? ' nopan nodrag' : ''}`}
              title="Position the crop freely by dragging it in the crop editor"
              aria-pressed={anchor === 'free'}
              disabled={disabled}
              onMouseDown={inNode ? (e) => e.stopPropagation() : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onFreeSelect();
              }}
            >
              Free
            </button>
          )}
          {note && <span>{note}</span>}
        </div>
      )}
    </div>
  );
}
