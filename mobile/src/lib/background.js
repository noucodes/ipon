// App-wide side effects while signed in:
//  - sync the offline outbox on launch, when the app comes back to the foreground,
//    and every 30s while anything is waiting
//  - register the long-press icon shortcuts
//  - keep the home-screen widget's balance up to date
import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { formatPHP } from '@ft/shared';
import { loadOutbox, syncOutbox, useOutbox } from './outbox';
import { useAuth } from './auth';
import { useAccounts, useHousehold, useRecurring, useSummary } from './queries';
import { scheduleReminders } from './reminders';
import { setShortcuts, updateWidget } from '../../modules/wallet-shortcuts';

export const WIDGET_SHOW_BALANCE_KEY = 'widget_show_balance';

export async function pushWidget(summary, ownerName, isOwner) {
  if (!summary) return;
  const show = (await SecureStore.getItemAsync(WIDGET_SHOW_BALANCE_KEY)) !== 'false';
  const time = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  updateWidget({
    title: isOwner || !ownerName ? 'Net worth' : `${ownerName}'s wallet`,
    amount: show ? formatPHP(summary.balances.net_worth_cents) : '₱ ••••••',
    subtitle: `Updated ${time}`,
  });
}

/** Mount inside AuthProvider. Does nothing while signed out. */
export function BackgroundTasks() {
  const { signedIn } = useAuth();
  return signedIn ? <SignedInTasks /> : null;
}

function SignedInTasks() {
  const { signedIn, isOwner } = useAuth();
  const outbox = useOutbox();
  const summary = useSummary();
  const household = useHousehold();
  const recurring = useRecurring();
  const accounts = useAccounts();
  const ownerName = household.data?.members.find((m) => m.role === 'owner')?.display_name;
  const waiting = outbox.some((i) => !i.error);

  useEffect(() => {
    if (!signedIn) return;
    setShortcuts();
    loadOutbox().then(syncOutbox);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncOutbox();
    });
    return () => sub.remove();
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || !waiting) return;
    const timer = setInterval(syncOutbox, 30_000);
    return () => clearInterval(timer);
  }, [signedIn, waiting]);

  useEffect(() => {
    if (signedIn && summary.data) pushWidget(summary.data, ownerName, isOwner);
  }, [signedIn, summary.data, ownerName, isOwner]);

  // Keep bill/payday reminders in step with the income & bills list (if switched on).
  useEffect(() => {
    if (signedIn && recurring.data) scheduleReminders(recurring.data, accounts.data ?? []).catch((e) => console.warn('reminders', e));
  }, [signedIn, recurring.data, accounts.data]);

  return null;
}
