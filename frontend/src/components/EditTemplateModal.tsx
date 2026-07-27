import { useCallback, useEffect, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useWorkflowStore } from '../store/workflowStore';
import { NODE_CATEGORIES, NODE_TYPE_DEFINITIONS } from '../types/nodeTypes';
import {
  WORKFLOW_TEMPLATE_VERSION,
  reconcileTemplate,
  suggestPinnedNodeIds,
  templateEntryLabel,
  type WorkflowTemplateItem,
  type WorkflowTemplateOutput,
} from '../types/templateTypes';
import TemplateFieldRenderer from './TemplateFieldRenderer';

function swapAt<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function capturePinSnapshot(nodes: Node[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const n of nodes) {
    m.set(n.id, Boolean(n.data?.pinned));
  }
  return m;
}

function restorePinSnapshot(
  snapshot: Map<string, boolean>,
  currentNodes: Node[],
  setPinnedForNodeIds: (ids: string[], pinned: boolean) => void,
) {
  const toPin: string[] = [];
  const toUnpin: string[] = [];
  for (const n of currentNodes) {
    const was = snapshot.get(n.id) ?? false;
    const now = Boolean(n.data?.pinned);
    if (was && !now) toPin.push(n.id);
    if (!was && now) toUnpin.push(n.id);
  }
  if (toPin.length) setPinnedForNodeIds(toPin, true);
  if (toUnpin.length) setPinnedForNodeIds(toUnpin, false);
}

