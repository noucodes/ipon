import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Row, Section, SwitchRow } from './ui';
import { APP_LOCK_KEY, authenticate, biometricsAvailable } from './AppLock';
import { useAuth } from '../lib/auth';
import { useAccounts, useRecurring } from '../lib/queries';
import { remindersEnabled, requestNotificationPermission, scheduleReminders, setRemindersEnabled } from '../lib/reminders';
import { detection, isAvailable as nativeAvailable } from '../../modules/wallet-shortcuts';

export function SmartFeatures() {
  const { isOwner } = useAuth();
  const recurring = useRecurring();
  const accounts = useAccounts();
  const [lock, setLock] = useState(false);
  const [reminders, setReminders] = useState(false);
  const [detect, setDetect] = useState({ active: false, access: false });
  const [note, setNote] = useState(null);

  const refreshDetect = useCallback(() => setDetect({ active: detection.isActive(), access: detection.hasAccess() }), []);

  useEffect(() => {
    SecureStore.getItemAsync(APP_LOCK_KEY).then((v) => setLock(v === 'true'));
    remindersEnabled().then(setReminders);
    refreshDetect();
    // Coming back from Android's Notification access screen
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshDetect());
    return () => sub.remove();
  }, [refreshDetect]);

  async function toggleLock(on) {
    setNote(null);
    if (on && !(await biometricsAvailable())) {
      setNote('Set up a fingerprint or face unlock in your phone settings first.');
      return;
    }
    const r = await authenticate(on ? 'Confirm to turn on app lock' : 'Confirm to turn off app lock');
    if (!r.success) return;
    await SecureStore.setItemAsync(APP_LOCK_KEY, on ? 'true' : 'false');
    setLock(on);
  }

  async function toggleReminders(on) {
    setNote(null);
    if (on && !(await requestNotificationPermission())) {
      setNote('Notifications are blocked. Allow them for Ipon in your phone settings.');
      return;
    }
    await setRemindersEnabled(on);
    setReminders(on);
    if (on) {
      const n = await scheduleReminders(recurring.data ?? [], accounts.data ?? []);
      setNote(n ? `${n} reminder${n === 1 ? '' : 's'} scheduled.` : 'On. Add next dates to your income & bills to get reminders.');
    }
  }

  async function toggleDetect(on) {
    setNote(null);
    if (on) await requestNotificationPermission(); // needed to show "Log ₱500?" suggestions
    detection.setActive(on);
    refreshDetect();
    if (on && !detection.hasAccess()) detection.openSettings();
  }

  const needsAccess = detect.active && !detect.access;
  const footer = note
    ?? (needsAccess
      ? 'If Android says "Restricted setting": Settings → Apps → Ipon → ⋮ → Allow restricted settings, then try again.'
      : 'Payment alerts are read on this phone only. Nothing is uploaded.');

  return (
    <Section title="Smart features" footer={footer}>
      <SwitchRow icon="finger-print" iconColor="#0B6B4F" label="Fingerprint lock" hint="When opening the app" value={lock} onValueChange={toggleLock} />
      <SwitchRow icon="notifications-outline" iconColor="#F59E0B" label="Reminders" hint="Bills, utang & payday" value={reminders} onValueChange={toggleReminders} />
      {isOwner && nativeAvailable && (
        <SwitchRow icon="sparkles-outline" iconColor="#C9971C" label="Detect payments" hint="GCash, Maya, banks & BillEase alerts" value={detect.active} onValueChange={toggleDetect} />
      )}
      {isOwner && nativeAvailable && needsAccess && (
        <Row icon="alert-circle-outline" danger label="Allow notification access" hint='Turn on "Ipon payment detection"' onPress={() => detection.openSettings()} />
      )}
      {isOwner && !nativeAvailable && (
        <Row icon="sparkles-outline" iconColor="#C9971C" label="Detect payments" hint="Works in the installed app, not Expo Go" />
      )}
    </Section>
  );
}
