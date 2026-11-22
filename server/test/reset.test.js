// Onboarding flag and "reset my data".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './helpers.js';

let ctx, api, me, partner;

before(async () => {
  ctx = await startTestServer(54334);
  api = ctx.api;
  const r = await api('POST', '/auth/register', { body: { email: 'me@x.com', password: 'password123', display_name: 'Elton' } });
  me = r.body.token;
  assert.equal(r.body.user.onboarded, false); // brand-new users see the setup guide
  const inv = await api('POST', '/household/invites', { token: me });
  partner = (await api('POST', '/auth/register', { body: { email: 'p@x.com', password: 'password123', display_name: 'P', invite_code: inv.body.invite.code } })).body.token;
});

after(() => ctx?.stop());

test('finishing or skipping the guide is remembered on the account', async () => {
  const r = await api('POST', '/auth/onboarded', { token: me, body: { done: true } });
  assert.equal(r.body.user.onboarded, true);
  assert.equal((await api('GET', '/auth/me', { token: me })).body.user.onboarded, true);
  const login = await api('POST', '/auth/login', { body: { email: 'me@x.com', password: 'password123' } });
  assert.equal(login.body.user.onboarded, true);
});

test('reset deletes money data but keeps login, partner and categories', async () => {
  const acct = (await api('POST', '/accounts', { token: me, body: { name: 'BDO', type: 'bank', opening_balance_cents: 100_000 } })).body.account.id;
  await api('POST', '/transactions', { token: me, body: { client_id: randomUUID(), type: 'expense', amount_cents: 500, account_id: acct } });
  await api('POST', '/recurring', { token: me, body: { kind: 'income', name: 'Salary', amount_cents: 100, frequency: 'monthly' } });
  const catsBefore = (await api('GET', '/categories', { token: me })).body.categories.length;

  assert.equal((await api('POST', '/household/reset', { token: me, body: { confirm: 'reset' } })).status, 400); // must type RESET exactly
  assert.equal((await api('POST', '/household/reset', { token: partner, body: { confirm: 'RESET' } })).status, 403);

  const r = await api('POST', '/household/reset', { token: me, body: { confirm: 'RESET' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.deleted, { transactions: 1, recurring: 1, accounts: 1 });

  assert.equal((await api('GET', '/accounts', { token: me })).body.accounts.length, 0);
  assert.equal((await api('GET', '/transactions', { token: me })).body.transactions.length, 0);
  assert.equal((await api('GET', '/recurring', { token: me })).body.items.length, 0);
  assert.equal((await api('GET', '/categories', { token: me })).body.categories.length, catsBefore);
  assert.equal((await api('GET', '/household', { token: partner })).body.members.length, 2);
  assert.equal((await api('GET', '/auth/me', { token: me })).body.user.onboarded, false); // guide shows again
  assert.equal((await api('GET', '/summary', { token: me })).body.balances.net_worth_cents, 0);
});

test('custom days: salary on the 13th & 16th, bill on the 15th & 31st', async () => {
  const r = await api('POST', '/recurring', { token: me, body: { kind: 'income', name: 'Salary', amount_cents: 800_000, frequency: 'custom_days', days_of_month: [16, 13, 13] } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.item.days_of_month, [13, 16]); // sorted, no duplicates
  assert.ok(r.body.item.next_date); // filled in with the next one automatically
  assert.equal(r.body.item.monthly_equivalent_cents, 1_600_000);

  const missing = await api('POST', '/recurring', { token: me, body: { kind: 'expense', name: 'X', amount_cents: 100, frequency: 'custom_days' } });
  assert.equal(missing.body.error, 'days_required');

  // switching to a normal schedule clears the days
  const p = await api('PATCH', `/recurring/${r.body.item.id}`, { token: me, body: { frequency: 'monthly' } });
  assert.equal(p.body.item.days_of_month, null);
  const s = (await api('GET', '/summary', { token: me })).body;
  assert.equal(s.recurring.monthly_income_cents, 800_000);
});
