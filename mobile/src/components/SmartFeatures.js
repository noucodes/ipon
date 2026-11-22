import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Body, Button, Card, Label, ToggleRow } from './ui';
import { APP_LOCK_KEY, authenticate, biometricsAvailable } from './AppLock';
import { useAuth } from '../lib/auth';
import { useRecurring } from '../lib/queries';
import { remindersEnabled, requestNotificationPermission, scheduleReminders, setRemindersEnabled } from '../lib/reminders';
import { detection, isAvailable as nativeAvailable } from '../../modules/wallet-shortcuts';
import { useTheme } from '../theme';

export function SmartFeatures() {
  const t = useTheme();
  const { isOwner } = useAuth();
  const recurring = useRecurring();
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
      setNote('Notifications are blocked. Allow them for Finance Tracker in your phone settings.');
      return;
    }
    await setRemindersEnabled(on);
    setReminders(on);
    if (on) {
      const n = await scheduleReminders(recurring.data ?? []);
      setNote(n ? `${n} reminder${n === 1 ? '' : 's'} scheduled from your income & bills.` : 'On. Add a next date to your income & bills to get reminders.');
    }
  }

  async function toggleDetect(on) {
    setNote(null);
    if (on) await requestNotificationPermission(); // needed to show "Log ₱500?" suggestions
    detection.setActive(on);
    refreshDetect();
    if (on && !detection.hasAccess()) detection.openSettings();
  }

  return (
    <Card>
      <Label>Smart features</Label>

      <ToggleRow
        label="Fingerprint lock"
        hint="Ask for your fingerprint or face when opening the app"
        value={lock}
        onValueChange={toggleLock}
      />

      <ToggleRow
        label="Bill & payday reminders"
        hint="The evening before a bill is due, and on payday morning"
        value={reminders}
        onValueChange={toggleReminders}
      />

      {isOwner && (
        nativeAvailable ? (
          <>
            <ToggleRow
              label="Detect GCash, Maya & bank payments"
              hint="Reads payment alerts on this phone and offers to log them. Nothing is uploaded."
              value={detect.active}
              onValueChange={toggleDetect}
            />
            {detect.active && !detect.access && (
              <>
                <Body style={{ color: t.danger, fontSize: 13 }}>
                  Needs Notification access: turn on "Finance Tracker payment detection".
                </Body>
                <Body muted style={{ fontSize: 12 }}>
                  If Android says "Restricted setting": Settings → Apps → Finance Tracker → ⋮ (top right) → Allow restricted settings, then try again.
                </Body>
                <Button title="Open Notification access" variant="secondary" icon="notifications-outline" onPress={() => detection.openSettings()} />
              </>
            )}
            {detect.active && detect.access && (
              <Body muted style={{ fontSize: 13 }}>Watching for payment alerts. Detected ones appear on Home.</Body>
            )}
          </>
        ) : (
          <Body muted style={{ fontSize: 13 }}>Payment detection works in the installed app, not in Expo Go.</Body>
        )
      )}

      {note && <Body muted style={{ fontSize: 13 }}>{note}</Body>}
    </Card>
  );
}
