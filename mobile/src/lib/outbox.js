// Offline outbox: new transactions that couldn't reach the server are kept on the
// phone and sent later via POST /transactions/sync. Each carries its client_id, so
// re-sending (e.g. after a timeout where the server actually saved it) never duplicates.
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { post } from './api';
import { refreshMoney } from './queries';

const KEY = 'outbox_v1';
let items = []; // [{ body, meta: { account_name, to_account_name, category_name, queued_at }, error? }]
let loaded = false;
let syncing = false;
const listeners = new Set();

function emit() {
  items = [...items];
  listeners.forEach((l) => l());
}

async function persist() {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  emit();
}

export async function loadOutbox() {
  if (loaded) return;
  loaded = true;
  try {
    items = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
  } catch {
    items = [];
  }
  emit();
}

export async function enqueue(body, meta) {
  await loadOutbox();
  if (items.some((i) => i.body.client_id === body.client_id)) return;
  items.push({ body, meta: { ...meta, queued_at: new Date().toISOString() } });
  await persist();
}

/** Change a queued entry before it syncs (e.g. pick a category on the success screen). */
export async function updateQueued(clientId, bodyPatch, metaPatch = {}) {
  items = items.map((i) => (i.body.client_id === clientId
    ? { ...i, body: { ...i.body, ...bodyPatch }, meta: { ...i.meta, ...metaPatch } }
    : i));
  await persist();
}

export async function discard(clientId) {
  items = items.filter((i) => i.body.client_id !== clientId);
  await persist();
}

export async function clearOutbox() {
  items = [];
  await AsyncStorage.removeItem(KEY);
  emit();
}

/**
 * Try to send everything waiting. Entries the server rejects (e.g. account archived
 * meanwhile) stay with an error so the user can see and discard them.
 * Returns { sent, failed } or null if offline / nothing to do.
 */
export async function syncOutbox() {
  await loadOutbox();
  const pending = items.filter((i) => !i.error);
  if (syncing || !pending.length) return null;
  syncing = true;
  try {
    const { results } = await post('/transactions/sync', { transactions: pending.slice(0, 100).map((i) => i.body) });
    let sent = 0;
    let failed = 0;
    for (const r of results) {
      const idx = items.findIndex((i) => i.body.client_id === r.client_id);
      if (idx === -1) continue;
      if (r.status === 'created' || r.status === 'duplicate') {
        items.splice(idx, 1);
        sent++;
      } else if (r.error === 'server_error') {
        // temporary problem: leave it pending for the next attempt
      } else {
        items[idx] = { ...items[idx], error: r.message || 'Could not be saved' };
        failed++;
      }
    }
    await persist();
    if (sent) await refreshMoney();
    return { sent, failed };
  } catch {
    return null; // still offline or server asleep; try again later
  } finally {
    syncing = false;
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: current outbox entries. */
export function useOutbox() {
  return useSyncExternalStore(subscribe, () => items);
}

/** Errors worth queueing: no connection, timeout, or the server is down/waking up. */
export const isRetryable = (err) => err?.status === 0 || err?.status >= 500;
