import { useCallback } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useOpenWorkflowTabsStore } from '../store/openWorkflowTabsStore';
import { useWorkflowStore } from '../store/workflowStore';
import Icon from '../icons/Icon';

export default function WorkflowTabs() {
  const tabs = useOpenWorkflowTabsStore((s) => s.tabs);
  const removeTab = useOpenWorkflowTabsStore((s) => s.removeTab);
  const navigate = useNavigate();
  const match = useMatch('/workflow/:id');
  const activeWorkflowId = match?.params?.id ?? null;

  const switchToTab = useCallback(
    async (tabId: string) => {
      if (tabId === activeWorkflowId) return;
      await useWorkflowStore.getState().saveNow?.();
      navigate(`/workflow/${tabId}`);
    },
    [activeWorkflowId, navigate],
  );

  const closeTab = useCallback(
    async (e: React.MouseEvent, tabId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const list = useOpenWorkflowTabsStore.getState().tabs;
      const idx = list.findIndex((t) => t.id === tabId);
      if (idx === -1) return;

      const wasActive = activeWorkflowId === tabId;
      let navigateToId: string | null = null;
      if (wasActive) {
        await useWorkflowStore.getState().saveNow?.();
        if (list.length > 1) {
          navigateToId = idx > 0 ? list[idx - 1].id : list[idx + 1].id;
        }
      }

      removeTab(tabId);

      if (wasActive) {
        if (navigateToId) navigate(`/workflow/${navigateToId}`);
        else navigate('/');
      }
    },
    [activeWorkflowId, navigate, removeTab],
  );

  const onTabAuxClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, tabId: string) => {
      if (e.button === 1) {
        e.preventDefault();
        void closeTab(e, tabId);
      }
    },
    [closeTab],
  );

  if (tabs.length === 0) return null;

  return (
    <div className="workflow-tabs-bar" role="tablist" aria-label="Open workflows">
      <div className="workflow-tabs-scroll">
        {tabs.map((tab) => {
          const active = tab.id === activeWorkflowId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={`workflow-tab${active ? ' workflow-tab--active' : ''}`}
              onAuxClick={(e) => onTabAuxClick(e, tab.id)}
            >
              <button
                type="button"
                className="workflow-tab-trigger"
                onClick={() => void switchToTab(tab.id)}
                title={tab.name}
              >
                <span className="workflow-tab-label">{tab.name}</span>
              </button>
              <button
                type="button"
                className="workflow-tab-close"
                onClick={(e) => void closeTab(e, tab.id)}
                aria-label={`Close ${tab.name}`}
                title="Close tab"
              >
                <Icon name="close-line" size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
