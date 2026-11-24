// Outbox: every transaction, account and bill/income you add, edit or delete is saved here
// first and applied to the numbers on the phone straight away (see local.js). It then syncs
// in the background, in the order you made the changes (so a new account reaches the server
// before the transactions logged on it):
//   transactions: new ones via POST /transactions/sync (each carries its client_id, so
//                 re-sending never duplicates), edits via PATCH, deletes via DELETE
//   accounts / bills: the phone picks the id, so POST can be retried safely too
//
// Entry: { entity?: 'tx' | 'account' | 'recurring', op: 'create' | 'update' | 'delete', id?,
//          body, meta, change: { entity, before, after }, error? }
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { del, patch, post } from './api';
import { applyChange, isLocalId, keepPendingOnTop, refreshMoney, toAccountRow, toRecurringRow, toRow } from './local';

const KEY = 'outbox_v1';
let items = [];
let loaded = false;
let syncing = null; // promise while a sync is running
let again = false; // something new arrived during a sync
let status = { online: true, lastError: null }; // result of the last attempt
const listeners = new Set();
const serverIds = new Map(); // transaction client_id -> server id, for entries that already synced
const syncedWaiters = new Map(); // client_id -> [resolve]

function emit() {
  items = [...items];
  listeners.forEach((l) => l());
}

async function persist() {
  emit();
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

const opOf = (i) => i.op ?? 'create'; // entries saved by older versions were all new transactions
const entityOf = (i) => i.entity ?? 'tx';
const isTx = (i) => entityOf(i) === 'tx';
const pendingChanges = () => items.filter((i) => !i.error && i.change).map((i) => i.change);
const now = () => new Date().toISOString();

/** Undo a change on the phone (the server turned it down, or it was discarded). */
const undo = (change) => change && applyChange({ entity: change.entity, before: change.after, after: change.before });

// Fresh server data always gets the not-yet-synced changes put back on top.
keepPendingOnTop(pendingChanges);

export async function loadOutbox() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
    items = [...saved, ...items.filter((i) => !saved.some((s) => s.body?.client_id && s.body.client_id === i.body?.client_id))];
  } catch {
    // keep whatever was added this session
  }
  emit();
}

// ================================================================ transactions

const findCreate = (clientId) => items.find((i) => isTx(i) && opOf(i) === 'create' && i.body.client_id === clientId);

/**
 * Save a new transaction on the phone. It shows up in balances and lists right away and
 * syncs in the background. Returns the local row.
 */
export async function addTransaction(body, meta = {}) {
  await loadOutbox();
  if (findCreate(body.client_id)) return null;
  const after = toRow(body);
  items.push({ entity: 'tx', op: 'create', body, meta: { ...meta, queued_at: now() }, change: { entity: 'tx', before: null, after } });
  applyChange({ entity: 'tx', before: null, after });
  await persist();
  syncSoon();
  return after;
}

/** Same as before: kept for callers that already handle a failed request themselves. */
export const enqueue = addTransaction;

/** Change a transaction (server row or one still on the phone). `patch` uses API field names. */
export async function editTransaction(row, changes) {
  await loadOutbox();
  const next = { ...changes };
  if (next.type && next.type !== row.type && next.category_id === undefined) next.category_id = null;
  if ((next.type ?? row.type) !== 'transfer') Object.assign(next, { to_account_id: null, fee_cents: 0, fee_paid_by: null });

  const clientId = row.client_id;
  const local = clientId && findCreate(clientId);
  if (local && (isLocalId(row.id) || !serverIds.has(clientId))) {
    // Not on the server yet: just change what we'll send.
    const body = { ...local.body, ...next };
    const after = toRow(body, local.change?.after ?? row);
    applyChange({ entity: 'tx', before: local.change?.after ?? row, after });
    Object.assign(local, { body, change: { entity: 'tx', before: null, after }, error: undefined });
    await persist();
    syncSoon();
    return after;
  }

  const id = isLocalId(row.id) ? serverIds.get(clientId) : row.id;
  if (!id) throw new Error('This entry is still syncing. Try again in a moment.');
  const existing = items.find((i) => isTx(i) && opOf(i) === 'update' && i.id === id);
  const before = existing?.change.before ?? row;
  const fields = ['type', 'amount_cents', 'account_id', 'to_account_id', 'fee_cents', 'fee_paid_by', 'category_id', 'occurred_on', 'note'];
  const merged = Object.fromEntries(fields.map((f) => [f, f in next ? next[f] : (existing?.change.after ?? row)[f]]));
  const after = toRow({ ...merged, client_id: row.client_id }, { ...row, id });
  applyChange({ entity: 'tx', before: existing?.change.after ?? row, after });
  if (existing) Object.assign(existing, { body: { ...existing.body, ...next }, change: { entity: 'tx', before, after }, error: undefined });
  else items.push({ entity: 'tx', op: 'update', id, body: next, meta: { queued_at: now() }, change: { entity: 'tx', before, after } });
  await persist();
  syncSoon();
  return after;
}

