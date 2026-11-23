import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMoneyPlan, billPriority, forecastBalance } from './index.js';

const accounts = [
  { type: 'bank', balance_cents: 1_000_000 },     // ₱10,000
  { type: 'cash', balance_cents: 200_000 },       // ₱2,000
  { type: 'savings', balance_cents: 5_000_000 },  // set aside, not spendable
  { type: 'credit_card', balance_cents: -300_000 },
  { type: 'bank', balance_cents: 999_999, archived: true },
];
const recurring = [
  { id: 's', kind: 'income', name: 'Salary', amount_cents: 2_000_000, frequency: 'semi_monthly', next_date: '2026-11-15', active: true },
  { id: 'r', kind: 'expense', name: 'Rent', amount_cents: 600_000, frequency: 'monthly', next_date: '2026-12-01', active: true, category_id: 'rent', category_name: 'Rent' },
  { id: 'm', kind: 'expense', name: 'Meralco', amount_cents: 250_000, frequency: 'monthly', next_date: '2026-11-25', active: true, category_id: 'util', category_name: 'Bills & Utilities' },
  { id: 'n', kind: 'expense', name: 'Netflix', amount_cents: 54_900, frequency: 'monthly', next_date: '2026-12-05', active: true },
  { id: 'l', kind: 'expense', name: 'BillEase payment', amount_cents: 150_000, frequency: 'monthly', next_date: '2026-12-10', active: true, loan_account_id: 'x', loan_balance_cents: -150_000 },
  { id: 'old', kind: 'expense', name: 'Gym', amount_cents: 100_000, frequency: 'monthly', next_date: '2026-11-24', active: false },
];

test('priorities: loans, then home, then essentials, then flexible', () => {
  assert.equal(billPriority({ name: 'BillEase payment', loan_account_id: 'x' }).key, 'debt');
  assert.equal(billPriority({ name: 'Meralco' }).key, 'home');
  assert.equal(billPriority({ name: 'PLDT Fibr' }).key, 'essential');
  assert.equal(billPriority({ name: 'Netflix', category_name: 'Subscriptions' }).key, 'flexible');
});

test('daily budget = money on hand minus bills before payday, over the days left', () => {
  const plan = buildMoneyPlan({
    accounts, recurring, today: '2026-11-23',
    todaySpending: [{ category_id: 'food', spendable: true, total_cents: 30_000 }],
  });
  assert.equal(plan.spendable_cents, 1_200_000);
  assert.equal(plan.savings_cents, 5_000_000);
  assert.equal(plan.payday, '2026-11-30');
  assert.equal(plan.days_left, 7);
  // Only Meralco (25th) falls before payday; the paused gym doesn't count
  assert.deepEqual(plan.bills_before_payday.map((b) => b.name), ['Meralco']);
  // (12,000 + 300 spent today − 2,500) / 7
  assert.equal(plan.daily_budget_cents, Math.floor((1_200_000 + 30_000 - 250_000) / 7));
  assert.equal(plan.today.everyday_cents, 30_000);
  assert.equal(plan.today.status, 'ok');
});

test('paying a bill today is not everyday spending and clears it from the reserve', () => {
  const plan = buildMoneyPlan({
    accounts, recurring, today: '2026-11-25',
    todaySpending: [{ category_id: 'util', spendable: true, total_cents: 250_000 }],
  });
  assert.equal(plan.today.everyday_cents, 0);
  assert.equal(plan.today.bills_paid_cents, 250_000);
  assert.equal(plan.bills_before_payday_cents, 0);
});

test('over budget levels', () => {
  const at = (spent) => buildMoneyPlan({ accounts, recurring, today: '2026-11-23', todaySpending: [{ category_id: null, spendable: false, total_cents: spent }] });
  const budget = at(0).daily_budget_cents;
  assert.equal(at(Math.round(budget * 0.9)).today.status, 'near');
  assert.equal(at(Math.round(budget * 1.2)).today.status, 'over');
  assert.equal(at(budget * 2).today.status, 'way_over');
  const broke = buildMoneyPlan({ accounts: [{ type: 'cash', balance_cents: 1000 }], recurring, today: '2026-11-23' });
  assert.equal(broke.today.status, 'short');
  assert.equal(broke.daily_budget_cents, 0);
});

test('next payroll covers bills until the following payday, in priority order', () => {
  const plan = buildMoneyPlan({ accounts, recurring, today: '2026-11-23' });
  const p = plan.payroll;
  assert.equal(p.date, '2026-11-30');
  assert.equal(p.until, '2026-12-15');
  assert.equal(p.pay_cents, 2_000_000);
  // BillEase (debt) before Rent (home) before Netflix (flexible), even though rent is due first
  assert.deepEqual(p.bills.map((b) => b.name), ['BillEase payment', 'Rent', 'Netflix']);
  assert.equal(p.free_cents, 2_000_000 - 150_000 - 600_000 - 54_900);
  assert.equal(p.suggested_save_cents % 10_000, 0);
  assert.ok(p.bills.every((b) => b.covered));
});

test('when pay is short, flexible bills are the ones to move', () => {
  const lowPay = recurring.map((r) => (r.id === 's' ? { ...r, amount_cents: 700_000 } : r));
  const p = buildMoneyPlan({ accounts, recurring: lowPay, today: '2026-11-23' }).payroll;
  assert.ok(p.shortfall_cents > 0);
  assert.deepEqual(p.can_defer.map((b) => b.name), ['Netflix']);
  assert.equal(p.bills.find((b) => b.name === 'BillEase payment').covered, true);
});

test('forecast adds paydays and takes away bills and usual spending', () => {
  const plan = buildMoneyPlan({ accounts, recurring, today: '2026-11-23' });
  const pts = forecastBalance({ plan, recurring, days: 10, dailySpend: 10_000 });
  assert.equal(pts.length, 11);
  const nov25 = pts.find((p) => p.date === '2026-11-25');
  assert.equal(nov25.balance_cents, 1_200_000 - 2 * 10_000 - 250_000);
  const nov30 = pts.find((p) => p.date === '2026-11-30');
  assert.equal(nov30.events[0].name, 'Salary');
});

test('a set daily budget replaces the automatic one; save % is adjustable', () => {
  const plan = buildMoneyPlan({
    accounts, recurring, today: '2026-11-23', dailyBudgetCents: 50_000, saveRatePct: 50,
    todaySpending: [{ category_id: 'food', spendable: true, total_cents: 60_000 }],
  });
  assert.equal(plan.budget_mode, 'fixed');
  assert.equal(plan.daily_budget_cents, 50_000);
  assert.ok(plan.auto_daily_budget_cents > 50_000);
  assert.equal(plan.budget_fits, true);
  assert.equal(plan.today.left_cents, -10_000);
  assert.equal(plan.today.status, 'over');
  assert.equal(plan.save_rate_pct, 50);
  assert.equal(plan.payroll.suggested_save_cents, Math.floor(plan.payroll.free_cents * 0.5 / 10_000) * 10_000);

  const tooHigh = buildMoneyPlan({ accounts, recurring, today: '2026-11-23', dailyBudgetCents: 1_000_000 });
  assert.equal(tooHigh.budget_fits, false);
  assert.equal(buildMoneyPlan({ accounts, recurring, today: '2026-11-23', saveRatePct: 0 }).payroll.suggested_save_cents, 0);
});
