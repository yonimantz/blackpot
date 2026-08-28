import { useWorkflowStore } from '../store/workflowStore';
import { startWorkflowRun, stopWorkflowRun } from '../utils/runWorkflow';
import Icon from '../icons/Icon';

export default function RunButton() {
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const getRunWorkflowPayload = useWorkflowStore((s) => s.getRunWorkflowPayload);

  const handleRun = async () => {
    const workflow = getRunWorkflowPayload();
    await startWorkflowRun(workflow);
  };

  const handleStop = async () => {
    await stopWorkflowRun();
  };

  return (
    <div className="run-bar">
      {isRunning ? (
        <button className="run-button stop" onClick={handleStop}>
          <Icon name="stop-fill" size={14} /> STOP
        </button>
      ) : (
        <button className="run-button" onClick={handleRun}>
          <Icon name="play-fill" size={14} /> RUN WORKFLOW
        </button>
      )}
    </div>
  );
}