/** Delete a transaction (server row or one still on the phone). */
export async function deleteTransaction(row) {
  await loadOutbox();
  const local = row.client_id && findCreate(row.client_id);
  if (local && !serverIds.has(row.client_id)) {
    items = items.filter((i) => i !== local);
    applyChange({ entity: 'tx', before: local.change?.after ?? row, after: null });
    await persist();
    return;
  }
  const id = isLocalId(row.id) ? serverIds.get(row.client_id) : row.id;
  if (!id) throw new Error('This entry is still syncing. Try again in a moment.');
  const pendingEdit = items.find((i) => isTx(i) && opOf(i) === 'update' && i.id === id);
  items = items.filter((i) => i !== pendingEdit);
  const before = pendingEdit?.change.before ?? row;
  applyChange({ entity: 'tx', before: pendingEdit?.change.after ?? row, after: null });
  items.push({ entity: 'tx', op: 'delete', id, body: {}, meta: { queued_at: now() }, change: { entity: 'tx', before, after: null } });
  await persist();
  syncSoon();
}

/** Change a queued new transaction before it syncs (e.g. pick a category on the success screen). */
export async function updateQueued(clientId, bodyPatch, metaPatch = {}) {
  const item = findCreate(clientId);
  if (!item) return;
  item.body = { ...item.body, ...bodyPatch };
  item.meta = { ...item.meta, ...metaPatch };
  const after = toRow(item.body, item.change?.after);
  applyChange({ entity: 'tx', before: item.change?.after ?? null, after });
  item.change = { entity: 'tx', before: null, after };
  await persist();
}

// ================================================================ accounts and bills

const ROWS = { account: toAccountRow, recurring: toRecurringRow };
const findEntity = (entity, id, op) => items.find((i) => entityOf(i) === entity && i.id === id && (!op || opOf(i) === op));

/** Is this account / bill still only on the phone (not synced yet)? */
export const isUnsynced = (entity, id) => Boolean(findEntity(entity, id, 'create'));

/**
 * Add (row = null) or change an account or bill. Saved on the phone straight away and synced
 * in the background. Returns the row as it now looks.
 */
async function saveEntity(entity, row, changes, meta = {}) {
  await loadOutbox();
  const toEntityRow = ROWS[entity];
  if (!row) {
    const id = Crypto.randomUUID();
    const body = { ...changes, id };
    const after = toEntityRow(body);
    items.push({ entity, op: 'create', id, body, meta: { ...meta, queued_at: now() }, change: { entity, before: null, after } });
    applyChange({ entity, before: null, after });
    await persist();
    syncSoon();
    return after;
  }

  const pendingCreate = findEntity(entity, row.id, 'create');
  const pendingEdit = findEntity(entity, row.id, 'update');
  const queued = pendingCreate ?? pendingEdit;
  const current = queued?.change.after ?? row;
  const after = toEntityRow(changes, current);
  applyChange({ entity, before: current, after });
  if (queued) {
    // Fold into what's already waiting
    Object.assign(queued, { body: { ...queued.body, ...changes }, change: { entity, before: queued.change.before, after }, error: undefined });
  } else {
    items.push({ entity, op: 'update', id: row.id, body: changes, meta: { ...meta, queued_at: now() }, change: { entity, before: row, after } });
  }
  await persist();
  syncSoon();
  return after;
}

async function deleteEntity(entity, row) {
  await loadOutbox();
  const pendingCreate = findEntity(entity, row.id, 'create');
  const pendingEdit = findEntity(entity, row.id, 'update');
  const current = (pendingCreate ?? pendingEdit)?.change.after ?? row;
  items = items.filter((i) => i !== pendingCreate && i !== pendingEdit);
  applyChange({ entity, before: current, after: null });
  if (!pendingCreate) {
    items.push({ entity, op: 'delete', id: row.id, body: {}, meta: { queued_at: now() }, change: { entity, before: pendingEdit?.change.before ?? row, after: null } });
    syncSoon();
  }
  await persist();
}

/** Add (account = null) or change an account or person. */
export const saveAccount = (account, changes) => saveEntity('account', account, changes);
export const deleteAccount = (account) => deleteEntity('account', account);
/** Add (item = null) or change a bill or income. */
export const saveRecurring = (item, changes) => saveEntity('recurring', item, changes);
export const deleteRecurring = (item) => deleteEntity('recurring', item);

/** Transactions on an account that are still waiting to sync (so it can't be deleted yet). */
export const hasPendingTransactions = (accountId) => items.some((i) => isTx(i) && !i.error
  && [i.change?.after, i.change?.before].some((tx) => tx && (tx.account_id === accountId || tx.to_account_id === accountId)));

// ================================================================ shared

/** Remove an entry (e.g. one the server rejected) and undo it on the phone. */
export async function discard(key) {
  const item = items.find((i) => i.body?.client_id === key || i.id === key);
  if (!item) return;
  items = items.filter((i) => i !== item);
  if (!item.error) undo(item.change);
  await persist();
}

export async function clearOutbox() {
  items = [];
  serverIds.clear();
  await AsyncStorage.removeItem(KEY);
  emit();
}

/** The server id of a transaction created on the phone, once it has synced. */
export function serverIdFor(clientId) {
  return serverIds.get(clientId) ?? null;
}

