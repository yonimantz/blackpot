import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Icon from '../icons/Icon';

import type { FieldSpec } from '../constants/playgroundModels';

import {

  getInitialParams,

  getPlaygroundModel,

  PLAYGROUND_MODELS,

} from '../constants/playgroundModels';

import PlaygroundTemplatePanel from '../components/PlaygroundTemplatePanel';

import ImageLightbox, { type LightboxImage } from '../components/ImageLightbox';

import { useWorkflowStore } from '../store/workflowStore';

import {

  cancelPlaygroundRun,

  runPlaygroundGeneration,

  type PlaygroundReference,

} from '../utils/playgroundRun';

import { listWorkflows, cancelWorkflow, runWorkflowStreaming, type WorkflowSummary } from '../utils/api';

import { applyNodeResult, formatWorkflowRunErrors } from '../utils/applyRunResult';

import {

  resolveTemplateOutputImages,

  templateOutputsToLightboxImages,

  type TemplateOutputResolved,

} from '../utils/templateRun';



interface HistoryEntry {

  id: string;

  image: string;

  prompt: string;

  modelLabel: string;

  createdAt: number;

}



interface TemplateHistoryEntry {

  id: string;

  outputs: TemplateOutputResolved[];

  workflowName: string;

  createdAt: number;

}



const PLAYGROUND_MODE_ID = 'playground';

function TemplateHistoryCollage({ images }: { images: string[] }) {
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;
  if (shown.length === 0) {
    return <span className="playground-history-collage-empty" aria-hidden />;
  }
  return (
    <span className="playground-history-collage">
      {shown.map((src, i) => (
        <span className="playground-history-collage-cell" key={`${i}-${src.slice(0, 32)}`}>
          <img src={src} alt="" />
        </span>
      ))}
      {extra > 0 ? <span className="playground-history-badge">+{extra}</span> : null}
    </span>
  );
}



function PlaygroundFieldRenderer({

  field,

  value,

  disabled,

  onChange,

}: {

  field: FieldSpec;

  value: unknown;

  disabled: boolean;

  onChange: (key: string, value: unknown) => void;

}) {

  if (field.type === 'select') {

    return (

      <>

        <label className="inspector-label">{field.label}</label>

        <select

          className="inspector-select"

          disabled={disabled}

          value={String(value ?? field.options[0]?.id ?? '')}

          onChange={(e) => onChange(field.key, e.target.value)}

        >

          {field.options.map((opt) => (

            <option key={opt.id} value={opt.id}>

              {opt.label}

            </option>

          ))}

        </select>

      </>

    );

  }



  const num = Number(value) || 0;

  return (

    <>

      <label className="inspector-label">{field.label}</label>

      <input

        className="inspector-input"

        type="number"

        disabled={disabled}

        min={field.min}

        max={field.max}

        value={num}

        onChange={(e) => {

          let next = parseInt(e.target.value, 10) || 0;

          if (field.min != null) next = Math.max(field.min, next);

          if (field.max != null) next = Math.min(field.max, next);

          onChange(field.key, next);

        }}

      />

    </>

  );

}






