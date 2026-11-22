// People (utang): lend, card used by someone, partial repayment, borrow, write-off.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './helpers.js';

let ctx, api, me, partner;
const acct = {};
const cat = {};

before(async () => {
  ctx = await startTestServer(54331);
  api = ctx.api;
  me = (await api('POST', '/auth/register', { body: { email: 'me@x.com', password: 'password123', display_name: 'Elton' } })).body.token;
  const inv = await api('POST', '/household/invites', { token: me });
  partner = (await api('POST', '/auth/register', { body: { email: 'p@x.com', password: 'password123', display_name: 'P', invite_code: inv.body.invite.code } })).body.token;
  for (const c of (await api('GET', '/categories', { token: me })).body.categories) cat[c.name] = c.id;

  const make = async (body) => { acct[body.name] = (await api('POST', '/accounts', { token: me, body })).body.account.id; };
  await make({ name: 'Wallet', type: 'cash', opening_balance_cents: 500_000 });
  await make({ name: 'GCash', type: 'digital_bank', opening_balance_cents: 0 });
  await make({ name: 'Card', type: 'credit_card', opening_balance_cents: 0 });
});

after(() => ctx?.stop());

const tx = (body, token = me) => api('POST', '/transactions', { token, body: { client_id: randomUUID(), ...body } });
const bal = async (name) => (await api('GET', `/accounts/${acct[name]}`, { token: me })).body.account.balance_cents;
const summary = async (token = me) => (await api('GET', '/summary', { token })).body;

test('create people with a due date; Written off category exists', async () => {
  const r = await api('POST', '/accounts', { token: me, body: { name: 'Juan', type: 'person', due_date: '2099-12-01', note: 'for tuition' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.account.due_date, '2099-12-01');
  assert.equal(r.body.account.note, 'for tuition');
  acct.Juan = r.body.account.id;
  acct.Tita = (await api('POST', '/accounts', { token: me, body: { name: 'Tita', type: 'person' } })).body.account.id;
  acct.Secret = (await api('POST', '/accounts', { token: me, body: { name: 'Secret friend', type: 'person', is_private: true } })).body.account.id;
  assert.ok(cat['Written off']);
});

test('lending cash: wallet down, Juan owes, net worth unchanged', async () => {
  const before = (await summary()).balances.net_worth_cents;
  assert.equal((await tx({ type: 'transfer', amount_cents: 100_000, account_id: acct.Wallet, to_account_id: acct.Juan, note: 'utang' })).status, 201);
  assert.equal(await bal('Wallet'), 400_000);
  assert.equal(await bal('Juan'), 100_000);
  assert.equal((await summary()).balances.net_worth_cents, before);
});

test('someone uses my credit card: card debt up, they owe me', async () => {
  await tx({ type: 'transfer', amount_cents: 250_000, account_id: acct.Card, to_account_id: acct.Juan, note: 'used my card at SM' });
  assert.equal(await bal('Card'), -250_000);
  assert.equal(await bal('Juan'), 350_000);
});

test('partial repayment into GCash', async () => {
  await tx({ type: 'transfer', amount_cents: 50_000, account_id: acct.Juan, to_account_id: acct.GCash });
  assert.equal(await bal('Juan'), 300_000);
  assert.equal(await bal('GCash'), 50_000);
});

test('borrowing from Tita makes her balance negative (I owe)', async () => {
  await tx({ type: 'transfer', amount_cents: 80_000, account_id: acct.Tita, to_account_id: acct.Wallet });
  assert.equal(await bal('Tita'), -80_000);
  assert.equal(await bal('Wallet'), 480_000);
});

test('summary shows owed to you / you owe; liabilities include what I owe', async () => {
  const s = (await summary()).balances;
  assert.equal(s.owed_to_you_cents, 300_000);
  assert.equal(s.you_owe_cents, -80_000);
  assert.equal(s.liabilities_cents, -250_000 - 80_000);
  assert.equal(s.by_type.person, 300_000 - 80_000);
  assert.equal(s.net_worth_cents, 480_000 + 50_000 - 250_000 + 300_000 - 80_000);
});

test('income directly on a person is rejected (use a transfer)', async () => {
  const r = await tx({ type: 'income', amount_cents: 100, account_id: acct.Juan });
  assert.equal(r.body.error, 'person_income');
});

test('writing off what Juan still owes', async () => {
  const before = (await summary()).balances.net_worth_cents;
  const r = await tx({ type: 'expense', amount_cents: 300_000, account_id: acct.Juan, category_id: cat['Written off'], note: 'forgiven' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await bal('Juan'), 0);
  const s = await summary();
  assert.equal(s.balances.net_worth_cents, before - 300_000);
  assert.equal(s.month_flow.spending_by_category.find((c) => c.name === 'Written off').total_cents, 300_000);
});

test('partner sees people except private ones, and can log a repayment', async () => {
  const names = (await api('GET', '/accounts', { token: partner })).body.accounts.map((a) => a.name);
  assert.ok(names.includes('Tita') && !names.includes('Secret friend'));
  const r = await tx({ type: 'transfer', amount_cents: 10_000, account_id: acct.Wallet, to_account_id: acct.Tita, note: 'paid Tita back' }, partner);
  assert.equal(r.status, 201);
  assert.equal(await bal('Tita'), -70_000);
});
