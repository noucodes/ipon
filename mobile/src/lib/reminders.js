// Bill and payday reminders as local notifications (scheduled on the phone, work offline).
// Being normal notifications, they also trigger the phone's notification lights.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { occurrences, todayInManila, addDays, formatPHP } from '@ft/shared';

export const REMINDERS_KEY = 'reminders_enabled';
const CHANNEL = 'reminders';
const DAYS_AHEAD = 60;
const MAX_SCHEDULED = 40;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  // Android 13+ only shows the permission prompt once a channel exists.
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Bill & payday reminders',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Ask for notification permission. Returns true if granted. */
export async function requestNotificationPermission() {
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function remindersEnabled() {
  return (await SecureStore.getItemAsync(REMINDERS_KEY)) === 'true';
}

export async function setRemindersEnabled(on) {
  await SecureStore.setItemAsync(REMINDERS_KEY, on ? 'true' : 'false');
  if (!on) await cancelReminders();
}

export async function cancelReminders() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.content.data?.kind === 'reminder')
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

/** Local Date for a 'YYYY-MM-DD' at hour:00 Philippine time. */
function manilaTime(dateStr, hour) {
  return new Date(`${dateStr}T${String(hour).padStart(2, '0')}:00:00+08:00`);
}

/**
 * Replace all scheduled reminders with fresh ones from the income & bills list:
 *   bills  -> 6 PM the day before ("Meralco ₱2,450 is due tomorrow")
 *   income -> 9 AM on the day ("Payday! Salary ₱25,000")
 */
export async function scheduleReminders(items) {
  if (!(await remindersEnabled())) return 0;
  await ensureChannel();
  await cancelReminders();

  const today = todayInManila();
  const until = addDays(today, DAYS_AHEAD);
  const now = Date.now();
  const planned = [];

  for (const item of items) {
    if (!item.active || !item.next_date) continue;
    for (const day of occurrences(item.next_date, item.frequency, today, until)) {
      const isBill = item.kind === 'expense';
      const when = isBill ? manilaTime(addDays(day, -1), 18) : manilaTime(day, 9);
      if (when.getTime() <= now) continue;
      planned.push({
        when,
        title: isBill ? `${item.name} is due tomorrow` : `Payday! ${item.name}`,
        body: isBill
          ? `${formatPHP(item.amount_cents)}${item.account_name ? ` from ${item.account_name}` : ''}`
          : `${formatPHP(item.amount_cents)} expected today${item.account_name ? ` in ${item.account_name}` : ''}`,
      });
    }
  }

  planned.sort((a, b) => a.when - b.when);
  for (const p of planned.slice(0, MAX_SCHEDULED)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: p.title, body: p.body, data: { kind: 'reminder', url: '/plan' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.when, channelId: CHANNEL },
    });
  }
  return Math.min(planned.length, MAX_SCHEDULED);
}
