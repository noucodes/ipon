import { Router } from 'express';
import { z } from 'zod';
import { ACCOUNT_TYPES, SPENDABLE_TYPES, todayInManila, addDays, nextMonthStart, buildMoneyPlan, forecastBalance } from '@ft/shared';
import { monthStr } from '../lib/validators.js';
import { visibleSql } from '../lib/access.js';
import { listTransactions } from '../lib/transactions.js';
import { RECURRING_SELECT, serializeRecurring } from './recurring.js';
import { requireAuth } from '../middleware/auth.js';

// Accounts this user can see (partners don't see private ones). Params: $1 household, $2 role.
const SCOPE_CTE = `
  scope AS (
    SELECT a.* FROM accounts a
     WHERE a.household_id = $1 AND ${visibleSql('a', '$2')}
  )`;

const sum = (rows, pick) => rows.reduce((acc, r) => acc + pick(r), 0);

/** The wallet's budget settings, as buildMoneyPlan options. */
async function budgetSettings(pool, householdId) {
  const { rows } = await pool.query(`SELECT daily_budget_cents, save_rate_pct FROM households WHERE id = $1`, [householdId]);
  const fixed = rows[0]?.daily_budget_cents;
  return { dailyBudgetCents: fixed == null ? null : Number(fixed), saveRatePct: rows[0]?.save_rate_pct ?? 20 };
}

/**
 * Today's outflows (expenses + transfer fees) per category, split by whether they left a spendable account.
 * Purchases on an installment loan (BillEase, SPayLater...) are left out: their monthly payments are
 * already counted as bills, so counting the purchase too would double it.
 */
async function todaySpending(pool, base, today) {
  const { rows } = await pool.query(
    `WITH ${SCOPE_CTE}
     SELECT e.category_id, (s.type = ANY($4::text[])) AS spendable, (-SUM(e.delta))::bigint AS total_cents
       FROM transaction_effects e
       JOIN scope s ON s.id = e.account_id
      WHERE e.occurred_on = $3::date AND e.kind IN ('expense', 'fee') AND s.loan_months IS NULL
      GROUP BY e.category_id, spendable`,
    [...base, today, SPENDABLE_TYPES],
  );
  return rows;
}

