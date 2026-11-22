// In-app view of payments the phone detected from GCash / Maya / bank notifications.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { detection } from '../../modules/wallet-shortcuts';

/** Detected items, refreshed whenever the app comes to the foreground. */
export function useDetections() {
  const [items, setItems] = useState(() => detection.list());
  const refresh = useCallback(() => setItems(detection.list()), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);
  const dismiss = useCallback((id) => { detection.remove(id); refresh(); }, [refresh]);
  return { items, refresh, dismiss };
}

/** Deep link that opens quick add pre-filled with a detection. */
export function detectionHref(d) {
  const type = d.type === 'loan_payment' ? 'transfer' : d.type; // loan payments go into the loan account
  return `/add?type=${type}&amount=${d.amount_cents}&source=${encodeURIComponent(d.source)}&detection=${d.id}`;
}

/** Best guess at which of your accounts a source ("GCash", "BDO") refers to. */
export function matchAccount(accounts, source) {
  if (!source) return null;
  const s = source.toLowerCase().replace(/\s/g, '');
  return accounts.find((a) => a.name.toLowerCase().replace(/\s/g, '').includes(s)) ?? null;
}
