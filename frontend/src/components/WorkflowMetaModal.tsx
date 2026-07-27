import { useCallback, useEffect, useState } from 'react';
import { createWorkflow, saveWorkflow, type WorkflowFull } from '../utils/api';
import {
  DEFAULT_WORKFLOW_ICON_COLOR,
  DEFAULT_WORKFLOW_ICON_ID,
  WORKFLOW_ICON_PALETTE,
} from '../constants/workflowIcons';

export type WorkflowMetaSaved = {
  name: string;
  icon_id: string;
  icon_color: string | null;
  description: string;
};

export default function WorkflowMetaModal({
  open,
  onClose,
  mode,
  workflowId,
  initialName = 'Untitled Workflow',
  initialIconId,
  initialIconColor,
  initialDescription = '',
  onCreated,
  onEdited,
}: {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  workflowId?: string;
  initialName?: string;
  initialIconId?: string;
  initialIconColor?: string | null;
  initialDescription?: string;
  onCreated?: (wf: WorkflowFull) => void;
  onEdited?: (meta: WorkflowMetaSaved) => void;
}) {
  const [name, setName] = useState(initialName);
  const iconId = initialIconId || DEFAULT_WORKFLOW_ICON_ID;
  const [iconColor, setIconColor] = useState<string>(() => {
    const c = initialIconColor?.trim();
    return c && WORKFLOW_ICON_PALETTE.some((p) => p.hex === c) ? c : DEFAULT_WORKFLOW_ICON_COLOR;
  });
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName || 'Untitled Workflow');
    const ic = initialIconColor?.trim();
    setIconColor(ic && WORKFLOW_ICON_PALETTE.some((p) => p.hex === ic) ? ic : DEFAULT_WORKFLOW_ICON_COLOR);
    setDescription(initialDescription ?? '');
    setError(null);
    setBusy(false);
  }, [open, initialName, initialIconColor, initialDescription]);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim() || 'Untitled Workflow';
    const desc = description.trim();
    const colorNorm = WORKFLOW_ICON_PALETTE.some((p) => p.hex === iconColor)
      ? iconColor
      : DEFAULT_WORKFLOW_ICON_COLOR;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        const wf = await createWorkflow({
          name: trimmedName,
          icon_id: iconId,
          icon_color: colorNorm,
          description: desc,
        });
        onCreated?.(wf);
        onClose();
      } else {
        if (!workflowId) {
          setError('Missing workflow id');
          setBusy(false);
          return;
        }
        await saveWorkflow(workflowId, {
          name: trimmedName,
          icon_id: iconId,
          icon_color: colorNorm,
          description: desc,
        });
        onEdited?.({
          name: trimmedName,
          icon_id: iconId,
          icon_color: colorNorm,
          description: desc,
        });
        onClose();
      }
    } catch {
      setError(mode === 'create' ? 'Failed to create workflow' : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }, [mode, name, description, iconId, iconColor, workflowId, onCreated, onEdited, onClose]);

  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={() => !busy && onClose()}>
      <div
        className="confirm-dialog workflow-meta-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="workflow-meta-title"
      >
        <h2 id="workflow-meta-title" className="workflow-meta-title">
          {mode === 'create' ? 'New workflow' : 'Workflow details'}
        </h2>

        <label className="workflow-meta-label">
          Name
          <input
            type="text"
            className="workflow-meta-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled Workflow"
            disabled={busy}
          />
        </label>

        <div className="workflow-meta-picker-stack">
          <span className="workflow-meta-label workflow-meta-label--block workflow-meta-label--center">
            Icon color
          </span>
          <div className="workflow-meta-color-row" role="group" aria-label="Icon color">
            {WORKFLOW_ICON_PALETTE.map(({ id, label, hex }) => {
              const selected = hex === iconColor;
              return (
                <button
                  key={id}
                  type="button"
                  className={`workflow-meta-color-swatch${selected ? ' workflow-meta-color-swatch--selected' : ''}`}
                  title={label}
                  onClick={() => setIconColor(hex)}
                  disabled={busy}
                >
                  <span
                    className={`workflow-meta-color-swatch-inner${hex === '#ffffff' ? ' workflow-meta-color-swatch-inner--white' : ''}`}
                    style={{ backgroundColor: hex }}
                  />
                </button>
              );
            })}
          </div>

        </div>

        <label className="workflow-meta-label">
          Description <span className="workflow-meta-optional">(optional)</span>
          <textarea
            className="workflow-meta-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes about this workflow…"
            rows={3}
            disabled={busy}
          />
        </label>

        {error && <p className="workflow-meta-error">{error}</p>}

        <div className="confirm-buttons workflow-meta-actions">
          <button
            type="button"
            className="confirm-btn confirm-btn-cancel"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-btn confirm-btn-primary"
            onClick={handleSubmit}
            disabled={busy}
          >
            {mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
