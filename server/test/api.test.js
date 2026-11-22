// End-to-end tests for the wallet model: the owner manages everything; the partner
// can view non-private accounts and log entries, and edit/delete only their own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './helpers.js';

let ctx, api;
let me, partner; // tokens
let partnerId;
const acct = {}; // name -> id
const cat = {};  // name -> id

before(async () => {
  ctx = await startTestServer(54330);
  api = ctx.api;

  const r1 = await api('POST', '/auth/register', { body: { email: 'me@example.com', password: 'password123', display_name: 'Elton' } });
  me = r1.body.token;
  const inv = await api('POST', '/household/invites', { token: me });
  const r2 = await api('POST', '/auth/register', {
    body: { email: 'partner@example.com', password: 'password123', display_name: 'Partner', invite_code: inv.body.invite.code },
  });
  partner = r2.body.token; partnerId = r2.body.user.id;

  const cats = await api('GET', '/categories', { token: me });
  for (const c of cats.body.categories) cat[c.name] = c.id;
});

after(() => ctx?.stop());

const balanceOf = async (name) => (await api('GET', `/accounts/${acct[name]}`, { token: me })).body.account.balance_cents;
const tx = (token, body) => api('POST', '/transactions', { token, body: { client_id: randomUUID(), ...body } });

// ---------- Accounts & privacy

