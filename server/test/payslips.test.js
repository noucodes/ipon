// Payslips: net into account, template by cutoff, deductions report, average expected pay, privacy.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let ctx, api, me, partner, bdo, salaryId;

before(async () => {
  ctx = await startTestServer(54333);
  api = ctx.api;
  me = (await api('POST', '/auth/register', { body: { email: 'me@x.com', password: 'password123', display_name: 'Elton' } })).body.token;
  const inv = await api('POST', '/household/invites', { token: me });
  partner = (await api('POST', '/auth/register', { body: { email: 'p@x.com', password: 'password123', display_name: 'P', invite_code: inv.body.invite.code } })).body.token;
  bdo = (await api('POST', '/accounts', { token: me, body: { name: 'BDO', type: 'bank' } })).body.account.id;
  salaryId = (await api('POST', '/recurring', { token: me, body: { kind: 'income', name: 'Salary', amount_cents: 1_500_000, frequency: 'semi_monthly', next_date: '2099-01-15' } })).body.item.id;
});

after(() => ctx?.stop());

const contrib = [
  { label: 'SSS', kind: 'contribution', amount_cents: 67_500 },
  { label: 'PhilHealth', kind: 'contribution', amount_cents: 37_500 },
  { label: 'Pag-IBIG', kind: 'contribution', amount_cents: 20_000 },
];
const log = (body, token = me) => api('POST', '/payslips', { token, body: { income_type: 'salary', source_name: 'Main job', recurring_item_id: salaryId, account_id: bdo, ...body } });

