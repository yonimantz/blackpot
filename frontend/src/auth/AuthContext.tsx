import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { API_BASE, authFetch } from '../utils/api';
import { getFirebaseAuth, isFirebaseConfigured } from '../firebase';

export type AuthContextValue = {
  firebaseEnabled: boolean;
  user: User | null;
  loading: boolean;
  /** Shown on the login screen after sign-in was rejected by the backend allowlist. */
  authInviteMessage: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmailPassword: (email: string, password: string) => Promise<void>;
  signUpWithEmailPassword: (email: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

const noop: AuthContextValue = {
  firebaseEnabled: false,
  user: null,
  loading: false,
  authInviteMessage: null,
  signInWithGoogle: async () => {},
  signInWithEmailPassword: async () => {},
  signUpWithEmailPassword: async () => {},
  signOutUser: async () => {},
  getIdToken: async () => null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured());
  const [authInviteMessage, setAuthInviteMessage] = useState<string | null>(null);
  const inviteRejectionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUser(null);
        setLoading(false);
        const rejected = inviteRejectionRef.current;
        inviteRejectionRef.current = null;
        setAuthInviteMessage(rejected);
        return;
      }

      setLoading(true);
      setAuthInviteMessage(null);

      void (async () => {
        try {
          const res = await authFetch(`${API_BASE}/session`);
          if (res.status === 403) {
            const body = (await res.json().catch(() => null)) as { detail?: string } | null;
            const detail =
              typeof body?.detail === 'string'
                ? body.detail
                : 'Your email is not on the invite list for this app.';
            inviteRejectionRef.current = detail;
            await signOut(auth);
            return;
          }
          if (res.ok) {
            setUser(u);
            return;
          }
          // Backend unreachable or other error — allow signed-in UI (API calls may still fail).
          setUser(u);
        } finally {
          setLoading(false);
        }
      })();
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthInviteMessage(null);
    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  }, []);

  const signInWithEmailPassword = useCallback(async (email: string, password: string) => {
    setAuthInviteMessage(null);
    const auth = getFirebaseAuth();
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signUpWithEmailPassword = useCallback(async (email: string, password: string) => {
    setAuthInviteMessage(null);
    const auth = getFirebaseAuth();
    await createUserWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signOutUser = useCallback(async () => {
    inviteRejectionRef.current = null;
    setAuthInviteMessage(null);
    await signOut(getFirebaseAuth());
  }, []);

  const getIdToken = useCallback(async () => {
    const auth = getFirebaseAuth();
    const u = auth.currentUser;
    if (!u) return null;
    return u.getIdToken();
  }, []);

  const value = useMemo<AuthContextValue>(
    () =>
      isFirebaseConfigured()
        ? {
            firebaseEnabled: true,
            user,
            loading,
            authInviteMessage,
            signInWithGoogle,
            signInWithEmailPassword,
            signUpWithEmailPassword,
            signOutUser,
            getIdToken,
          }
        : noop,
    [
      user,
      loading,
      authInviteMessage,
      signInWithGoogle,
      signInWithEmailPassword,
      signUpWithEmailPassword,
      signOutUser,
      getIdToken,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
