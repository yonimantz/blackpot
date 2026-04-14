import { useCallback, useEffect, useState } from 'react';
import {
  clearUserGeminiKey,
  getGeminiKeyStatus,
  setUserGeminiKey,
} from '../utils/api';
import { useAuth } from '../auth/AuthContext';

export default function SettingsPage() {
  const { firebaseEnabled } = useAuth();
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getGeminiKeyStatus();
      setHasKey(s.hasKey);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    setMessage(null);
    setError(null);
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setError('Paste your Google AI Studio API key first.');
      return;
    }
    try {
      await setUserGeminiKey(trimmed);
      setKeyInput('');
      setMessage('API key saved. It is stored on the server and never shown again.');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const clear = async () => {
    setMessage(null);
    setError(null);
    try {
      await clearUserGeminiKey();
      setMessage('Stored API key removed.');
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Clear failed');
    }
  };

  return (
    <div className="settings-page">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-section">
        <h2 className="settings-heading">Gemini API key</h2>
        <p className="settings-help">
          AI image nodes use your personal key from{' '}
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
            {hasKey ? ' (server reports a key is configured).' : '.'}
          </p>
        ) : (
          <>
            <p className="settings-status">
              {hasKey ? (
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
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <div className="settings-actions">
              <button type="button" className="settings-btn settings-btn-primary" onClick={save}>
                Save key
              </button>
              {hasKey && (
                <button type="button" className="settings-btn settings-btn-danger" onClick={clear}>
                  Remove stored key
                </button>
              )}
            </div>
          </>
        )}

        {message && <p className="settings-success">{message}</p>}
        {error && <p className="settings-error">{error}</p>}
      </section>
    </div>
  );
}
