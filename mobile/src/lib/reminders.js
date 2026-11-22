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
export async function scheduleReminders(items, people = []) {
  if (!(await remindersEnabled())) return 0;
  await ensureChannel();
  await cancelReminders();

  const today = todayInManila();
  const until = addDays(today, DAYS_AHEAD);
  const now = Date.now();
  const planned = [];

  for (const item of items) {
    if (!item.active || !item.next_date || item.paid_off) continue;
    let days = occurrences(item.next_date, item.frequency, today, until, item.days_of_month ?? []);
    // Loan payments: only as many reminders as payments are left
    if (item.loan_account_id && item.loan_installment_cents && item.loan_balance_cents < 0) {
      days = days.slice(0, Math.ceil(-item.loan_balance_cents / item.loan_installment_cents));
    }
    for (const day of days) {
      const isBill = item.kind === 'expense';
      const when = isBill ? manilaTime(addDays(day, -1), 18) : manilaTime(day, 9);
      if (when.getTime() <= now) continue;
      planned.push({
        when,
        title: isBill ? `${item.name} is due tomorrow` : `Payday! Log your ${item.name.toLowerCase()}`,
        body: isBill
          ? `${formatPHP(item.amount_cents)}${item.account_name ? ` from ${item.account_name}` : ''}`
          : `About ${formatPHP(item.expected_cents ?? item.amount_cents)} expected. Tap to log what you received.`,
        url: isBill ? '/plan' : `/add?type=income&amount=${item.expected_cents ?? item.amount_cents}&recurring=${item.id}`,
      });
    }
  }

  // Utang due dates: 6 PM the day before
  for (const p of people) {
    if (p.type !== 'person' || p.archived || !p.due_date || !p.balance_cents) continue;
    if (p.due_date < today || p.due_date > until) continue;
    const when = manilaTime(addDays(p.due_date, -1), 18);
    if (when.getTime() <= now) continue;
    const amount = formatPHP(Math.abs(p.balance_cents));
    planned.push({
      when,
      title: p.balance_cents > 0 ? `${p.name}'s ${amount} is due tomorrow` : `You owe ${p.name} ${amount}`,
      body: p.balance_cents > 0 ? 'Time to remind them to pay you back' : 'Due tomorrow',
      url: `/account/${p.id}`,
    });
  }

  planned.sort((a, b) => a.when - b.when);
  for (const p of planned.slice(0, MAX_SCHEDULED)) {
    await Notifications.scheduleNotificationAsync({
      content: { title: p.title, body: p.body, data: { kind: 'reminder', url: p.url ?? '/plan' } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.when, channelId: CHANNEL },
    });
  }
  return Math.min(planned.length, MAX_SCHEDULED);
}