/** Wait (up to `ms`) for a new transaction to reach the server; resolves its id or null. */
export function waitForServerId(clientId, ms = 20_000) {
  if (serverIds.has(clientId)) return Promise.resolve(serverIds.get(clientId));
  if (!findCreate(clientId)) return Promise.resolve(null);
  syncOutbox();
  return new Promise((resolve) => {
    const list = syncedWaiters.get(clientId) ?? [];
    list.push(resolve);
    syncedWaiters.set(clientId, list);
    setTimeout(() => resolve(serverIds.get(clientId) ?? null), ms);
  });
}

function markSynced(clientId, id) {
  serverIds.set(clientId, id);
  (syncedWaiters.get(clientId) ?? []).forEach((r) => r(id));
  syncedWaiters.delete(clientId);
}

function syncSoon() {
  setTimeout(() => syncOutbox(), 0);
}

/**
 * Send everything waiting, oldest first. Entries the server turns down (e.g. account archived
 * meanwhile) stay with an error so you can see and discard them. Returns { sent, failed } or
 * null if offline / nothing to do.
 */
export function syncOutbox() {
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = runSync().finally(() => {
    syncing = null;
    if (again) {
      again = false;
      syncOutbox();
    }
  });
  return syncing;
}

const PATHS = { account: '/accounts', recurring: '/recurring', tx: '/transactions' };

/** Send a run of new transactions in one request. */
async function sendTransactionBatch(batch, counts, fail) {
  const sentBodies = batch.map((i) => ({ ...i.body }));
  const { results } = await post('/transactions/sync', { transactions: sentBodies }, { timeoutMs: 30_000 });
  for (const r of results) {
    const item = findCreate(r.client_id);
    if (!item) continue;
    if (r.status === 'created' || r.status === 'duplicate') {
      markSynced(r.client_id, r.id);
      const sentBody = sentBodies.find((b) => b.client_id === r.client_id);
      if (JSON.stringify(sentBody) !== JSON.stringify(item.body)) {
        // Edited (e.g. category picked) while it was uploading: send the difference as an edit.
        const diff = Object.fromEntries(Object.entries(item.body).filter(([k, v]) => k !== 'client_id' && sentBody[k] !== v));
        const before = toRow(sentBody, { ...item.change?.after, id: r.id, pending: false });
        Object.assign(item, { op: 'update', id: r.id, body: diff, change: { entity: 'tx', before, after: toRow(item.body, { ...item.change?.after, id: r.id }) } });
      } else {
        items = items.filter((i) => i !== item);
      }
      counts.sent++;
    } else if (r.error !== 'server_error') {
      fail(item, r);
    }
  }
}

/** Send one queued edit / delete, or a new account or bill. */
async function sendOne(item) {
  const base = PATHS[entityOf(item)];
  if (opOf(item) === 'create') return post(base, item.body);
  if (opOf(item) === 'update') return patch(`${base}/${item.id}`, item.body);
  return del(`${base}/${item.id}`);
}

async function runSync() {
  await loadOutbox();
  const counts = { sent: 0, failed: 0 };
  const fail = (item, err) => {
    item.error = err.message || 'Could not be saved';
    undo(item.change);
    counts.failed++;
  };
  try {
    const queue = items.filter((i) => !i.error);
    for (let n = 0; n < queue.length; n++) {
      const item = queue[n];
      if (!items.includes(item) || item.error) continue;
      if (isTx(item) && opOf(item) === 'create') {
        // Send this and the new transactions right after it together
        const batch = [item];
        while (batch.length < 100 && queue[n + 1] && isTx(queue[n + 1]) && opOf(queue[n + 1]) === 'create') batch.push(queue[++n]);
        await sendTransactionBatch(batch, counts, fail);
        continue;
      }
      // Only send what's actually queued right now (it may have changed while we waited)
      const sentBody = JSON.stringify(item.body);
      try {
        await sendOne(item);
        if (JSON.stringify(item.body) !== sentBody && opOf(item) !== 'delete') {
          // Changed again while it was uploading: send the rest as an edit
          Object.assign(item, { op: 'update' });
          n--;
          queue[n + 1] = item;
          continue;
        }
        items = items.filter((i) => i !== item);
        counts.sent++;
      } catch (err) {
        if (err.status === 404 && opOf(item) === 'delete') {
          items = items.filter((i) => i !== item);
        } else if (isRetryable(err)) {
          throw err;
        } else {
          fail(item, err);
        }
      }
    }
    status = { online: true, lastError: null };
    return counts.sent || counts.failed ? counts : null;
  } catch (err) {
    status = { online: false, lastError: err.message };
    return null; // still offline or server asleep; try again later
  } finally {
    await persist();
    if (counts.sent || counts.failed) refreshMoney(); // swap the phone's estimates for the server's numbers
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

/** React hook: did the last sync attempt reach the server? */
export function useSyncStatus() {
  return useSyncExternalStore(subscribe, () => status);
}

/** Errors worth queueing: no connection, timeout, or the server is down/waking up. */
export const isRetryable = (err) => err?.status === 0 || err?.status >= 500;
