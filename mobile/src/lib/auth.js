import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { post, get, setAuthToken, setUnauthorizedHandler } from './api';
import { clearCache } from './queryClient';
import { clearOutbox } from './outbox';
import { setLocalUser } from './local';
import { cancelReminders } from './reminders';
import { updateWidget } from '../../modules/wallet-shortcuts';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user'; // last known profile, so the app opens without waiting on the server
const AuthContext = createContext(null);

const saveUser = (user) => SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)).catch(() => {});

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, token: null, user: null });

  useEffect(() => setLocalUser(state.user), [state.user]);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
    setAuthToken(null);
    await clearCache().catch(() => {});
    await clearOutbox(); // queued entries belong to this login
    await cancelReminders().catch(() => {});
    updateWidget({ title: 'Ipon', amount: 'Sign in', subtitle: '' });
    setState({ loading: false, token: null, user: null });
  }, []);

  const finish = useCallback(async ({ token, user }) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await saveUser(user);
    setAuthToken(token);
    setState({ loading: false, token, user });
  }, []);

  // Restore a saved session on launch: open straight away with the saved profile,
  // then check it with the server in the background.
  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) return setState({ loading: false, token: null, user: null });
      setAuthToken(token);
      let saved = null;
      try {
        saved = JSON.parse((await SecureStore.getItemAsync(USER_KEY)) ?? 'null');
      } catch {
        saved = null;
      }
      setState({ loading: false, token, user: saved });
      try {
        const { user } = await get('/auth/me');
        saveUser(user);
        setState((s) => (s.token === token ? { ...s, user } : s));
      } catch {
        // Offline / server asleep: stay signed in with what we know; a 401 already signed us out.
      }
    })();
  }, [signOut]);

  const value = useMemo(() => ({
    ...state,
    signedIn: Boolean(state.token),
    isOwner: state.user?.role === 'owner',
    /** Finished or skipped the setup guide (saved on the account, so it applies on every device). */
    setOnboarded: async (done = true) => {
      const { user } = await post('/auth/onboarded', { done });
      saveUser(user);
      setState((s) => ({ ...s, user }));
    },
    signIn: async (email, password) => finish(await post('/auth/login', { email, password })),
    register: async (body) => finish(await post('/auth/register', body)),
    signOut,
  }), [state, finish, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
