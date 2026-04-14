import { useMemo } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import {
  STUDIO_LENS_OPTIONS,
  STUDIO_SHOT_OPTIONS,
  STUDIO_VIEW_ANGLE_OPTIONS,
  STUDIO_VIEW_ORTHO_OPTIONS,
  normalizeStudioLens,
  normalizeStudioShot,
  normalizeStudioView,
  buildStudioOutputString,
} from '../constants/studioAttributes';

type Props = {
  nodeId: string;
  data: Record<string, any>;
  /** When true, show generated text preview (inspector only). */
  showOutputPreview?: boolean;
};

export default function StudioFields({ nodeId, data, showOutputPreview }: Props) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const lens = normalizeStudioLens(data.studioLens);
  const shot = normalizeStudioShot(data.studioShot);
  const view = normalizeStudioView(data.studioView);
  const useLens = data.studioIncludeLens !== false;
  const useShot = data.studioIncludeShot !== false;
  const useView = data.studioIncludeView !== false;

  const outputText = useMemo(() => buildStudioOutputString(data), [data]);

  const selClass = 'inspector-select nopan nodrag';

  return (
    <div className="studio-fields prop-group">
      {showOutputPreview ? (
        <>
          <label className="inspector-label">Output text</label>
          {outputText ? (
            <>
              <div className="combine-preview inspector-studio-output nopan nodrag nowheel">{outputText}</div>
              <div className="combine-char-count">{outputText.length} chars</div>
            </>
          ) : (
            <div className="combine-preview empty inspector-studio-output-empty nopan nodrag">
              Turn on at least one category below
            </div>
          )}
        </>
      ) : null}

      <label className="inspector-label">
        <input
          type="checkbox"
          checked={useLens}
          disabled={isRunning}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => updateNodeData(nodeId, { studioIncludeLens: e.target.checked })}
        />
        {' '}
        Lens
      </label>
      <select
        className={selClass}
        value={lens}
        disabled={isRunning || !useLens}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => updateNodeData(nodeId, { studioLens: e.target.value })}
      >
        {STUDIO_LENS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <label className="inspector-label">
        <input
          type="checkbox"
          checked={useShot}
          disabled={isRunning}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => updateNodeData(nodeId, { studioIncludeShot: e.target.checked })}
        />
        {' '}
        Shot
      </label>
      <select
        className={selClass}
        value={shot}
        disabled={isRunning || !useShot}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => updateNodeData(nodeId, { studioShot: e.target.value })}
      >
        {STUDIO_SHOT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <label className="inspector-label">
        <input
          type="checkbox"
          checked={useView}
          disabled={isRunning}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => updateNodeData(nodeId, { studioIncludeView: e.target.checked })}
        />
        {' '}
        Angle / orthographic view
      </label>
      <select
        className={selClass}
        value={view}
        disabled={isRunning || !useView}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => updateNodeData(nodeId, { studioView: e.target.value })}
      >
        <optgroup label="Camera angles">
          {STUDIO_VIEW_ANGLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Orthographic views">
          {STUDIO_VIEW_ORTHO_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
