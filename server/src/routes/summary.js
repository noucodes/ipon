import { Router } from 'express';
import { z } from 'zod';
import { ACCOUNT_TYPES, todayInManila, addDays, nextMonthStart } from '@ft/shared';
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

    const [accountsRes, flowsRes, categoriesRes, recurringRes] = await Promise.all([
      pool.query(
        `WITH ${SCOPE_CTE}
         SELECT s.id, s.name, s.type, s.is_private, s.archived, s.due_date, b.balance_cents
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

    // --- Latest activity in this view
    const recent = await listTransactions(pool, req.user, { account_ids: accountsRes.rows.map((a) => a.id), limit: 10 });

    res.json({
      month,
      today,
      balances: {
        net_worth_cents: netWorth,
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

  return router;
}