test('owner creates accounts, including a private one', async () => {
  const make = async (body) => {
    const r = await api('POST', '/accounts', { token: me, body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    acct[body.name] = r.body.account.id;
    return r.body.account;
  };
  const bdo = await make({ name: 'BDO', type: 'bank', opening_balance_cents: 1_000_000 });
  assert.equal(bdo.balance_cents, 1_000_000);
  assert.equal(bdo.can_edit, true);
  assert.equal('owner_user_id' in bdo, false);
  await make({ name: 'GCash', type: 'digital_bank' });
  await make({ name: 'Wallet', type: 'cash', opening_balance_cents: 200_000 });
  await make({ name: 'Secret', type: 'savings', opening_balance_cents: 500_000, is_private: true });
  await make({ name: 'Card', type: 'credit_card', opening_balance_cents: -300_000 });
});

test('partner sees non-private accounts read-only', async () => {
  const theirs = (await api('GET', '/accounts', { token: partner })).body.accounts;
  const names = theirs.map((a) => a.name);
  assert.deepEqual(names.sort(), ['BDO', 'Card', 'GCash', 'Wallet']);
  assert.ok(theirs.every((a) => a.can_edit === false));
  assert.equal((await api('GET', `/accounts/${acct.Secret}`, { token: partner })).status, 404);
});

test('partner cannot create, edit or delete accounts', async () => {
  assert.equal((await api('POST', '/accounts', { token: partner, body: { name: 'X', type: 'cash' } })).status, 403);
  assert.equal((await api('PATCH', `/accounts/${acct.BDO}`, { token: partner, body: { name: 'Hacked' } })).status, 403);
  assert.equal((await api('DELETE', `/accounts/${acct.BDO}`, { token: partner })).status, 403);
});

// ---------- Transactions & transfer fees

test('expense reduces balance; category kind must match', async () => {
  const r = await tx(me, { type: 'expense', amount_cents: 25_000, account_id: acct.GCash, category_id: cat['Food & Groceries'], note: 'SM groceries' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.transaction.created_by_name, 'Elton');
  const bad = await tx(me, { type: 'expense', amount_cents: 100, account_id: acct.GCash, category_id: cat.Salary });
  assert.equal(bad.body.error, 'category_kind_mismatch');
});

test('transfer with sender-paid fee; route fee remembered', async () => {
  const r = await tx(me, { type: 'transfer', amount_cents: 100_000, account_id: acct.BDO, to_account_id: acct.GCash, fee_cents: 1_500 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await balanceOf('BDO'), 1_000_000 - 101_500);
  assert.equal(await balanceOf('GCash'), -25_000 + 100_000);
  const s = await api('GET', `/fee-presets/suggest?from=${acct.BDO}&to=${acct.GCash}`, { token: me });
  assert.deepEqual([s.body.suggestion.fee_cents, s.body.suggestion.fee_paid_by], [1_500, 'sender']);
});

test('transfer with receiver-paid fee', async () => {
  await tx(me, { type: 'transfer', amount_cents: 50_000, account_id: acct.BDO, to_account_id: acct.GCash, fee_cents: 1_000, fee_paid_by: 'receiver' });
  assert.equal(await balanceOf('BDO'), 1_000_000 - 101_500 - 50_000);
  assert.equal(await balanceOf('GCash'), 75_000 + 49_000);
});

test('bad transfers are rejected', async () => {
  assert.equal((await tx(me, { type: 'transfer', amount_cents: 100, account_id: acct.BDO, to_account_id: acct.BDO })).body.error, 'same_account');
  assert.equal((await tx(me, { type: 'transfer', amount_cents: 100, account_id: acct.BDO })).body.error, 'to_account_required');
  assert.equal((await tx(me, { type: 'transfer', amount_cents: 100, account_id: acct.BDO, to_account_id: acct.GCash, fee_cents: 200, fee_paid_by: 'receiver' })).body.error, 'fee_too_large');
  assert.equal((await tx(me, { type: 'expense', amount_cents: 0, account_id: acct.BDO })).status, 400);
});

test('partner can log entries on visible accounts', async () => {
  const r = await tx(partner, { type: 'expense', amount_cents: 5_000, account_id: acct.Wallet, category_id: cat.Transport, note: 'Grab' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.transaction.created_by_name, 'Partner');
  assert.equal(r.body.transaction.can_edit, true);
  assert.equal(await balanceOf('Wallet'), 195_000);

  // and transfers between visible accounts
  const t = await tx(partner, { type: 'transfer', amount_cents: 10_000, account_id: acct.GCash, to_account_id: acct.Wallet });
  assert.equal(t.status, 201);
});

test('partner cannot log on a private account', async () => {
  assert.equal((await tx(partner, { type: 'expense', amount_cents: 100, account_id: acct.Secret })).status, 404);
});

test("partner can edit/delete their own entries but not the owner's", async () => {
  const own = await tx(partner, { type: 'expense', amount_cents: 3_000, account_id: acct.Wallet });
  const e = await api('PATCH', `/transactions/${own.body.transaction.id}`, { token: partner, body: { amount_cents: 3_500 } });
  assert.equal(e.status, 200);
  assert.equal((await api('DELETE', `/transactions/${own.body.transaction.id}`, { token: partner })).status, 204);

  const mine = await tx(me, { type: 'expense', amount_cents: 1_000, account_id: acct.Wallet });
  const seen = await api('GET', `/transactions/${mine.body.transaction.id}`, { token: partner });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.transaction.can_edit, false);
  assert.equal((await api('PATCH', `/transactions/${mine.body.transaction.id}`, { token: partner, body: { note: 'x' } })).status, 403);
  assert.equal((await api('DELETE', `/transactions/${mine.body.transaction.id}`, { token: partner })).status, 403);
});

test("owner can edit the partner's entries", async () => {
  const theirs = await tx(partner, { type: 'expense', amount_cents: 2_000, account_id: acct.Wallet });
  assert.equal((await api('GET', `/transactions/${theirs.body.transaction.id}`, { token: me })).body.transaction.can_edit, true);
  const e = await api('PATCH', `/transactions/${theirs.body.transaction.id}`, { token: me, body: { note: 'fixed' } });
  assert.equal(e.status, 200);
});

test('private account activity is hidden or masked for the partner', async () => {
  const t = await tx(me, { type: 'transfer', amount_cents: 30_000, account_id: acct.Secret, to_account_id: acct.Wallet });
  const seen = await api('GET', `/transactions/${t.body.transaction.id}`, { token: partner });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.transaction.account_id, null);
  assert.equal(seen.body.transaction.account_name, 'Private account');
  assert.equal(seen.body.transaction.to_account_name, 'Wallet');
  assert.equal(seen.body.transaction.can_edit, false);

  const priv = await tx(me, { type: 'expense', amount_cents: 1_000, account_id: acct.Secret });
  assert.equal((await api('GET', `/transactions/${priv.body.transaction.id}`, { token: partner })).status, 404);
  const list = await api('GET', '/transactions?limit=200', { token: partner });
  assert.ok(!list.body.transactions.some((x) => x.id === priv.body.transaction.id));
});

test('same client_id twice does not duplicate', async () => {
  const body = { client_id: randomUUID(), type: 'expense', amount_cents: 5_000, account_id: acct.Wallet };
  const first = await api('POST', '/transactions', { token: me, body });
  const second = await api('POST', '/transactions', { token: me, body });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(first.body.transaction.id, second.body.transaction.id);
});

test('offline sync: created, duplicate and error per item', async () => {
  const dup = randomUUID();
  await tx(me, { client_id: dup, type: 'income', amount_cents: 2_000_000, account_id: acct.BDO, category_id: cat.Salary });
  const r = await api('POST', '/transactions/sync', {
    token: me,
    body: {
      transactions: [
        { client_id: randomUUID(), type: 'expense', amount_cents: 7_500, account_id: acct.GCash },
        { client_id: dup, type: 'income', amount_cents: 2_000_000, account_id: acct.BDO },
        { client_id: randomUUID(), type: 'expense', amount_cents: -5, account_id: acct.GCash },
        { client_id: randomUUID(), type: 'expense', amount_cents: 100, account_id: randomUUID() },
      ],
    },
  });
  assert.deepEqual(r.body.results.map((x) => x.status), ['created', 'duplicate', 'error', 'error']);
  assert.equal(r.body.results[2].error, 'validation_error');
  assert.equal(r.body.results[3].error, 'not_found');
});

test('edit and delete as owner; type change drops category', async () => {
  const r = await tx(me, { type: 'expense', amount_cents: 10_000, account_id: acct.BDO, category_id: cat.Shopping });
  const id = r.body.transaction.id;
  const before = await balanceOf('BDO');
  await api('PATCH', `/transactions/${id}`, { token: me, body: { amount_cents: 12_000 } });
  assert.equal(await balanceOf('BDO'), before - 2_000);
  const e2 = await api('PATCH', `/transactions/${id}`, { token: me, body: { type: 'transfer', to_account_id: acct.GCash, fee_cents: 1_500 } });
  assert.equal(e2.body.transaction.category_id, null);
  assert.equal((await api('DELETE', `/transactions/${id}`, { token: me })).status, 204);
  assert.equal(await balanceOf('BDO'), before + 10_000);
});

test('list filters', async () => {
  const transfers = await api('GET', '/transactions?type=transfer', { token: me });
  assert.ok(transfers.body.transactions.every((t) => t.type === 'transfer'));
  const byPartner = await api('GET', `/transactions?created_by=${partnerId}`, { token: me });
  assert.ok(byPartner.body.transactions.length > 0 && byPartner.body.transactions.every((t) => t.created_by === partnerId));
  const search = await api('GET', '/transactions?q=groceries', { token: me });
  assert.equal(search.body.transactions.length, 1);
  const paged = await api('GET', '/transactions?limit=2', { token: me });
  assert.equal(paged.body.has_more, true);
});

test('accounts in use cannot be deleted; archived ones reject new entries', async () => {
  assert.equal((await api('DELETE', `/accounts/${acct.GCash}`, { token: me })).body.error, 'account_in_use');
  await api('PATCH', `/accounts/${acct.Card}`, { token: me, body: { archived: true } });
  assert.equal((await tx(me, { type: 'expense', amount_cents: 100, account_id: acct.Card })).body.error, 'account_archived');
  await api('PATCH', `/accounts/${acct.Card}`, { token: me, body: { archived: false } });
});

// ---------- Owner-only settings

test('categories and fee presets: partner can read but not change', async () => {
  assert.equal((await api('GET', '/categories', { token: partner })).status, 200);
  assert.equal((await api('GET', '/fee-presets', { token: partner })).status, 200);
  assert.equal((await api('POST', '/categories', { token: partner, body: { name: 'Pets', kind: 'expense' } })).status, 403);
  assert.equal((await api('POST', '/fee-presets', { token: partner, body: { name: 'X', fee_cents: 100 } })).status, 403);
  assert.equal((await api('POST', '/categories', { token: me, body: { name: 'Pets', kind: 'expense' } })).status, 201);
  assert.equal((await api('DELETE', `/categories/${cat['Transfer fees']}`, { token: me })).body.error, 'system_category');
});

test('recurring: owner manages, partner views (minus private-linked)', async () => {
  const salary = await api('POST', '/recurring', {
    token: me,
    body: { kind: 'income', name: 'Salary', amount_cents: 2_500_000, frequency: 'semi_monthly', account_id: acct.BDO, next_date: '2099-01-15' },
  });
  assert.equal(salary.status, 201, JSON.stringify(salary.body));
  assert.equal(salary.body.item.monthly_equivalent_cents, 5_000_000);
  await api('POST', '/recurring', { token: me, body: { kind: 'expense', name: 'Rent', amount_cents: 1_200_000, frequency: 'monthly' } });
  await api('POST', '/recurring', { token: me, body: { kind: 'expense', name: 'Secret sub', amount_cents: 50_000, frequency: 'monthly', account_id: acct.Secret } });

  const theirs = (await api('GET', '/recurring', { token: partner })).body.items;
  assert.deepEqual(theirs.map((i) => i.name).sort(), ['Rent', 'Salary']);
  assert.ok(theirs.every((i) => i.can_edit === false));
  assert.equal((await api('POST', '/recurring', { token: partner, body: { kind: 'expense', name: 'X', amount_cents: 1, frequency: 'monthly' } })).status, 403);
  assert.equal((await api('PATCH', `/recurring/${salary.body.item.id}`, { token: partner, body: { amount_cents: 1 } })).status, 403);
});

// ---------- Summaries

test('summary adds up for the owner', async () => {
  const s = await api('GET', '/summary', { token: me });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const accounts = (await api('GET', '/accounts', { token: me })).body.accounts;
  assert.equal(s.body.balances.net_worth_cents, accounts.reduce((n, a) => n + a.balance_cents, 0));
  assert.equal(s.body.balances.liabilities_cents, -300_000);
  assert.equal(s.body.month_flow.transfer_fees_cents, 2_500);
  assert.equal(s.body.month_flow.spending_by_category.find((c) => c.name === 'Transfer fees').total_cents, 2_500);
  assert.equal(s.body.recurring.monthly_income_cents, 5_000_000);
  assert.equal(s.body.recurring.monthly_expenses_cents, 1_250_000);
});

test("partner's summary excludes private accounts and their bills", async () => {
  const mine = await api('GET', '/summary', { token: me });
  const theirs = await api('GET', '/summary', { token: partner });
  assert.ok(!theirs.body.balances.accounts.some((a) => a.name === 'Secret'));
  assert.ok(theirs.body.balances.net_worth_cents < mine.body.balances.net_worth_cents);
  assert.equal(theirs.body.recurring.monthly_expenses_cents, 1_200_000);
});

test('net worth history ends at current net worth', async () => {
  const s = await api('GET', '/summary', { token: me });
  const h = await api('GET', '/summary/net-worth?months=6', { token: me });
  assert.equal(h.body.points.length, 6);
  assert.equal(h.body.points.at(-1).net_worth_cents, s.body.balances.net_worth_cents);
});
