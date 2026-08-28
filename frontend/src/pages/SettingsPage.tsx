import { useCallback, useEffect, useState } from 'react';
import { clearUserFalKey, getAppVersion, getFalKeyStatus, setUserFalKey } from '../utils/api';

export default function SettingsPage() {
  const [falInput, setFalInput] = useState('');
  const [hasFalKey, setHasFalKey] = useState(false);
  const [managedByEnv, setManagedByEnv] = useState(false);
  const [loading, setLoading] = useState(true);
  const [falMessage, setFalMessage] = useState<string | null>(null);
  const [falError, setFalError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFalError(null);
    try {
      const f = await getFalKeyStatus();
      setHasFalKey(f.hasKey);
      setManagedByEnv(f.managedByEnv);
    } catch (e: unknown) {
      setFalError(e instanceof Error ? e.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    getAppVersion().then(setAppVersion);
  }, []);

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
        <h2 className="settings-heading">fal.ai API key</h2>
        <p className="settings-help">
          Every AI node runs on{' '}
          <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">
            fal.ai
          </a>{' '}
          with your personal key — image generation, background removal, and image-to-prompt.
          Keys are kept on the server (not in the browser bundle). You can override per node in
          the inspector if needed.
        </p>

        {loading ? (
          <p className="settings-muted">Loading…</p>
        ) : (
          <>
            <p className="settings-status">
              {managedByEnv ? (
                <span className="settings-ok">Using the FAL_KEY environment variable.</span>
              ) : hasFalKey ? (
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
              {hasFalKey && !managedByEnv && (
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

      {appVersion && <p className="settings-version">SpotOn v{appVersion}</p>}
    </div>
  );
}