export function summaryRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  /**
   * GET /summary?month=YYYY-MM
   * Everything the dashboard needs in one request.
   */
  router.get('/', async (req, res) => {
    const q = z.object({ month: monthStr.optional() }).parse(req.query);
    const today = todayInManila();
    const month = q.month ?? today.slice(0, 7);
    const monthStart = `${month}-01`;
    const monthEnd = nextMonthStart(month); // exclusive
    const base = [req.user.household_id, req.user.role];

    const [accountsRes, flowsRes, categoriesRes, recurringRes, spentToday, settings] = await Promise.all([
      pool.query(
        `WITH ${SCOPE_CTE}
         SELECT s.id, s.name, s.type, s.is_private, s.archived, s.due_date, b.balance_cents,
                (s.loan_months IS NOT NULL) AS is_loan
           FROM scope s
           JOIN account_balances b ON b.account_id = s.id
          ORDER BY s.archived, s.sort_order, s.created_at`,
        base,
      ),
      pool.query(
        `WITH ${SCOPE_CTE}
         SELECT e.kind, e.category_id, SUM(e.delta)::bigint AS total
           FROM transaction_effects e
           JOIN scope s ON s.id = e.account_id
          WHERE e.occurred_on >= $3::date AND e.occurred_on < $4::date
            AND e.kind IN ('income', 'expense', 'fee')
          GROUP BY e.kind, e.category_id`,
        [...base, monthStart, monthEnd],
      ),
      pool.query(`SELECT id, name, icon, kind, is_system FROM categories WHERE household_id = $1`, [req.user.household_id]),
      pool.query(
        `${RECURRING_SELECT('$2')} AND r.household_id = $1 AND r.active
         ORDER BY r.next_date NULLS LAST`,
        base,
      ),
      todaySpending(pool, base, today),
      budgetSettings(pool, req.user.household_id),
    ]);

    // --- Balances
    const accounts = accountsRes.rows.filter((a) => !a.archived || a.balance_cents !== 0);
    const byType = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, 0]));
    for (const a of accounts) byType[a.type] += a.balance_cents;
    // People: positive = they owe you (an asset), negative = you owe them (a debt)
    const people = accounts.filter((a) => a.type === 'person');
    const owedToYou = sum(people.filter((a) => a.balance_cents > 0), (a) => a.balance_cents);
    const youOwe = sum(people.filter((a) => a.balance_cents < 0), (a) => a.balance_cents);
    const liabilities = byType.credit_card + youOwe;
    const netWorth = sum(accounts, (a) => a.balance_cents);

    // --- This month's money in / out by category
    const cats = new Map(categoriesRes.rows.map((c) => [c.id, c]));
    const feeCategory = categoriesRes.rows.find((c) => c.is_system && c.name === 'Transfer fees');
    const groups = { income: new Map(), expense: new Map() };
    let income = 0, expenses = 0, fees = 0;

    for (const row of flowsRes.rows) {
      const isIncome = row.kind === 'income';
      const amount = isIncome ? row.total : -row.total;
      const categoryId = row.kind === 'fee' ? feeCategory?.id ?? null : row.category_id;
      if (isIncome) income += amount; else expenses += amount;
      if (row.kind === 'fee') fees += amount;

      const bucket = groups[isIncome ? 'income' : 'expense'];
      const c = categoryId ? cats.get(categoryId) : null;
      const key = categoryId ?? 'uncategorised';
      const entry = bucket.get(key) ?? { category_id: categoryId, name: c?.name ?? 'Uncategorised', icon: c?.icon ?? null, total_cents: 0 };
      entry.total_cents += amount;
      bucket.set(key, entry);
    }
    const sorted = (m) => [...m.values()].sort((a, b) => b.total_cents - a.total_cents);

    // --- Recurring income and bills
    const recurring = recurringRes.rows.map((r) => serializeRecurring(req.user, r)).filter((r) => !r.paid_off);
    const monthlyIncome = sum(recurring.filter((r) => r.kind === 'income'), (r) => r.monthly_equivalent_cents);
    const monthlyBills = sum(recurring.filter((r) => r.kind === 'expense'), (r) => r.monthly_equivalent_cents);
    const horizon = addDays(today, 30);
    const upcoming = recurring.filter((r) => r.next_date && r.next_date >= today && r.next_date <= horizon);

    // --- Money on hand, today's budget and the next payroll
    const plan = buildMoneyPlan({ accounts, recurring, today, todaySpending: spentToday, ...settings });

    // --- Latest activity in this view
    const recent = await listTransactions(pool, req.user, { account_ids: accountsRes.rows.map((a) => a.id), limit: 10 });

    res.json({
      month,
      today,
      balances: {
        net_worth_cents: netWorth,
        spendable_cents: plan.spendable_cents,
        savings_cents: plan.savings_cents,
        assets_cents: netWorth - liabilities,
        liabilities_cents: liabilities,
        owed_to_you_cents: owedToYou,
        you_owe_cents: youOwe,
        by_type: byType,
        accounts,
      },
      month_flow: {
        income_cents: income,
        expense_cents: expenses,
        transfer_fees_cents: fees,
        net_cents: income - expenses,
        spending_by_category: sorted(groups.expense),
        income_by_category: sorted(groups.income),
      },
      recurring: {
        monthly_income_cents: monthlyIncome,
        monthly_expenses_cents: monthlyBills,
        monthly_net_cents: monthlyIncome - monthlyBills,
        upcoming,
      },
      plan,
      // What `plan` was built from, so the phone can rebuild it after logging something offline
      plan_inputs: {
        recurring,
        today_spending: spentToday,
        daily_budget_cents: settings.dailyBudgetCents,
        save_rate_pct: settings.saveRatePct,
      },
      recent_transactions: recent.transactions,
    });
  });

  /**
   * GET /summary/net-worth?months=12
   * Net worth at the end of each month, oldest first, for the website chart.
   */
  router.get('/net-worth', async (req, res) => {
    const q = z.object({
      months: z.coerce.number().int().min(1).max(60).default(12),
    }).parse(req.query);
    const today = todayInManila();

    const { rows } = await pool.query(
      `WITH ${SCOPE_CTE},
       -- Tracking starts at the first account or transaction; months before that aren't "₱0", they're unknown.
       tracking AS (
         SELECT date_trunc('month', LEAST(
                  (SELECT min(s.created_at AT TIME ZONE 'Asia/Manila')::date FROM scope s),
                  (SELECT min(e.occurred_on) FROM transaction_effects e JOIN scope s ON s.id = e.account_id)
                ))::date AS start
       ),
       months AS (
         SELECT (date_trunc('month', $3::date) - make_interval(months => g))::date AS start
           FROM generate_series(0, $4 - 1) AS g
          WHERE (date_trunc('month', $3::date) - make_interval(months => g))::date >= COALESCE((SELECT start FROM tracking), date_trunc('month', $3::date)::date)
       )
       SELECT to_char(m.start, 'YYYY-MM') AS month,
              ( COALESCE((SELECT SUM(s.opening_balance_cents) FROM scope s
                           WHERE s.created_at < (m.start + interval '1 month')), 0)
              + COALESCE((SELECT SUM(e.delta) FROM transaction_effects e JOIN scope s ON s.id = e.account_id
                           WHERE e.occurred_on < (m.start + interval '1 month')::date), 0)
              )::bigint AS net_worth_cents
         FROM months m
        ORDER BY m.start`,
      [req.user.household_id, req.user.role, today, q.months],
    );
    res.json({ points: rows });
  });

  /**
   * GET /summary/insights?months=6
   * Extra series for the website: everyday spending per day this month (vs the daily budget),
   * money in vs out per month, and a 45-day forecast of money on hand.
   */
  router.get('/insights', async (req, res) => {
    const q = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }).parse(req.query);
    const today = todayInManila();
    const month = today.slice(0, 7);
    const base = [req.user.household_id, req.user.role];
    const since30 = addDays(today, -29);
    const dailyFrom = `${month}-01` < since30 ? `${month}-01` : since30;
    const flowFrom = (() => {
      const [y, m] = month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 - (q.months - 1), 1));
      return d.toISOString().slice(0, 10);
    })();

    const [accountsRes, recurringRes, dailyRes, flowRes, spentToday, settings] = await Promise.all([
      pool.query(
        `WITH ${SCOPE_CTE}
         SELECT s.id, s.type, s.archived, b.balance_cents
           FROM scope s JOIN account_balances b ON b.account_id = s.id`,
        base,
      ),
      pool.query(`${RECURRING_SELECT('$2')} AND r.household_id = $1 AND r.active`, base),
      pool.query(
        `WITH ${SCOPE_CTE}
         SELECT to_char(e.occurred_on, 'YYYY-MM-DD') AS date, e.kind, e.category_id,
                (s.loan_months IS NOT NULL) AS on_loan, SUM(e.delta)::bigint AS total
           FROM transaction_effects e JOIN scope s ON s.id = e.account_id
          WHERE e.occurred_on >= $3::date AND e.occurred_on <= $4::date
            AND e.kind IN ('income', 'expense', 'fee')
          GROUP BY 1, 2, 3, 4`,
        [...base, dailyFrom, today],
      ),
      pool.query(
        `WITH ${SCOPE_CTE}
         SELECT to_char(e.occurred_on, 'YYYY-MM') AS month, e.kind, SUM(e.delta)::bigint AS total
           FROM transaction_effects e JOIN scope s ON s.id = e.account_id
          WHERE e.occurred_on >= $3::date AND e.kind IN ('income', 'expense', 'fee')
          GROUP BY 1, 2`,
        [...base, flowFrom],
      ),
      todaySpending(pool, base, today),
      budgetSettings(pool, req.user.household_id),
    ]);

    const recurring = recurringRes.rows.map((r) => serializeRecurring(req.user, r)).filter((r) => !r.paid_off);
    const plan = buildMoneyPlan({ accounts: accountsRes.rows, recurring, today, todaySpending: spentToday, ...settings });
    const billCategories = new Set(recurring.filter((r) => r.kind === 'expense').map((r) => r.category_id).filter(Boolean));

    // Per day: everyday spending vs bill payments vs income
    const days = new Map();
    for (let d = dailyFrom; d <= today; d = addDays(d, 1)) days.set(d, { date: d, everyday_cents: 0, bills_cents: 0, income_cents: 0 });
    for (const r of dailyRes.rows) {
      const day = days.get(r.date);
      if (!day) continue;
      if (r.kind === 'income') day.income_cents += Number(r.total);
      // Bills, and installment purchases (paid off later as bills), aren't everyday spending
      else if (r.on_loan || (r.category_id && billCategories.has(r.category_id))) day.bills_cents += -Number(r.total);
      else day.everyday_cents += -Number(r.total);
    }
    const allDays = [...days.values()];
    const last30 = allDays.filter((d) => d.date >= since30);
    const avgDaily = Math.round(sum(last30, (d) => d.everyday_cents) / Math.max(1, last30.length));

    // Per month: in vs out
    const months = new Map();
    for (let i = 0; i < q.months; i++) {
      const [y, m] = flowFrom.split('-').map(Number);
      const key = new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7);
      months.set(key, { month: key, income_cents: 0, expense_cents: 0 });
    }
    for (const r of flowRes.rows) {
      const row = months.get(r.month);
      if (!row) continue;
      if (r.kind === 'income') row.income_cents += Number(r.total);
      else row.expense_cents += -Number(r.total);
    }

    res.json({
      today,
      plan,
      average_daily_spend_cents: avgDaily,
      daily: allDays.filter((d) => d.date >= `${month}-01`),
      cash_flow: [...months.values()],
      forecast: forecastBalance({ plan, recurring, days: 45, dailySpend: avgDaily }),
    });
  });

  return router;
}
