import { useState } from 'react';
import { useAuth } from './AuthContext';

function formatAuthError(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = String((e as { code?: string }).code);
    switch (code) {
      case 'auth/email-already-in-use':
        return 'An account already exists for this email. Use Sign in.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-login-credentials':
        return 'Incorrect email or password.';
      case 'auth/weak-password':
        return 'Password must be at least 6 characters.';
      case 'auth/invalid-email':
        return 'Enter a valid email address.';
      case 'auth/operation-not-allowed':
        return 'Email/password sign-in is not enabled. In Firebase Console → Authentication → Sign-in method, enable Email/Password.';
      default:
        break;
    }
  }
  if (e instanceof Error) {
    const lower = e.message.toLowerCase();
    if (lower.includes('configuration-not-found') || lower.includes('configuration_not_found')) {
      return 'Firebase Authentication is not set up for this project. Open Firebase Console → Authentication → Get started, then enable Email/Password and/or Google. Add localhost under Authentication → Settings → Authorized domains.';
    }
    return e.message;
  }
  return 'Sign-in failed';
}

export default function LoginPage() {
  const { signInWithGoogle, signInWithEmailPassword, signUpWithEmailPassword, authInviteMessage } =
    useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSignInGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e: unknown) {
      setError(formatAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const onEmailSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithEmailPassword(email, password);
    } catch (e: unknown) {
      setError(formatAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  const onEmailSignUp = async () => {
    setError(null);
    setBusy(true);
    try {
      await signUpWithEmailPassword(email, password);
    } catch (e: unknown) {
      setError(formatAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/Logo2.svg" alt="" width={200} height={56} className="auth-logo" />
        <p className="auth-subtitle">
          Use an <strong>invited</strong> email (same one as on the server allowlist). Firebase may create a
          login, but the app only opens if that address is invited. Sign in or create an account with email
          and password, or use Google (account picker every time).
        </p>
        {authInviteMessage && <p className="auth-error">{authInviteMessage}</p>}
        {error && <p className="auth-error">{error}</p>}

        <div className="auth-email-block">
          <label className="settings-label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            className="settings-input auth-email-input"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <label className="settings-label" htmlFor="auth-password">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            className="settings-input auth-email-input"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          <div className="auth-email-actions">
            <button
              type="button"
              className="settings-btn settings-btn-primary"
              onClick={onEmailSignIn}
              disabled={busy}
            >
              {busy ? '…' : 'Sign in'}
            </button>
            <button type="button" className="settings-btn" onClick={onEmailSignUp} disabled={busy}>
              Create account
            </button>
          </div>
        </div>

        <div className="auth-divider" aria-hidden>
          <span>or</span>
        </div>

        <button type="button" className="auth-google-btn" onClick={onSignInGoogle} disabled={busy}>
          {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
      </div>
    </div>
  );
}
