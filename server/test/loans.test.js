// Loan / BNPL helper: installment purchase, cash loan, payments, paid-off reminders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer } from './helpers.js';

let ctx, api, me, partner;
const acct = {};
const cat = {};

before(async () => {
  ctx = await startTestServer(54332);
  api = ctx.api;
  me = (await api('POST', '/auth/register', { body: { email: 'me@x.com', password: 'password123', display_name: 'Elton' } })).body.token;
  const inv = await api('POST', '/household/invites', { token: me });
  partner = (await api('POST', '/auth/register', { body: { email: 'p@x.com', password: 'password123', display_name: 'P', invite_code: inv.body.invite.code } })).body.token;
  for (const c of (await api('GET', '/categories', { token: me })).body.categories) cat[c.name] = c.id;
  acct.GCash = (await api('POST', '/accounts', { token: me, body: { name: 'GCash', type: 'digital_bank', opening_balance_cents: 1_000_000 } })).body.account.id;
});

after(() => ctx?.stop());

const summary = async () => (await api('GET', '/summary', { token: me })).body;
const bal = async (id) => (await api('GET', `/accounts/${id}`, { token: me })).body.account.balance_cents;
const pay = (to, cents) => api('POST', '/transactions', { token: me, body: { client_id: randomUUID(), type: 'transfer', amount_cents: cents, account_id: acct.GCash, to_account_id: to } });

test('Interest & fees category exists', () => {
  assert.ok(cat['Interest & fees']);
});

test('installment purchase: ₱6,000 phone, ₱6,600 over 6 months', async () => {
  const before = (await summary()).balances.net_worth_cents;
  const r = await api('POST', '/loans', {
    token: me,
    body: { lender: 'BillEase', label: 'Phone', kind: 'purchase', principal_cents: 600_000, total_payable_cents: 660_000, months: 6, first_due_date: '2099-01-15', category_id: cat.Shopping },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  acct.Phone = r.body.account.id;
  assert.equal(r.body.account.name, 'BillEase · Phone');
  assert.equal(r.body.account.type, 'credit_card');
  assert.equal(r.body.account.loan_installment_cents, 110_000);
  assert.equal(r.body.account.balance_cents, -660_000);

  const s = await summary();
  assert.equal(s.balances.net_worth_cents, before - 660_000); // ₱6,000 spent + ₱600 interest
  assert.equal(s.month_flow.spending_by_category.find((c) => c.name === 'Interest & fees').total_cents, 60_000);
  assert.equal(s.month_flow.spending_by_category.find((c) => c.name === 'Shopping').total_cents, 600_000);

  const item = (await api('GET', '/recurring', { token: me })).body.items.find((i) => i.loan_account_id === acct.Phone);
  assert.equal(item.name, 'BillEase · Phone payment');
  assert.equal(item.amount_cents, 110_000);
  assert.equal(item.next_date, '2099-01-15');
  assert.equal(item.paid_off, false);
  assert.equal(s.recurring.monthly_expenses_cents, 110_000);
});

test('monthly payments reduce the debt; paid-off loan stops counting as a bill', async () => {
  for (let i = 0; i < 5; i++) await pay(acct.Phone, 110_000);
  assert.equal(await bal(acct.Phone), -110_000);
  await pay(acct.Phone, 110_000);
  assert.equal(await bal(acct.Phone), 0);

  const item = (await api('GET', '/recurring', { token: me })).body.items.find((i) => i.loan_account_id === acct.Phone);
  assert.equal(item.paid_off, true);
  assert.equal((await summary()).recurring.monthly_expenses_cents, 0);
});

test('cash loan: ₱5,000 to GCash with ₱750 interest', async () => {
  const gcashBefore = await bal(acct.GCash);
  const r = await api('POST', '/loans', {
    token: me,
    body: { lender: 'GLoan', kind: 'cash', principal_cents: 500_000, total_payable_cents: 575_000, months: 5, first_due_date: '2099-02-01', to_account_id: acct.GCash },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.account.balance_cents, -575_000);
  assert.equal(await bal(acct.GCash), gcashBefore + 500_000);
});

test('existing loan: starts at what is owed, no spending recorded this month', async () => {
  const before = await summary();
  const r = await api('POST', '/loans', {
    token: me,
    body: { lender: 'Home Credit', kind: 'existing', remaining_cents: 840_000, installment_cents: 120_000, months: 7, first_due_date: '2099-03-10' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.account.balance_cents, -840_000);
  assert.equal(r.body.account.loan_months, 7);
  const after = await summary();
  assert.equal(after.balances.net_worth_cents, before.balances.net_worth_cents - 840_000); // the debt counts
  assert.equal(after.month_flow.expense_cents, before.month_flow.expense_cents); // but not as spending
  const item = (await api('GET', '/recurring', { token: me })).body.items.find((i) => i.loan_account_id === r.body.account.id);
  assert.equal(item.amount_cents, 120_000);
  const missing = await api('POST', '/loans', { token: me, body: { lender: 'X', kind: 'existing', months: 3, first_due_date: '2099-01-01' } });
  assert.equal(missing.body.error, 'remaining_required');
});

test('validation and permissions', async () => {
  const bad = await api('POST', '/loans', { token: me, body: { lender: 'X', kind: 'purchase', principal_cents: 1000, total_payable_cents: 500, months: 2, first_due_date: '2099-01-01' } });
  assert.equal(bad.body.error, 'total_too_small');
  const noTo = await api('POST', '/loans', { token: me, body: { lender: 'X', kind: 'cash', principal_cents: 1000, total_payable_cents: 1000, months: 2, first_due_date: '2099-01-01' } });
  assert.equal(noTo.body.error, 'to_account_required');
  const p = await api('POST', '/loans', { token: partner, body: { lender: 'X', kind: 'purchase', principal_cents: 1000, total_payable_cents: 1000, months: 1, first_due_date: '2099-01-01' } });
  assert.equal(p.status, 403);
});
