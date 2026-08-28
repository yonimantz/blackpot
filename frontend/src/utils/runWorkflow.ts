import { useWorkflowStore } from '../store/workflowStore';
import { runWorkflowStreaming, cancelWorkflow } from './api';
import { applyNodeResult, formatWorkflowRunErrors } from './applyRunResult';

/** Shared across full-workflow and group runs — only one run happens at a time. */
const streamingResults: Record<string, any> = {};
let abortController: AbortController | null = null;

export interface WorkflowRunPayload {
  nodes: any[];
  edges: any[];
  workflow_id?: string | null;
  pre_outputs?: Record<string, Record<string, any>>;
}

export interface StartWorkflowRunOptions {
  /** Set when this run was triggered by a group's Play button. */
  groupId?: string | null;
}

/**
 * Runs a workflow (full graph or a single group's payload) via the streaming
 * endpoint, updating shared run/progress state as node events arrive. Used by
 * both the main RUN WORKFLOW button and each group's Play button — they share
 * `isRunning` so only one run can be in flight at a time.
 *
 * Per-node run state (executing / completed / error / skipped) belongs to the
 * run and nothing else: it is cleared on the way in and on the way out, so a
 * failed run never leaves nodes dimmed or badged once it is over. Real outputs
 * are unaffected — those live in node data via `applyNodeResult`.
 */
export async function startWorkflowRun(
  workflow: WorkflowRunPayload,
  options: StartWorkflowRunOptions = {},
): Promise<void> {
  const { groupId = null } = options;
  const store = useWorkflowStore.getState();

  const controller = new AbortController();
  abortController = controller;
  store.setIsRunning(true);
  store.setRunningGroupId(groupId);
  store.clearRunProgress();
  store.setRunResults({});
  for (const key of Object.keys(streamingResults)) delete streamingResults[key];

  try {
    const doneResults = await runWorkflowStreaming(
      workflow,
      {
        onNodeStart: (nodeId) => {
          useWorkflowStore.getState().setActiveNodeId(nodeId);
        },
        onNodeDone: (nodeId, result) => {
          const state = useWorkflowStore.getState();
          state.markNodeCompleted(nodeId);
          if (result) {
            state.setNodeRunResult(nodeId, result);
            applyNodeResult(nodeId, result, streamingResults);
          }
        },
      },
      controller.signal,
    );

    const mergedResults = { ...streamingResults, ...doneResults };

    useWorkflowStore.getState().setActiveNodeId(null);
    useWorkflowStore.getState().setRunResults(mergedResults);

    // Badges stay on screen behind this alert, then the `finally` clears them.
    const messages = formatWorkflowRunErrors(mergedResults);
    if (messages.length > 0) {
      alert(`Workflow errors:\n\n${messages.join('\n\n')}`);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    alert('Workflow error: ' + (err.message || 'Unknown error'));
  } finally {
    abortController = null;
    useWorkflowStore.getState().setIsRunning(false);
    useWorkflowStore.getState().setRunningGroupId(null);
    useWorkflowStore.getState().clearRunProgress();
    useWorkflowStore.getState().setRunResults({});
  }
}

export async function stopWorkflowRun(): Promise<void> {
  await cancelWorkflow();
  abortController?.abort();
}
