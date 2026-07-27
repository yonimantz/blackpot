import { useRef } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { runWorkflowStreaming, cancelWorkflow } from '../utils/api';
import { applyNodeResult, formatWorkflowRunErrors } from '../utils/applyRunResult';

const streamingResults: Record<string, any> = {};

export default function RunButton() {
  const {
    isRunning,
    setIsRunning,
    setRunResults,
    getRunWorkflowPayload,
    setActiveNodeId,
    clearRunProgress,
  } = useWorkflowStore();
  const abortRef = useRef<AbortController | null>(null);

  const handleRun = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    clearRunProgress();
    for (const key of Object.keys(streamingResults)) delete streamingResults[key];

    try {
      const workflow = getRunWorkflowPayload();
      const doneResults = await runWorkflowStreaming(
        workflow,
        {
          onNodeStart: (nodeId) => {
            useWorkflowStore.getState().setActiveNodeId(nodeId);
          },
          onNodeDone: (nodeId, result) => {
            useWorkflowStore.getState().markNodeCompleted(nodeId);
            if (result) applyNodeResult(nodeId, result, streamingResults);
          },
        },
        controller.signal,
      );

      const mergedResults = { ...streamingResults, ...doneResults };

      setActiveNodeId(null);
      setRunResults(mergedResults);

      const errors = formatWorkflowRunErrors(mergedResults);
      if (errors.length > 0) {
        alert(`Workflow errors:\n\n${errors.join('\n\n')}`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      alert('Workflow error: ' + (err.message || 'Unknown error'));
    } finally {
      abortRef.current = null;
      setIsRunning(false);
      clearRunProgress();
    }
  };

  const handleStop = async () => {
    await cancelWorkflow();
    abortRef.current?.abort();
  };

  return (
    <div className="run-bar">
      {isRunning ? (
        <button className="run-button stop" onClick={handleStop}>
          ■ STOP
        </button>
      ) : (
        <button className="run-button" onClick={handleRun}>
          ▶ RUN WORKFLOW
        </button>
      )}
    </div>
  );
}
