import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from './ui';
import { useAuth } from '../lib/auth';
import { useTheme, radius } from '../theme';

export const APP_LOCK_KEY = 'app_lock_enabled';
const RELOCK_AFTER_MS = 60_000;

/** Can this phone use fingerprint / face unlock right now? */
export async function biometricsAvailable() {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export function authenticate(message = 'Unlock Ipon') {
  return LocalAuthentication.authenticateAsync({
    promptMessage: message,
    promptSubtitle: 'Use your fingerprint or face',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false, // allow PIN/pattern if fingerprint fails
  });
}

/**
 * Full-screen lock over the whole app while locked. Locks on launch and when the app
 * returns after being in the background for more than a minute.
 */
export function AppLock() {
  const t = useTheme();
  const { signedIn } = useAuth();
  const [enabled, setEnabled] = useState(null); // null = loading
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState(null);
  const leftAt = useRef(null);
  const prompting = useRef(false);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setError(null);
    try {
      const r = await authenticate();
      if (r.success) setLocked(false);
      else if (r.error !== 'user_cancel' && r.error !== 'system_cancel' && r.error !== 'app_cancel') {
        setError(r.error === 'lockout' ? 'Too many attempts. Try again shortly.' : "Couldn't verify. Try again.");
      }
    } finally {
      prompting.current = false;
    }
  }, []);

  // Read the setting (and re-read when the user signs in/out).
  useEffect(() => {
    SecureStore.getItemAsync(APP_LOCK_KEY).then((v) => {
      setEnabled(v === 'true');
      // Turned off at launch: start unlocked, so switching it on later doesn't lock instantly.
      if (v !== 'true') setLocked(false);
    });
  }, [signedIn]);

  // Prompt right away when locked.
  useEffect(() => {
    if (enabled && signedIn && locked) unlock();
  }, [enabled, signedIn, locked, unlock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'background') leftAt.current = Date.now();
      if (state === 'active') {
        const on = (await SecureStore.getItemAsync(APP_LOCK_KEY)) === 'true';
        setEnabled(on);
        if (on && leftAt.current && Date.now() - leftAt.current > RELOCK_AFTER_MS) setLocked(true);
        leftAt.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  if (!enabled || !signedIn || !locked) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.hero, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 32 }]}>
      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="finger-print" size={44} color={t.primaryText} />
      </View>
      <Text style={{ fontSize: 22, fontWeight: '800', color: t.heroText }}>Ipon is locked</Text>
      {error && <Text style={{ color: t.danger, fontWeight: '600' }}>{error}</Text>}
      <Pressable onPress={unlock} style={({ pressed }) => ({ backgroundColor: t.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.pill, opacity: pressed ? 0.8 : 1 })}>
        <Text style={{ color: t.primaryText, fontWeight: '800', fontSize: 16 }}>Unlock</Text>
      </Pressable>
    </View>
  );
}
