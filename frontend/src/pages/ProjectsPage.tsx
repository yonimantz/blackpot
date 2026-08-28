import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  renameWorkflow,
  saveWorkflow,
  type WorkflowSummary,
} from '../utils/api';
import WorkflowMetaModal from '../components/WorkflowMetaModal';
import { WorkflowIcon } from '../constants/workflowIcons';
import type { WorkflowMetaSaved } from '../components/WorkflowMetaModal';
import {
  BLPW_EXTENSION,
  exportWorkflowToFile,
  readBlpwFile,
} from '../utils/workflowFile';
import Icon from '../icons/Icon';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function patchSummary(wf: WorkflowSummary, meta: WorkflowMetaSaved): WorkflowSummary {
  return {
    ...wf,
    name: meta.name,
    icon_id: meta.icon_id,
    icon_color: meta.icon_color,
    description: meta.description,
  };
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowSummary | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkflowSummary | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await listWorkflows();
      setWorkflows(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteWorkflow(deleteTarget.id);
      setWorkflows((prev) => prev.filter((w) => w.id !== deleteTarget.id));
    } catch {
      alert('Failed to delete workflow');
    }
    setDeleteTarget(null);
  }, [deleteTarget]);

  const commitRename = useCallback(async () => {
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    if (trimmed) {
      try {
        await renameWorkflow(renamingId, trimmed);
        setWorkflows((prev) =>
          prev.map((w) => (w.id === renamingId ? { ...w, name: trimmed } : w)),
        );
      } catch {
        /* ignore */
      }
    }
    setRenamingId(null);
  }, [renamingId, renameDraft]);

  const handleExport = useCallback(async (wf: WorkflowSummary) => {
    setExportingId(wf.id);
    try {
      const full = await getWorkflow(wf.id);
      await exportWorkflowToFile(full);
    } catch {
      alert('Failed to export workflow');
    } finally {
      setExportingId(null);
    }
  }, []);

  const handleImportClick = useCallback(() => {
    if (importing) return;
    importInputRef.current?.click();
  }, [importing]);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset input so picking the same file twice still fires onChange.
      e.target.value = '';
      if (!file) return;

      setImporting(true);
      try {
        const parsed = await readBlpwFile(file);
        const wf = await createWorkflow({
          name: parsed.name,
          icon_id: parsed.icon_id,
          icon_color: parsed.icon_color,
          description: parsed.description,
        });
        await saveWorkflow(wf.id, {
          name: parsed.name,
          icon_id: parsed.icon_id,
          icon_color: parsed.icon_color,
          description: parsed.description,
          data: parsed.data,
        });
        navigate(`/workflow/${wf.id}`);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to import workflow';
        alert(`Import failed: ${msg}`);
      } finally {
        setImporting(false);
      }
    },
    [navigate],
  );

  return (
    <div className="projects-page">
      <div className="projects-header">
        <h1 className="projects-title">Projects</h1>
        <div className="projects-header-actions">
          <button
            type="button"
            className="projects-import-btn"
            onClick={handleImportClick}
            disabled={importing}
            title={`Import a ${BLPW_EXTENSION} workflow file`}
            aria-label="Import workflow"
          >
            <Icon name="upload-2-line" size={16} />
            <span>{importing ? 'Importing…' : 'Import'}</span>
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept={`${BLPW_EXTENSION},application/json`}
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button className="projects-new-btn" onClick={() => setCreateOpen(true)}>
            <Icon name="add-line" size={14} />
            New Workflow
          </button>
        </div>
      </div>

      {loading ? (
        <div className="projects-empty">Loading...</div>
      ) : workflows.length === 0 ? (
        <div className="projects-empty">
          <div className="projects-empty-icon" aria-hidden>
            <Icon name="layout-grid-line" size={48} />
          </div>
          <p>No workflows yet.</p>
          <p>
            Click <strong>+ New Workflow</strong> to get started, or{' '}
            <strong>Import</strong> a <code>{BLPW_EXTENSION}</code> file.
          </p>
        </div>
      ) : (
        <div className="projects-grid">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="workflow-card"
              onClick={() => navigate(`/workflow/${wf.id}`)}
            >
              <div className="workflow-card-icon">
                <WorkflowIcon iconId={wf.icon_id} iconColor={wf.icon_color} size={64} />
              </div>

              {renamingId === wf.id ? (
                <input
                  ref={renameRef}
                  className="workflow-card-name-input"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
              ) : (
                <div
                  className="workflow-card-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(wf.id);
                    setRenameDraft(wf.name);
                  }}
                  title="Double-click to rename"
                >
                  {wf.name}
                </div>
              )}

              <div className="workflow-card-meta">{timeAgo(wf.updated_at)}</div>

              <div className="workflow-card-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="workflow-card-btn export icon-btn"
                  title={`Export as ${BLPW_EXTENSION}`}
                  aria-label="Export workflow"
                  disabled={exportingId === wf.id}
                  onClick={() => handleExport(wf)}
                >
                  <Icon name="download-2-line" size={14} />
                </button>
                <button
                  className="workflow-card-btn details icon-btn"
                  title="Details"
                  aria-label="Workflow details"
                  onClick={() => setEditTarget(wf)}
                >
                  <Icon name="information-line" size={14} />
                </button>
                <button
                  className="workflow-card-btn delete icon-btn"
                  title="Delete"
                  aria-label="Delete workflow"
                  onClick={() => setDeleteTarget(wf)}
                >
                  <Icon name="delete-2-line" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <WorkflowMetaModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        mode="create"
        onCreated={(wf) => navigate(`/workflow/${wf.id}`)}
      />

      {editTarget && (
        <WorkflowMetaModal
          open
          onClose={() => setEditTarget(null)}
          mode="edit"
          workflowId={editTarget.id}
          initialName={editTarget.name}
          initialIconId={editTarget.icon_id}
          initialIconColor={editTarget.icon_color}
          initialDescription={editTarget.description}
          onEdited={(meta) => {
            const id = editTarget.id;
            setWorkflows((prev) =>
              prev.map((w) => (w.id === id ? patchSummary(w, meta) : w)),
            );
          }}
        />
      )}

      {deleteTarget && (
        <div className="confirm-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>
              Delete <strong>{deleteTarget.name}</strong>? This cannot be undone.
            </p>
            <div className="confirm-buttons">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="confirm-btn confirm-btn-danger" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
