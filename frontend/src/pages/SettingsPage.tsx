import { useCallback, useEffect, useState } from 'react';
import {
  clearUserFalKey,
  clearUserGeminiKey,
  clearUserOpenAIKey,
  getFalKeyStatus,
  getGeminiKeyStatus,
  getOpenAIKeyStatus,
  setUserFalKey,
  setUserGeminiKey,
  setUserOpenAIKey,
} from '../utils/api';

export default function SettingsPage() {
  const [geminiInput, setGeminiInput] = useState('');
  const [openaiInput, setOpenaiInput] = useState('');
  const [falInput, setFalInput] = useState('');
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [hasOpenAIKey, setHasOpenAIKey] = useState(false);
  const [hasFalKey, setHasFalKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [geminiMessage, setGeminiMessage] = useState<string | null>(null);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [openaiMessage, setOpenaiMessage] = useState<string | null>(null);
  const [openaiError, setOpenaiError] = useState<string | null>(null);
  const [falMessage, setFalMessage] = useState<string | null>(null);
  const [falError, setFalError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setGeminiError(null);
    setOpenaiError(null);
    setFalError(null);
    try {
      const [g, o, f] = await Promise.all([
        getGeminiKeyStatus(),
        getOpenAIKeyStatus(),
        getFalKeyStatus(),
      ]);
      setHasGeminiKey(g.hasKey);
      setHasOpenAIKey(o.hasKey);
      setHasFalKey(f.hasKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not load settings';
      setGeminiError(msg);
      setOpenaiError(msg);
      setFalError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveGemini = async () => {
    setGeminiMessage(null);
    setGeminiError(null);
    const trimmed = geminiInput.trim();
    if (!trimmed) {
      setGeminiError('Paste your Google AI Studio API key first.');
      return;
    }
    try {
      await setUserGeminiKey(trimmed);
      setGeminiInput('');
      setGeminiMessage('API key saved. It is stored on the server and never shown again.');
      await refresh();
    } catch (e: unknown) {
      setGeminiError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const clearGemini = async () => {
    setGeminiMessage(null);
    setGeminiError(null);
    try {
      await clearUserGeminiKey();
      setGeminiMessage('Stored API key removed.');
      await refresh();
    } catch (e: unknown) {
      setGeminiError(e instanceof Error ? e.message : 'Clear failed');
    }
  };

  const saveOpenAI = async () => {
    setOpenaiMessage(null);
    setOpenaiError(null);
    const trimmed = openaiInput.trim();
    if (!trimmed) {
      setOpenaiError('Paste your OpenAI API key first.');
      return;
    }
    try {
      await setUserOpenAIKey(trimmed);
      setOpenaiInput('');
      setOpenaiMessage('API key saved. It is stored on the server and never shown again.');
      await refresh();
    } catch (e: unknown) {
      setOpenaiError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const clearOpenAI = async () => {
    setOpenaiMessage(null);
    setOpenaiError(null);
    try {
      await clearUserOpenAIKey();
      setOpenaiMessage('Stored API key removed.');
      await refresh();
    } catch (e: unknown) {
      setOpenaiError(e instanceof Error ? e.message : 'Clear failed');
    }
  };

  const saveFal = async () => {
    setFalMessage(null);
    setFalError(null);
    const trimmed = falInput.trim();
    if (!trimmed) {
      setFalError('Paste your fal.ai API key first.');
      return;
    }
    try {
      await setUserFalKey(trimmed);
      setFalInput('');
      setFalMessage('API key saved. It is stored on the server and never shown again.');
      await refresh();
    } catch (e: unknown) {
      setFalError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const clearFal = async () => {
    setFalMessage(null);
    setFalError(null);
    try {
      await clearUserFalKey();
      setFalMessage('Stored API key removed.');
      await refresh();
    } catch (e: unknown) {
      setFalError(e instanceof Error ? e.message : 'Clear failed');
    }
  };

  return (
    <div className="settings-page">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-section">
        <h2 className="settings-heading">Gemini API key</h2>
        <p className="settings-help">
          Gemini-based AI nodes use your personal key from{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          . Keys are kept on the server (not in the browser bundle). You can still override per node in
          the inspector if needed.
        </p>

        {loading ? (
          <p className="settings-muted">Loading…</p>
        ) : (
          <>
            <p className="settings-status">
              {hasGeminiKey ? (
                <span className="settings-ok">A Gemini API key is saved.</span>
              ) : (
                <span className="settings-warn">No key saved yet.</span>
              )}
            </p>
            <label className="settings-label" htmlFor="gemini-key">
              Paste API key
            </label>
            <input
              id="gemini-key"
              type="password"
              className="settings-input"
              autoComplete="off"
              placeholder="AIza…"
              value={geminiInput}
              onChange={(e) => setGeminiInput(e.target.value)}
            />
            <div className="settings-actions">
              <button type="button" className="settings-btn settings-btn-primary" onClick={saveGemini}>
                Save key
              </button>
              {hasGeminiKey && (
                <button type="button" className="settings-btn settings-btn-danger" onClick={clearGemini}>
                  Remove stored key
                </button>
              )}
            </div>
          </>
        )}

        {geminiMessage && <p className="settings-success">{geminiMessage}</p>}
        {geminiError && <p className="settings-error">{geminiError}</p>}
      </section>

      <section className="settings-section">
        <h2 className="settings-heading">OpenAI API key</h2>
        <p className="settings-help">
          The <strong>GPT Image 2</strong> node uses your personal key from{' '}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
            OpenAI
          </a>
          . Keys are kept on the server (not in the browser bundle). You can override per node in the
          inspector if needed.
        </p>
        <p className="settings-help" style={{ marginTop: '-0.5rem' }}>
          OpenAI may return <strong>403</strong> until your{' '}
          <a href="https://platform.openai.com/settings/organization/general" target="_blank" rel="noreferrer">
            organization is verified
          </a>{' '}
          for GPT Image models; after verifying, wait up to ~15 minutes for access.
        </p>

        {loading ? (
          <p className="settings-muted">Loading…</p>
        ) : (
          <>
            <p className="settings-status">
              {hasOpenAIKey ? (
                <span className="settings-ok">An OpenAI API key is saved.</span>
              ) : (
                <span className="settings-warn">No key saved yet.</span>
              )}
            </p>
            <label className="settings-label" htmlFor="openai-key">
              Paste API key
            </label>
            <input
              id="openai-key"
              type="password"
              className="settings-input"
              autoComplete="off"
              placeholder="sk-…"
              value={openaiInput}
              onChange={(e) => setOpenaiInput(e.target.value)}
            />
            <div className="settings-actions">
              <button type="button" className="settings-btn settings-btn-primary" onClick={saveOpenAI}>
                Save key
              </button>
              {hasOpenAIKey && (
                <button type="button" className="settings-btn settings-btn-danger" onClick={clearOpenAI}>
                  Remove stored key
                </button>
              )}
            </div>
          </>
        )}

        {openaiMessage && <p className="settings-success">{openaiMessage}</p>}
        {openaiError && <p className="settings-error">{openaiError}</p>}
      </section>

      <section className="settings-section">
        <h2 className="settings-heading">fal.ai API key</h2>
        <p className="settings-help">
          The <strong>FAL AI</strong> node uses your personal key from{' '}
          <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">
            fal.ai
          </a>
          . It runs FLUX, Stable Diffusion 3.5, SDXL and similar models. Keys are
          kept on the server (not in the browser bundle). You can override per node
          in the inspector if needed.
        </p>

        {loading ? (
          <p className="settings-muted">Loading…</p>
        ) : (
          <>
            <p className="settings-status">
              {hasFalKey ? (
                <span className="settings-ok">A fal.ai API key is saved.</span>
              ) : (
                <span className="settings-warn">No key saved yet.</span>
              )}
            </p>
            <label className="settings-label" htmlFor="fal-key">
              Paste API key
            </label>
            <input
              id="fal-key"
              type="password"
              className="settings-input"
              autoComplete="off"
              placeholder="fal-…"
              value={falInput}
              onChange={(e) => setFalInput(e.target.value)}
            />
            <div className="settings-actions">
              <button type="button" className="settings-btn settings-btn-primary" onClick={saveFal}>
                Save key
              </button>
              {hasFalKey && (
                <button type="button" className="settings-btn settings-btn-danger" onClick={clearFal}>
                  Remove stored key
                </button>
              )}
            </div>
          </>
        )}

        {falMessage && <p className="settings-success">{falMessage}</p>}
        {falError && <p className="settings-error">{falError}</p>}
      </section>
    </div>
  );
}
