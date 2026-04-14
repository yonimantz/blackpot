import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import LoginPage from './LoginPage';

/** When Firebase env is set, require sign-in (email/password or Google) before showing the app. */
export default function ProtectedApp({ children }: { children: ReactNode }) {
  const { firebaseEnabled, user, loading } = useAuth();

  if (!firebaseEnabled) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card--plain">
          <p className="auth-subtitle">Loading…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
