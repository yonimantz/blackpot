import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface OpenWorkflowTab {
  id: string;
  name: string;
}

interface OpenWorkflowTabsState {
  tabs: OpenWorkflowTab[];
  ensureTab: (id: string, name: string) => void;
  removeTab: (id: string) => void;
  setTabName: (id: string, name: string) => void;
}

export const useOpenWorkflowTabsStore = create<OpenWorkflowTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],

      ensureTab: (id, name) => {
        const label = name.trim() || 'Untitled Workflow';
        const { tabs } = get();
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx === -1) {
          set({ tabs: [...tabs, { id, name: label }] });
          return;
        }
        const next = [...tabs];
        next[idx] = { id, name: label };
        set({ tabs: next });
      },

      removeTab: (id) => {
        set({ tabs: get().tabs.filter((t) => t.id !== id) });
      },

      setTabName: (id, name) => {
        const label = name.trim() || 'Untitled Workflow';
        set({
          tabs: get().tabs.map((t) => (t.id === id ? { ...t, name: label } : t)),
        });
      },
    }),
    {
      name: 'spoton-open-workflow-tabs',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ tabs: state.tabs }),
    },
  ),
);
