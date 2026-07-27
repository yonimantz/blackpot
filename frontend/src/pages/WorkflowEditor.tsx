import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Canvas from '../components/Canvas';
import NodePalette from '../components/NodePalette';
import InspectorPanel from '../components/InspectorPanel';
import RunButton from '../components/RunButton';
import WorkflowTabs from '../components/WorkflowTabs';
import { useWorkflowStore } from '../store/workflowStore';
import { useOpenWorkflowTabsStore } from '../store/openWorkflowTabsStore';

export default function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const workflowId = useWorkflowStore((s) => s.workflowId);
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const ensureTab = useOpenWorkflowTabsStore((s) => s.ensureTab);

  useEffect(() => {
    if (!id) {
      navigate('/');
      return;
    }

    let cancelled = false;
    (async () => {
      const ok = await loadWorkflow(id);
      if (!ok && !cancelled) {
        useOpenWorkflowTabsStore.getState().removeTab(id);
        navigate('/');
      }
    })();

    return () => { cancelled = true; };
  }, [id, loadWorkflow, navigate]);

  useEffect(() => {
    if (!id || !workflowId || workflowId !== id) return;
    ensureTab(workflowId, workflowName || 'Untitled Workflow');
  }, [id, workflowId, workflowName, ensureTab]);

  useEffect(() => {
    if (!workflowId) return;
    const store = useWorkflowStore.getState();

    // Run the (potentially heavy) serialize-and-upload on idle so it never
    // competes with an interaction frame. `saveNow` is dirty-gated and
    // guarded against overlap, so a quick re-check here just avoids
    // scheduling idle callbacks when there's nothing to do.
    type IdleHandle = number;
    const ric: (cb: () => void) => IdleHandle =
      typeof window.requestIdleCallback === 'function'
        ? (cb) => window.requestIdleCallback(() => cb(), { timeout: 2000 })
        : (cb) => window.setTimeout(cb, 0);
    const cic: (handle: IdleHandle) => void =
      typeof window.cancelIdleCallback === 'function'
        ? (h) => window.cancelIdleCallback(h)
        : (h) => window.clearTimeout(h);

    let idleHandle: IdleHandle | null = null;
    const saveInterval = window.setInterval(() => {
      if (!useWorkflowStore.getState()._dirty) return;
      idleHandle = ric(() => {
        idleHandle = null;
        store.saveNow?.();
      });
    }, 3000);

    const handleBeforeUnload = () => {
      store.saveNow?.();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(saveInterval);
      if (idleHandle != null) cic(idleHandle);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      store.saveNow?.();
    };
  }, [workflowId]);

  if (!workflowId) {
    return <div className="editor-loading">Loading workflow...</div>;
  }

  return (
    <div className="app-layout">
      <div className="app-main">
        <NodePalette />
        <div className="app-editor-center">
          <WorkflowTabs />
          <Canvas />
        </div>
        <InspectorPanel />
      </div>
      <RunButton />
    </div>
  );
}
