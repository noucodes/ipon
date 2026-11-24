// Accounts and bills created offline on the phone carry their own id, so a retry never duplicates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './helpers.js';

let ctx, api, me, other;

before(async () => {
  ctx = await startTestServer(54336);
  api = ctx.api;
  me = (await api('POST', '/auth/register', { body: { email: 'off@example.com', password: 'password123', display_name: 'Me' } })).body.token;
  other = (await api('POST', '/auth/register', { body: { email: 'off2@example.com', password: 'password123', display_name: 'Other' } })).body.token;
});

after(() => ctx?.stop());

test('account with a phone-made id is created once, retries return it', async () => {
  const id = randomUUID();
  const body = { id, name: 'GCash', type: 'digital_bank', opening_balance_cents: 5000 };
  const first = await api('POST', '/accounts', { token: me, body });
  assert.equal(first.status, 201);
  assert.equal(first.body.account.id, id);
  const again = await api('POST', '/accounts', { token: me, body });
  assert.equal(again.status, 200);
  assert.equal(again.body.account.id, id);
  const list = await api('GET', '/accounts', { token: me });
  assert.equal(list.body.accounts.filter((a) => a.name === 'GCash').length, 1);

  // A transaction made offline against it syncs fine
  const sync = await api('POST', '/transactions/sync', { token: me, body: { transactions: [{ client_id: randomUUID(), type: 'expense', amount_cents: 1000, account_id: id }] } });
  assert.equal(sync.body.results[0].status, 'created');

  // Another household can't reuse it
  const taken = await api('POST', '/accounts', { token: other, body });
  assert.equal(taken.status, 409);
});

test('retrying a person create does not trip the duplicate-person check', async () => {
  const body = { id: randomUUID(), name: 'Juan', type: 'person', opening_balance_cents: 0 };
  assert.equal((await api('POST', '/accounts', { token: me, body })).status, 201);
  assert.equal((await api('POST', '/accounts', { token: me, body })).status, 200);
});

test('bill with a phone-made id is created once', async () => {
  const id = randomUUID();
  const body = { id, kind: 'expense', name: 'Rent', amount_cents: 800000, frequency: 'monthly', next_date: '2026-12-01' };
  const first = await api('POST', '/recurring', { token: me, body });
  assert.equal(first.status, 201);
  assert.equal(first.body.item.id, id);
  assert.equal((await api('POST', '/recurring', { token: me, body })).status, 200);
  const list = await api('GET', '/recurring', { token: me });
  assert.equal(list.body.items.filter((i) => i.name === 'Rent').length, 1);
});

test('creating without an id still works', async () => {
  const r = await api('POST', '/accounts', { token: me, body: { name: 'Cash', type: 'cash' } });
  assert.equal(r.status, 201);
  assert.ok(r.body.account.id);
});