export default function EditTemplateModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const nodes = useWorkflowStore((s) => s.nodes);
  const template = useWorkflowStore((s) => s.template);
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const setTemplate = useWorkflowStore((s) => s.setTemplate);
  const setPinnedForNodeIds = useWorkflowStore((s) => s.setPinnedForNodeIds);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);

  const [draftItems, setDraftItems] = useState<WorkflowTemplateItem[]>([]);
  const [draftOutputs, setDraftOutputs] = useState<WorkflowTemplateOutput[]>([]);
  const [expandedPreviewIds, setExpandedPreviewIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pinSnapshotRef = useRef<Map<string, boolean> | null>(null);
  const templateAtOpenRef = useRef<typeof template>(null);
  const didAutoSuggestRef = useRef(false);

  const nodeById = useCallback(
    (id: string) => nodes.find((n) => n.id === id),
    [nodes],
  );

  useEffect(() => {
    if (!open) {
      didAutoSuggestRef.current = false;
      pinSnapshotRef.current = null;
      templateAtOpenRef.current = null;
      setExpandedPreviewIds(new Set());
      return;
    }

    setError(null);
    setBusy(false);
    const store = useWorkflowStore.getState();
    pinSnapshotRef.current = capturePinSnapshot(store.nodes);
    templateAtOpenRef.current = store.template
      ? (JSON.parse(JSON.stringify(store.template)) as typeof store.template)
      : null;

    const anyPinned = store.nodes.some((n) => n.data?.pinned);
    if (!anyPinned && !didAutoSuggestRef.current) {
      didAutoSuggestRef.current = true;
      const suggested = suggestPinnedNodeIds(store.nodes, store.edges);
      if (suggested.length > 0) {
        store.setPinnedForNodeIds(suggested, true);
      }
    }

    const after = useWorkflowStore.getState();
    const reconciled = reconcileTemplate(after.template, after.nodes);
    setDraftItems(reconciled.items);
    setDraftOutputs(reconciled.outputs);
  }, [open]);

  const handleCancel = useCallback(() => {
    if (busy) return;
    const snap = pinSnapshotRef.current;
    if (snap) {
      restorePinSnapshot(snap, useWorkflowStore.getState().nodes, setPinnedForNodeIds);
    }
    setTemplate(templateAtOpenRef.current ?? null);
    onClose();
  }, [busy, onClose, setPinnedForNodeIds, setTemplate]);

  const handleConfirm = useCallback(() => {
    setBusy(true);
    setError(null);
    try {
      const finalTemplate = {
        version: WORKFLOW_TEMPLATE_VERSION,
        items: draftItems,
        outputs: draftOutputs,
        updatedAt: new Date().toISOString(),
      };
      setTemplate(finalTemplate);
      pinSnapshotRef.current = null;
      templateAtOpenRef.current = finalTemplate;
      onClose();
    } catch {
      setError('Failed to save template');
    } finally {
      setBusy(false);
    }
  }, [draftItems, draftOutputs, onClose, setTemplate]);

  const unpinNode = useCallback(
    (nodeId: string) => {
      setPinnedForNodeIds([nodeId], false);
      setDraftItems((items) => items.filter((x) => x.nodeId !== nodeId));
      setDraftOutputs((outs) => outs.filter((x) => x.nodeId !== nodeId));
    },
    [setPinnedForNodeIds],
  );

  const updateItem = useCallback((nodeId: string, patch: Partial<WorkflowTemplateItem>) => {
    setDraftItems((items) =>
      items.map((it) => (it.nodeId === nodeId ? { ...it, ...patch } : it)),
    );
  }, []);

  const updateOutput = useCallback((nodeId: string, patch: Partial<WorkflowTemplateOutput>) => {
    setDraftOutputs((outs) =>
      outs.map((o) => (o.nodeId === nodeId ? { ...o, ...patch } : o)),
    );
  }, []);

  const togglePreview = useCallback((nodeId: string) => {
    setExpandedPreviewIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  if (!open) return null;

  const titleName = workflowName || 'Untitled Workflow';

  return (
    <div className="confirm-overlay" onClick={() => !busy && handleCancel()}>
      <div
        className="confirm-dialog template-edit-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="template-edit-title"
      >
        <h2 id="template-edit-title" className="workflow-meta-title">
          Edit template — {titleName}
        </h2>
        <p className="template-edit-subtitle">
          Reorder pinned fields, add friendly labels, and choose which results appear in the
          Playground.
        </p>

        <section className="template-edit-section">
          <div className="template-edit-section-title">Inputs</div>
          {draftItems.length === 0 ? (
            <p className="template-edit-empty">Pin nodes in the workflow to add them here.</p>
          ) : (
            <ol className="template-edit-list">
              {draftItems.map((item, i) => {
                const node = nodeById(item.nodeId);
                const def = node?.type ? NODE_TYPE_DEFINITIONS[node.type] : undefined;
                const cat = def ? NODE_CATEGORIES[def.category] : undefined;
                const placeholder = templateEntryLabel(node, undefined);
                const previewOpen = expandedPreviewIds.has(item.nodeId);
                const nodeData = (node?.data ?? {}) as Record<string, any>;
                return (
                  <li className="template-edit-list-item" key={item.nodeId}>
                    <div className="template-edit-row">
                      <div className="template-edit-reorder">
                      <button
                        type="button"
                        className="template-edit-reorder-btn"
                        disabled={busy || i === 0}
                        aria-label="Move up"
                        onClick={() => setDraftItems((items) => swapAt(items, i, i - 1))}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="template-edit-reorder-btn"
                        disabled={busy || i === draftItems.length - 1}
                        aria-label="Move down"
                        onClick={() => setDraftItems((items) => swapAt(items, i, i + 1))}
                      >
                        ▼
                      </button>
                    </div>
                    <span
                      className="template-edit-swatch"
                      style={{ background: cat?.color || '#666' }}
                      title={def?.label}
                    />
                    <div className="template-edit-fields">
                      <span className="template-edit-type-hint">{def?.label || node?.type}</span>
                      <input
                        type="text"
                        className="workflow-meta-input template-edit-input"
                        value={item.label ?? ''}
                        placeholder={placeholder}
                        disabled={busy}
                        onChange={(e) => updateItem(item.nodeId, { label: e.target.value })}
                      />
                      <input
                        type="text"
                        className="workflow-meta-input template-edit-input template-edit-input--desc"
                        value={item.description ?? ''}
                        placeholder="Add a short description (optional)"
                        disabled={busy}
                        onChange={(e) => updateItem(item.nodeId, { description: e.target.value })}
                      />
                    </div>
                    <div className="template-edit-row-actions">
                      <button
                        type="button"
                        className={`template-edit-preview-toggle${previewOpen ? ' template-edit-preview-toggle--open' : ''}`}
                        disabled={busy || !node?.type}
                        aria-expanded={previewOpen}
                        onClick={() => togglePreview(item.nodeId)}
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        className="template-edit-unpin"
                        title="Unpin"
                        disabled={busy}
                        onClick={() => unpinNode(item.nodeId)}
                      >
                        ×
                      </button>
                    </div>
                    </div>
                    {previewOpen && node?.type ? (
                      <div className="template-edit-preview-panel">
                        <div className="template-edit-preview-heading">
                          {templateEntryLabel(node, item.label)}
                        </div>
                        {item.description?.trim() ? (
                          <p className="template-edit-preview-desc">{item.description.trim()}</p>
                        ) : null}
                        <TemplateFieldRenderer
                          nodeId={item.nodeId}
                          type={node.type}
                          data={nodeData}
                          updateNodeData={updateNodeData}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="template-edit-section">
          <div className="template-edit-section-title">Results</div>
          {draftOutputs.length === 0 ? (
            <p className="template-edit-empty">
              Pin a Preview or Export Image node to choose what shows here.
            </p>
          ) : (
            <ol className="template-edit-list">
              {draftOutputs.map((out, i) => {
                const node = nodeById(out.nodeId);
                const def = node?.type ? NODE_TYPE_DEFINITIONS[node.type] : undefined;
                const cat = def ? NODE_CATEGORIES[def.category] : undefined;
                const placeholder = templateEntryLabel(node, undefined);
                return (
                  <li className="template-edit-row template-edit-row--output" key={out.nodeId}>
                    <div className="template-edit-reorder">
                      <button
                        type="button"
                        className="template-edit-reorder-btn"
                        disabled={busy || i === 0}
                        aria-label="Move up"
                        onClick={() => setDraftOutputs((outs) => swapAt(outs, i, i - 1))}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="template-edit-reorder-btn"
                        disabled={busy || i === draftOutputs.length - 1}
                        aria-label="Move down"
                        onClick={() => setDraftOutputs((outs) => swapAt(outs, i, i + 1))}
                      >
                        ▼
                      </button>
                    </div>
                    <span
                      className="template-edit-swatch"
                      style={{ background: cat?.color || '#666' }}
                      title={def?.label}
                    />
                    <div className="template-edit-fields">
                      <span className="template-edit-type-hint">{def?.label || node?.type}</span>
                      <input
                        type="text"
                        className="workflow-meta-input template-edit-input"
                        value={out.label ?? ''}
                        placeholder={placeholder}
                        disabled={busy}
                        onChange={(e) => updateOutput(out.nodeId, { label: e.target.value })}
                      />
                    </div>
                    <button
                      type="button"
                      className="template-edit-unpin"
                      title="Unpin"
                      disabled={busy}
                      onClick={() => unpinNode(out.nodeId)}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {error && <p className="workflow-meta-error">{error}</p>}

        <div className="confirm-buttons workflow-meta-actions">
          <button
            type="button"
            className="confirm-btn confirm-btn-cancel"
            onClick={handleCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-btn confirm-btn-primary"
            onClick={handleConfirm}
            disabled={busy}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