export default function PlaygroundPage() {

  const [templateWorkflows, setTemplateWorkflows] = useState<WorkflowSummary[]>([]);

  const [modeSelectValue, setModeSelectValue] = useState(PLAYGROUND_MODE_ID);

  const [templateLoading, setTemplateLoading] = useState(false);

  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);



  const workflowName = useWorkflowStore((s) => s.workflowName);

  const storeIsRunning = useWorkflowStore((s) => s.isRunning);



  const isTemplateMode = modeSelectValue !== PLAYGROUND_MODE_ID;



  const [selectedModelId, setSelectedModelId] = useState(PLAYGROUND_MODELS[0].id);

  const [params, setParams] = useState<Record<string, unknown>>(() =>

    getInitialParams(PLAYGROUND_MODELS[0]),

  );

  const [prompt, setPrompt] = useState('');

  const [references, setReferences] = useState<PlaygroundReference[]>([]);

  const [isRunning, setIsRunning] = useState(false);

  const [statusText, setStatusText] = useState('');

  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [templateResults, setTemplateResults] = useState<TemplateOutputResolved[] | null>(null);

  const [templateHistory, setTemplateHistory] = useState<TemplateHistoryEntry[]>([]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);

  const abortRef = useRef<AbortController | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const templateLoadedRef = useRef(false);



  const model = useMemo(

    () => getPlaygroundModel(selectedModelId) ?? PLAYGROUND_MODELS[0],

    [selectedModelId],

  );



  const fields = model.fields;



  // Image-variation endpoints accept no prompt; edit endpoints cannot run without a reference.

  const usesPrompt = !isTemplateMode && model.promptSupported !== false;

  const missingRequiredRef =

    !isTemplateMode && model.refsRequired === true && references.length === 0;



  const running = isTemplateMode ? storeIsRunning : isRunning;

  const templateResultCards = useMemo(() => {
    if (!templateResults) return [];
    let offset = 0;
    return templateResults.map((out) => {
      const lightboxStart = offset;
      offset += out.images.length;
      return { out, lightboxStart };
    });
  }, [templateResults]);

  const openTemplateLightbox = useCallback(
    (flatIndex: number) => {
      const imgs = templateResults ? templateOutputsToLightboxImages(templateResults) : [];
      if (flatIndex < 0 || flatIndex >= imgs.length) return;
      setLightboxImages(imgs);
      setLightboxIndex(flatIndex);
    },
    [templateResults],
  );

  const openFreePlaygroundLightbox = useCallback(() => {
    if (!result) return;
    setLightboxImages([
      { src: result, label: 'Generated', filename: 'playground.png' },
    ]);
    setLightboxIndex(0);
  }, [result]);



  useEffect(() => {

    let cancelled = false;

    (async () => {

      try {

        const all = await listWorkflows();

        if (cancelled) return;

        setTemplateWorkflows(all.filter((w) => w.has_template));

      } catch {

        if (!cancelled) setTemplateWorkflows([]);

      }

    })();

    return () => {

      cancelled = true;

    };

  }, []);



  useEffect(() => {

    return () => {

      if (templateLoadedRef.current) {

        useWorkflowStore.getState().resetWorkflow();

        templateLoadedRef.current = false;

      }

    };

  }, []);



  const exitTemplateMode = useCallback(() => {

    if (templateLoadedRef.current) {

      useWorkflowStore.getState().resetWorkflow();

      templateLoadedRef.current = false;

    }

    setModeSelectValue(PLAYGROUND_MODE_ID);

    setTemplateResults(null);

    setTemplateLoadError(null);

    setError(null);

    setStatusText('');

  }, []);



  const handleModeChange = useCallback(

    async (nextValue: string) => {

      if (running || templateLoading) return;



      if (nextValue === PLAYGROUND_MODE_ID) {

        exitTemplateMode();

        return;

      }



      setTemplateLoadError(null);

      setTemplateResults(null);

      setError(null);

      setModeSelectValue(nextValue);

      setTemplateLoading(true);



      const ok = await useWorkflowStore.getState().loadWorkflow(nextValue);

      setTemplateLoading(false);



      if (!ok) {

        setTemplateLoadError('Failed to load workflow template.');

        exitTemplateMode();

        return;

      }



      templateLoadedRef.current = true;

      const tpl = useWorkflowStore.getState().template;

      if (!tpl || !(tpl.items?.length || tpl.outputs?.length)) {

        setTemplateLoadError('This workflow has no published template.');

        exitTemplateMode();

      }

    },

    [exitTemplateMode, running, templateLoading],

  );



  const handleModelChange = (nextId: string) => {

    const next = getPlaygroundModel(nextId);

    if (!next) return;

    setSelectedModelId(nextId);

    setParams(getInitialParams(next));

    setReferences((prev) => {

      if (!next.refs.supported) {

        prev.forEach((r) => {

          if (r.previewUrl.startsWith('blob:')) URL.revokeObjectURL(r.previewUrl);

        });

        return [];

      }

      if (prev.length <= next.refs.max) return prev;

      const kept = prev.slice(0, next.refs.max);

      prev.slice(next.refs.max).forEach((r) => {

        if (r.previewUrl.startsWith('blob:')) URL.revokeObjectURL(r.previewUrl);

      });

      return kept;

    });

    setError(null);

  };



  const updateParam = useCallback((key: string, value: unknown) => {

    setParams((p) => ({ ...p, [key]: value }));

  }, []);



  const addReferenceFiles = useCallback(

    (files: FileList | File[]) => {

      if (!model.refs.supported) return;

      const list = Array.from(files).filter((f) => f.type.startsWith('image/'));

      if (list.length === 0) return;

      setReferences((prev) => {

        const room = model.refs.max - prev.length;

        const slice = list.slice(0, Math.max(0, room));

        const added: PlaygroundReference[] = slice.map((file) => ({

          file,

          previewUrl: URL.createObjectURL(file),

        }));

        return [...prev, ...added];

      });

    },

    [model.refs.max, model.refs.supported],

  );



  const removeReference = (index: number) => {

    setReferences((prev) => {

      const ref = prev[index];

      if (ref?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(ref.previewUrl);

      return prev.filter((_, i) => i !== index);

    });

  };



  const handleGenerate = async () => {

    setError(null);

    setIsRunning(true);

    setStatusText('Generating…');

    const controller = new AbortController();

    abortRef.current = controller;



    try {

      const image = await runPlaygroundGeneration({

        model,

        params,

        prompt,

        references,

        signal: controller.signal,

        onImage: (url) => setResult(url),

      });

      setResult(image);

      setHistory((h) => [

        {

          id: crypto.randomUUID(),

          image,

          prompt: prompt.trim(),

          modelLabel: model.label,

          createdAt: Date.now(),

        },

        ...h,

      ]);

      setStatusText('');

    } catch (err: unknown) {

      if (err instanceof Error && err.name === 'AbortError') {

        setStatusText('Cancelled');

      } else {

        const msg = err instanceof Error ? err.message : 'Generation failed';

        setError(msg);

        setStatusText('');

      }

    } finally {

      setIsRunning(false);

      abortRef.current = null;

    }

  };



  const handleGenerateTemplate = async () => {

    const store = useWorkflowStore.getState();

    if (!store.template) {

      setError('No template loaded.');

      return;

    }



    setError(null);

    setStatusText('Running workflow…');

    store.setIsRunning(true);

    store.clearRunProgress();



    const streamingResults: Record<string, any> = {};

    const controller = new AbortController();

    abortRef.current = controller;



    try {

      const workflow = store.getRunWorkflowPayload();

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

      store.setActiveNodeId(null);

      store.setRunResults(mergedResults);



      const errors = formatWorkflowRunErrors(mergedResults);

      if (errors.length > 0) {

        setError(errors.join('\n\n'));

        setStatusText('');

        return;

      }



      const after = useWorkflowStore.getState();

      const outputs = resolveTemplateOutputImages(after.template, after.nodes, after.edges);

      setTemplateResults(outputs);

      setTemplateHistory((h) => [

        {

          id: crypto.randomUUID(),

          outputs,

          workflowName: after.workflowName || 'Workflow',

          createdAt: Date.now(),

        },

        ...h,

      ]);

      setStatusText('');

    } catch (err: unknown) {

      if (err instanceof Error && err.name === 'AbortError') {

        setStatusText('Cancelled');

      } else {

        const msg = err instanceof Error ? err.message : 'Workflow run failed';

        setError(msg);

        setStatusText('');

      }

    } finally {

      abortRef.current = null;

      store.setIsRunning(false);

      store.clearRunProgress();

    }

  };



  const handleCancel = async () => {

    abortRef.current?.abort();

    if (isTemplateMode) {

      await cancelWorkflow();

    } else {

      await cancelPlaygroundRun();

    }

  };



  const onDrop = (e: React.DragEvent) => {

    e.preventDefault();

    if (running || !model.refs.supported) return;

    if (e.dataTransfer.files?.length) addReferenceFiles(e.dataTransfer.files);

  };



  const modeLabel = isTemplateMode

    ? workflowName || 'Workflow template'

    : 'Playground';



  const showTemplateResultsGrid =

    templateResults != null && templateResults.length > 0;



  return (

    <div className="playground-page">

      <div className="playground-mode-bar">

        <label className="playground-mode-label" htmlFor="playground-mode-select">

          Mode

        </label>

        <select

          id="playground-mode-select"

          className="playground-mode-select inspector-select"

          disabled={running || templateLoading}

          value={modeSelectValue}

          onChange={(e) => void handleModeChange(e.target.value)}

        >

          <option value={PLAYGROUND_MODE_ID}>Playground</option>

          {templateWorkflows.map((w) => (

            <option key={w.id} value={w.id}>

              {w.name}

            </option>

          ))}

        </select>

        <span className="playground-mode-hint">{modeLabel}</span>

        {templateLoading ? (

          <span className="playground-mode-loading">Loading template…</span>

        ) : null}

        {templateLoadError ? (

          <span className="playground-error playground-mode-error">{templateLoadError}</span>

        ) : null}

      </div>



      <div className="playground-layout">

        <aside className="playground-panel inspector-panel">

          {isTemplateMode ? (

            <PlaygroundTemplatePanel disabled={templateLoading} />

          ) : (

            <>

              <div className="inspector-section">

                <div className="inspector-section-title">Model</div>

                <label className="inspector-label">Choose model</label>

                <select

                  className="inspector-select"

                  disabled={running}

                  value={selectedModelId}

                  onChange={(e) => handleModelChange(e.target.value)}

                >

                  {PLAYGROUND_MODELS.map((m) => (

                    <option key={m.id} value={m.id}>

                      {m.label} ({m.provider})

                    </option>

                  ))}

                </select>

                <div className="playground-provider-hint">{model.provider}</div>

              </div>



              <div className="inspector-section">

                <div className="inspector-section-title">Settings</div>

                <div className="prop-group">

                  {fields.map((field) => (

                    <PlaygroundFieldRenderer

                      key={field.key}

                      field={field}

                      value={params[field.key]}

                      disabled={running}

                      onChange={updateParam}

                    />

                  ))}

                </div>

              </div>



              {model.refs.supported && (

                <div className="inspector-section">

                  <div className="inspector-section-title">Reference images</div>

                  <p className="playground-ref-hint">

                    Up to {model.refs.max} image{model.refs.max > 1 ? 's' : ''} (optional)

                  </p>

                  <div

                    className="playground-ref-drop"

                    onDragOver={(e) => e.preventDefault()}

                    onDrop={onDrop}

                    onClick={() => !running && fileInputRef.current?.click()}

                    role="button"

                    tabIndex={0}

                    onKeyDown={(e) => {

                      if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();

                    }}

                  >

                    Drop images here or click to browse

                  </div>

                  <input

                    ref={fileInputRef}

                    type="file"

                    accept="image/*"

                    multiple={model.refs.max > 1}

                    className="playground-hidden-input"

                    disabled={running}

                    onChange={(e) => {

                      if (e.target.files) addReferenceFiles(e.target.files);

                      e.target.value = '';

                    }}

                  />

                  {references.length > 0 && (

                    <div className="playground-ref-grid">

                      {references.map((ref, i) => (

                        <div key={ref.previewUrl} className="playground-ref-thumb">

                          <img src={ref.previewUrl} alt={`Reference ${i + 1}`} />

                          <button

                            type="button"

                            className="playground-ref-remove"

                            disabled={running}

                            onClick={() => removeReference(i)}

                            aria-label="Remove reference"

                          >

                            <Icon name="close-line" size={12} />

                          </button>

                        </div>

                      ))}

                    </div>

                  )}

                </div>

              )}

            </>

          )}

        </aside>



        <main className="playground-main">

          {usesPrompt ? (

            <div className="playground-prompt-bar">

              <textarea

                className="playground-prompt-input inspector-textarea"

                placeholder="Describe the image you want to generate…"

                rows={4}

                value={prompt}

                disabled={running}

                onChange={(e) => setPrompt(e.target.value)}

                onKeyDown={(e) => {

                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !running) {

                    e.preventDefault();

                    void handleGenerate();

                  }

                }}

              />

            </div>

          ) : null}



          <div className="playground-actions">

            {running ? (

              <button

                type="button"

                className="inspector-btn-small ghost playground-cancel-btn"

                onClick={() => void handleCancel()}

              >

                Cancel

              </button>

            ) : null}

            <button

              type="button"

              className="inspector-btn playground-generate-btn"

              disabled={

                running ||

                templateLoading ||

                (usesPrompt && !prompt.trim()) ||

                missingRequiredRef

              }

              onClick={() =>

                void (isTemplateMode ? handleGenerateTemplate() : handleGenerate())

              }

            >

              {running ? 'Generating…' : 'Generate'}

            </button>

          </div>

          {missingRequiredRef ? (

            <div className="playground-status">

              This model requires a reference image — add one to generate.

            </div>

          ) : null}

          {statusText ? <div className="playground-status">{statusText}</div> : null}

          {error ? <div className="playground-error">{error}</div> : null}



          <div className="playground-result-area playground-result-area--template">

            {isTemplateMode ? (

              showTemplateResultsGrid ? (

                <div className="playground-result-grid">

                  {templateResultCards.map(({ out, lightboxStart }) => (

                      <div className="playground-output-card" key={out.nodeId}>

                        <div className="playground-output-label">{out.label}</div>

                        {out.images.length === 0 ? (

                          <div className="playground-output-placeholder">No image</div>

                        ) : (

                          <div className="playground-output-images playground-output-images--row">

                            {out.images.map((img, i) => (

                              <button

                                type="button"

                                key={`${out.nodeId}-${i}`}

                                className="playground-output-thumb"

                                onClick={() => openTemplateLightbox(lightboxStart + i)}

                              >

                                <img

                                  src={img}

                                  alt={out.label}

                                  className="playground-result-image"

                                />

                              </button>

                            ))}

                          </div>

                        )}

                      </div>

                    ))}

                </div>

              ) : (

                <div className="playground-result-empty">

                  {running

                    ? 'Waiting for results…'

                    : 'Generated images from your workflow will appear here'}

                </div>

              )

            ) : result ? (

              <button

                type="button"

                className="playground-result-image-btn"

                onClick={openFreePlaygroundLightbox}

              >

                <img src={result} alt="Generated result" className="playground-result-image" />

              </button>

            ) : (

              <div className="playground-result-empty">

                {running ? 'Waiting for image…' : 'Your generated image will appear here'}

              </div>

            )}

          </div>



          {!isTemplateMode && history.length > 0 && (

            <div className="playground-history">

              <div className="playground-history-title">This session</div>

              <div className="playground-history-strip">

                {history.map((entry) => (

                  <button

                    key={entry.id}

                    type="button"

                    className="playground-history-item"

                    title={`${entry.modelLabel}: ${entry.prompt.slice(0, 80)}`}

                    onClick={() => setResult(entry.image)}

                  >

                    <img src={entry.image} alt="" />

                  </button>

                ))}

              </div>

            </div>

          )}



          {isTemplateMode && templateHistory.length > 0 && (

            <div className="playground-history">

              <div className="playground-history-title">This session</div>

              <div className="playground-history-strip">

                {templateHistory.map((entry) => {

                  const allImages = entry.outputs.flatMap((o) => o.images);

                  if (allImages.length === 0) return null;

                  return (

                    <button

                      key={entry.id}

                      type="button"

                      className="playground-history-item playground-history-item--collage"

                      title={`${entry.workflowName} — ${allImages.length} image(s)`}

                      onClick={() => setTemplateResults(entry.outputs)}

                    >

                      <TemplateHistoryCollage images={allImages} />

                    </button>

                  );

                })}

              </div>

            </div>

          )}

        </main>

      </div>

      {lightboxIndex != null && lightboxImages.length > 0 ? (

        <ImageLightbox

          images={lightboxImages}

          index={lightboxIndex}

          onIndexChange={setLightboxIndex}

          onClose={() => {

            setLightboxIndex(null);

            setLightboxImages([]);

          }}

        />

      ) : null}

    </div>

  );

}