test('1st cutoff payslip: only net goes into BDO, categorised as Salary', async () => {
  const r = await log({ occurred_on: '2026-11-15', gross_cents: 1_500_000, lines: [...contrib, { label: 'Lates / undertime', kind: 'lost_pay', amount_cents: 25_000 }, { label: 'Overtime', kind: 'addition', amount_cents: 80_000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.payslip.net_cents, 1_500_000 + 80_000 - 125_000 - 25_000);
  assert.equal(r.body.payslip.cutoff, 1);
  assert.equal(r.body.transaction.type, 'income');
  assert.equal(r.body.transaction.amount_cents, 1_430_000);
  assert.equal(r.body.transaction.category_name, 'Salary');
  assert.equal((await api('GET', `/accounts/${bdo}`, { token: me })).body.account.balance_cents, 1_430_000);
});

test('2nd cutoff without contributions; template picks the same cutoff', async () => {
  await log({ occurred_on: '2026-11-30', gross_cents: 1_500_000, lines: [{ label: 'Withholding tax', kind: 'tax', amount_cents: 10_000 }] });
  const t1 = (await api('GET', `/payslips/template?recurring_item_id=${salaryId}&date=2026-12-15`, { token: me })).body.template;
  assert.equal(t1.cutoff, 1);
  assert.equal(t1.lines.filter((l) => l.kind === 'contribution').length, 3);
  const t2 = (await api('GET', `/payslips/template?recurring_item_id=${salaryId}&date=2026-12-31`, { token: me })).body.template;
  assert.equal(t2.cutoff, 2);
  assert.equal(t2.lines[0].label, 'Withholding tax');
});

test('expected salary follows the payslip average', async () => {
  const item = (await api('GET', '/recurring', { token: me })).body.items.find((i) => i.id === salaryId);
  assert.equal(item.average_net_cents, Math.round((1_430_000 + 1_490_000) / 2));
  assert.equal(item.expected_cents, item.average_net_cents);
  assert.equal(item.monthly_equivalent_cents, item.average_net_cents * 2);
});

test('part-time and project pay', async () => {
  const pt = await api('POST', '/payslips', { token: me, body: { income_type: 'part_time', source_name: 'Café part-time', account_id: bdo, occurred_on: '2026-11-20', gross_cents: 400_000, hours: 20, rate_cents: 20_000, lines: [{ label: 'Tips', kind: 'addition', amount_cents: 30_000 }] } });
  assert.equal(pt.status, 201, JSON.stringify(pt.body));
  assert.equal(pt.body.payslip.net_cents, 430_000);
  assert.equal(pt.body.transaction.category_name, 'Part-time');

  const pr = await api('POST', '/payslips', { token: me, body: { income_type: 'project', source_name: 'Logo for ABC Co.', account_id: bdo, occurred_on: '2026-11-22', gross_cents: 2_000_000, lines: [{ label: 'Platform fee', kind: 'fee', amount_cents: 200_000 }, { label: 'Withholding tax', kind: 'tax', amount_cents: 100_000 }] } });
  assert.equal(pr.body.payslip.net_cents, 1_700_000);
  assert.equal(pr.body.transaction.category_name, 'Freelance');
});

test('deductions report for the year', async () => {
  const s = (await api('GET', '/payslips/summary?year=2026', { token: me })).body;
  assert.equal(s.totals.count, 4);
  assert.equal(s.totals.contribution, 125_000);
  assert.equal(s.totals.lost_pay, 25_000);
  assert.equal(s.totals.tax, 110_000);
  assert.equal(s.totals.fee, 200_000);
  assert.ok(s.totals.byLabel.find((l) => l.label === 'SSS' && l.amount_cents === 67_500));
  assert.equal(s.by_source.length, 3);
  assert.equal(s.by_month[0].month, '2026-11');
});

test('net must be positive; partner cannot log or see private breakdowns', async () => {
  const bad = await log({ gross_cents: 100, lines: [{ label: 'SSS', kind: 'contribution', amount_cents: 500 }] });
  assert.equal(bad.body.error, 'net_not_positive');
  assert.equal((await log({ gross_cents: 1000 }, partner)).status, 403);
  assert.equal((await api('GET', '/payslips', { token: partner })).body.payslips.length, 0);
  // but the partner still sees the income itself
  const txs = (await api('GET', '/transactions?type=income', { token: partner })).body.transactions;
  assert.ok(txs.some((t) => t.amount_cents === 1_430_000));
});

test('attach payslip details to an income logged by swiping', async () => {
  const { randomUUID } = await import('node:crypto');
  const tx = await api('POST', '/transactions', { token: me, body: { client_id: randomUUID(), type: 'income', amount_cents: 1_430_000, account_id: bdo, occurred_on: '2026-12-15' } });
  const r = await api('POST', '/payslips/attach', {
    token: me,
    body: { transaction_id: tx.body.transaction.id, income_type: 'salary', source_name: 'Main job', recurring_item_id: salaryId, lines: [...contrib, { label: 'Overtime', kind: 'addition', amount_cents: 55_000 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.payslip.net_cents, 1_430_000); // what arrived is unchanged
  assert.equal(r.body.payslip.gross_cents, 1_430_000 + 125_000 - 55_000);
  const t = (await api('GET', `/transactions/${tx.body.transaction.id}`, { token: me })).body.transaction;
  assert.equal(t.amount_cents, 1_430_000);
  assert.equal(t.category_name, 'Salary'); // categorised automatically
  const again = await api('POST', '/payslips/attach', { token: me, body: { transaction_id: tx.body.transaction.id, income_type: 'salary', source_name: 'Main job' } });
  assert.equal(again.body.error, 'already_attached');
  const exp = await api('POST', '/transactions', { token: me, body: { client_id: randomUUID(), type: 'expense', amount_cents: 100, account_id: bdo } });
  const notIncome = await api('POST', '/payslips/attach', { token: me, body: { transaction_id: exp.body.transaction.id, income_type: 'salary', source_name: 'x' } });
  assert.equal(notIncome.body.error, 'not_income');
});

test('deleting a payslip removes its income', async () => {
  const r = await log({ occurred_on: '2026-11-25', gross_cents: 50_000 });
  const before = (await api('GET', `/accounts/${bdo}`, { token: me })).body.account.balance_cents;
  assert.equal((await api('DELETE', `/payslips/${r.body.payslip.id}`, { token: me })).status, 204);
  assert.equal((await api('GET', `/accounts/${bdo}`, { token: me })).body.account.balance_cents, before - 50_000);
});
