import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listWorkflows, deleteWorkflow, renameWorkflow, type WorkflowSummary } from '../utils/api';
import WorkflowMetaModal from '../components/WorkflowMetaModal';
import { WorkflowIcon } from '../constants/workflowIcons';
import type { WorkflowMetaSaved } from '../components/WorkflowMetaModal';

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

  return (
    <div className="projects-page">
      <div className="projects-header">
        <h1 className="projects-title">Projects</h1>
        <button className="projects-new-btn" onClick={() => setCreateOpen(true)}>
          + New Workflow
        </button>
      </div>

      {loading ? (
        <div className="projects-empty">Loading...</div>
      ) : workflows.length === 0 ? (
        <div className="projects-empty">
          <p>No workflows yet.</p>
          <p>
            Click <strong>+ New Workflow</strong> to get started.
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
                  className="workflow-card-btn details"
                  title="Details"
                  onClick={() => setEditTarget(wf)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                </button>
                <button
                  className="workflow-card-btn delete"
                  title="Delete"
                  onClick={() => setDeleteTarget(wf)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
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
