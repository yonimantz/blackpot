import { useCallback, useEffect, useState } from 'react';
import {
  clearUserGeminiKey,
  clearUserOpenAIKey,
  getGeminiKeyStatus,
  getOpenAIKeyStatus,
  setUserGeminiKey,
  setUserOpenAIKey,
} from '../utils/api';
import { useAuth } from '../auth/AuthContext';

export default function SettingsPage() {
  const { firebaseEnabled } = useAuth();
  const [geminiInput, setGeminiInput] = useState('');
  const [openaiInput, setOpenaiInput] = useState('');
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [hasOpenAIKey, setHasOpenAIKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [geminiMessage, setGeminiMessage] = useState<string | null>(null);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [openaiMessage, setOpenaiMessage] = useState<string | null>(null);
  const [openaiError, setOpenaiError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setGeminiError(null);
    setOpenaiError(null);
    try {
      const [g, o] = await Promise.all([getGeminiKeyStatus(), getOpenAIKeyStatus()]);
      setHasGeminiKey(g.hasKey);
      setHasOpenAIKey(o.hasKey);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not load settings';
      setGeminiError(msg);
      setOpenaiError(msg);
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
        ) : !firebaseEnabled ? (
          <p className="settings-muted">
            Firebase Auth is not configured for this build. Set <code>VITE_FIREBASE_*</code> in{' '}
            <code>frontend/.env.local</code> for sign-in and per-user keys. For local use, set{' '}
            <code>GEMINI_API_KEY</code> in <code>backend/.env</code>
            {hasGeminiKey ? ' (server reports a key is configured).' : '.'}
          </p>
        ) : (
          <>
            <p className="settings-status">
              {hasGeminiKey ? (
                <span className="settings-ok">A personal API key is saved for your account.</span>
              ) : (
                <span className="settings-warn">No personal key saved yet.</span>
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
        ) : !firebaseEnabled ? (
          <p className="settings-muted">
            Firebase Auth is not configured for this build. Set <code>VITE_FIREBASE_*</code> in{' '}
            <code>frontend/.env.local</code> for sign-in and per-user keys. For local use, set{' '}
            <code>OPENAI_API_KEY</code> in <code>backend/.env</code>
            {hasOpenAIKey ? ' (server reports a key is configured).' : '.'}
          </p>
        ) : (
          <>
            <p className="settings-status">
              {hasOpenAIKey ? (
                <span className="settings-ok">A personal OpenAI API key is saved for your account.</span>
              ) : (
                <span className="settings-warn">No personal OpenAI key saved yet.</span>
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
    </div>
  );
}
