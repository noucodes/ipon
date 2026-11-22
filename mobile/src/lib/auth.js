import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { post, get, setAuthToken, setUnauthorizedHandler } from './api';
import { queryClient } from './queryClient';
import { clearOutbox } from './outbox';
import { cancelReminders } from './reminders';
import { updateWidget } from '../../modules/wallet-shortcuts';

const TOKEN_KEY = 'auth_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, token: null, user: null });

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setAuthToken(null);
    queryClient.clear();
    await clearOutbox(); // queued entries belong to this login
    await cancelReminders().catch(() => {});
    updateWidget({ title: 'Ipon', amount: 'Sign in', subtitle: '' });
    setState({ loading: false, token: null, user: null });
  }, []);

  const finish = useCallback(async ({ token, user }) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setAuthToken(token);
    setState({ loading: false, token, user });
  }, []);

  // Restore a saved session on launch.
  useEffect(() => {
    setUnauthorizedHandler(() => signOut());
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) return setState({ loading: false, token: null, user: null });
      setAuthToken(token);
      try {
        const { user } = await get('/auth/me');
        setState({ loading: false, token, user });
      } catch (err) {
        // Offline / server asleep: stay signed in with what we know; 401 already signed us out.
        if (err.status === 401) return;
        setState({ loading: false, token, user: null });
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
