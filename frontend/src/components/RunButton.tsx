import { useRef } from 'react';
import { useWorkflowStore } from '../store/workflowStore';
import { runWorkflowStreaming, cancelWorkflow } from '../utils/api';

const streamingResults: Record<string, any> = {};

function applyNodeResult(nodeId: string, result: any) {
  streamingResults[nodeId] = result;
  const store = useWorkflowStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node) return;

  if (result.error || result.skipped) return;

  if (node.type === 'preview' && result.image) {
    store.updateNodeData(nodeId, { previewData: result.image });
  }
  if (node.type === 'editor' && result.image) {
    store.updateNodeData(nodeId, { _editorPreview: result.image });
  }
  if (node.type === 'compositor' && result.image) {
    store.updateNodeData(nodeId, { _compositorPreview: result.image });
  }
  if (node.type === 'vignette' && result.image) {
    store.updateNodeData(nodeId, { _vignettePreview: result.image });
  }
  if (node.type === 'exportImage' && result.saved) {
    store.updateNodeData(nodeId, { _lastExportedPath: result.saved, _result: result });
  } else if (result.image && node.type !== 'preview') {
    store.updateNodeData(nodeId, { _result: result });
  } else if (
    typeof result.text === 'string' &&
    result.image == null &&
    result.data == null
  ) {
    store.updateNodeData(nodeId, { text: result.text, _result: result });
  }
  if (result.data) {
    store.updateNodeData(nodeId, { _result: result.data });
  }
}

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
            if (result) applyNodeResult(nodeId, result);
          },
        },
        controller.signal,
      );

      const mergedResults = { ...streamingResults, ...doneResults };

      setActiveNodeId(null);
      setRunResults(mergedResults);

      const errors: string[] = [];
      for (const [nodeId, result] of Object.entries(mergedResults)) {
        if (nodeId === '_cancelled') continue;
        if (result.skipped && !result.error) continue;
        if (result.error) {
          const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId);
          const label = (node?.data?.label as string) || node?.type || nodeId;
          errors.push(`${label}: ${result.error}`);
        }
      }
      if (errors.length > 0) {
        alert(`Workflow errors:\n\n${errors.join('\n\n')}`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      // #region agent log
      fetch('http://127.0.0.1:7770/ingest/3f1222d0-2d27-430e-961f-5520cb868048', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '7a892f' },
        body: JSON.stringify({
          sessionId: '7a892f',
          hypothesisId: 'H1',
          runId: 'pre-fix',
          location: 'RunButton.tsx:handleRun:catch',
          message: 'runWorkflowStreaming threw',
          data: { errName: err?.name, errMsg: String(err?.message ?? err).slice(0, 400) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
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
