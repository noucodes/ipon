import { Router } from 'express';
import { z } from 'zod';
import { FREQUENCIES, RECURRING_KINDS, monthlyEquivalentCents, nextCustomDate, todayInManila } from '@ft/shared';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { id, positiveCents, dateStr, parseId } from '../lib/validators.js';
import { visibleSql, isOwner, requireOwner, getVisibleAccounts, assertCategory } from '../lib/access.js';
import { requireAuth } from '../middleware/auth.js';

// Salary, freelance income, rent, subscriptions, loan payments...
const fields = {
  kind: z.enum(RECURRING_KINDS),
  name: z.string().trim().min(1).max(60),
  amount_cents: positiveCents,
  frequency: z.enum(FREQUENCIES),
  account_id: id.nullable(),
  category_id: id.nullable(),
  next_date: dateStr.nullable(),
  active: z.boolean(),
  // custom_days only: e.g. [13, 16] or [15, 31] (31 = last day of the month)
  days_of_month: z.array(z.number().int().min(1).max(31)).min(1).max(10).nullable(),
};

const createSchema = z.object({
  id: z.uuid().optional(), // chosen by the phone for entries saved offline
  ...fields,
  account_id: fields.account_id.default(null),
  category_id: fields.category_id.default(null),
  next_date: fields.next_date.default(null),
  active: fields.active.default(true),
  days_of_month: fields.days_of_month.default(null),
});

// Hidden from a partner if it's tied to a private account. $role param = viewer's role.
export const RECURRING_SELECT = (roleParam) => `
  SELECT r.id, r.kind, r.name, r.amount_cents, r.frequency,
         r.account_id, a.name AS account_name, r.category_id, c.name AS category_name,
         r.next_date, r.active, r.days_of_month, r.created_at, r.updated_at,
         r.loan_account_id, la.name AS loan_account_name, lb.balance_cents AS loan_balance_cents,
         la.loan_installment_cents, la.loan_months, la.loan_total_cents,
         -- expected pay = average net of the latest payslips (4 for twice-a-month, else 3)
         (SELECT round(avg(x.net_cents))::bigint FROM (
            SELECT p.net_cents FROM payslips p
              JOIN transactions pt ON pt.id = p.transaction_id AND pt.deleted_at IS NULL
             WHERE p.recurring_item_id = r.id
             ORDER BY pt.occurred_on DESC
             LIMIT CASE WHEN r.frequency = 'semi_monthly' THEN 4 ELSE 3 END) x) AS average_net_cents
    FROM recurring_items r
    LEFT JOIN accounts a ON a.id = r.account_id
    LEFT JOIN accounts la ON la.id = r.loan_account_id
    LEFT JOIN account_balances lb ON lb.account_id = r.loan_account_id
    LEFT JOIN categories c ON c.id = r.category_id
   WHERE (a.id IS NULL OR ${visibleSql('a', roleParam)})
     AND (la.id IS NULL OR ${visibleSql('la', roleParam)})`;

export function serializeRecurring(user, r) {
  return {
    ...r,
    // Use the payslip average when there is one, so the monthly plan follows real pay
    expected_cents: r.average_net_cents ?? r.amount_cents,
    monthly_equivalent_cents: monthlyEquivalentCents(r.average_net_cents ?? r.amount_cents, r.frequency, r.days_of_month),
    // Linked loan fully paid: stop counting it as a monthly bill / reminding
    paid_off: r.loan_account_id != null && r.loan_balance_cents >= 0,
    can_edit: isOwner(user),
  };
}

/** Custom days need at least one day; other schedules don't keep any. Next date defaults to the next one. */
function normaliseDays(item) {
  if (item.frequency === 'custom_days') {
    const days = [...new Set(item.days_of_month ?? [])].sort((a, b) => a - b);
    if (!days.length) throw badRequest('Pick at least one day of the month', 'days_required');
    item.days_of_month = days;
    item.next_date ??= nextCustomDate(days, todayInManila());
  } else {
    item.days_of_month = null;
  }
  return item;
}

async function validateRefs(db, user, item) {
  if (item.account_id) {
    const accounts = await getVisibleAccounts(db, user, [item.account_id]);
    if (!accounts.size) throw notFound('Account not found');
  }
  if (item.category_id) await assertCategory(db, user, item.category_id, item.kind);
}

export function recurringRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  async function fetchOne(user, itemId) {
    const { rows } = await pool.query(
      `${RECURRING_SELECT('$3')} AND r.id = $1 AND r.household_id = $2`,
      [itemId, user.household_id, user.role],
    );
    if (!rows[0]) throw notFound('Item not found');
    return serializeRecurring(user, rows[0]);
  }

  router.get('/', async (req, res) => {
    const { kind } = z.object({ kind: z.enum(RECURRING_KINDS).optional() }).parse(req.query);
    const { rows } = await pool.query(
      `${RECURRING_SELECT('$2')} AND r.household_id = $1 AND ($3::text IS NULL OR r.kind = $3)
       ORDER BY r.kind DESC, r.active DESC, r.next_date NULLS LAST, r.name`,
      [req.user.household_id, req.user.role, kind ?? null],
    );
    res.json({ items: rows.map((r) => serializeRecurring(req.user, r)) });
  });

  router.post('/', requireOwner, async (req, res) => {
    const item = createSchema.parse(req.body);
    // The phone picks the id when it saves offline; sending the same one again is harmless.
    if (item.id) {
      const { rows: found } = await pool.query(`SELECT household_id FROM recurring_items WHERE id = $1`, [item.id]);
      if (found[0]) {
        if (found[0].household_id !== req.user.household_id) throw conflict('That id is already in use', 'id_taken');
        return res.status(200).json({ item: await fetchOne(req.user, item.id) });
      }
    }
    normaliseDays(item);
    await validateRefs(pool, req.user, item);
    const { rows } = await pool.query(
      `INSERT INTO recurring_items (id, household_id, kind, name, amount_cents, frequency, account_id, category_id, next_date, active, days_of_month)
       VALUES (COALESCE($11::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [req.user.household_id, item.kind, item.name, item.amount_cents, item.frequency,
        item.account_id, item.category_id, item.next_date, item.active, item.days_of_month, item.id ?? null],
    );
    res.status(201).json({ item: await fetchOne(req.user, rows[0].id) });
  });

  router.patch('/:id', requireOwner, async (req, res) => {
    const itemId = parseId(req.params.id);
    const patch = z.object(fields).partial().parse(req.body);
    const current = await fetchOne(req.user, itemId);
    if (patch.kind && patch.kind !== current.kind && patch.category_id === undefined) patch.category_id = null;
    const next = normaliseDays({ ...current, ...patch });
    await validateRefs(pool, req.user, next);
    await pool.query(
      `UPDATE recurring_items
          SET kind = $1, name = $2, amount_cents = $3, frequency = $4, account_id = $5,
              category_id = $6, next_date = $7, active = $8, days_of_month = $9, updated_at = now()
        WHERE id = $10`,
      [next.kind, next.name, next.amount_cents, next.frequency, next.account_id,
        next.category_id, next.next_date, next.active, next.days_of_month, itemId],
    );
    res.json({ item: await fetchOne(req.user, itemId) });
  });

  router.delete('/:id', requireOwner, async (req, res) => {
    const itemId = parseId(req.params.id);
    await fetchOne(req.user, itemId);
    await pool.query(`DELETE FROM recurring_items WHERE id = $1`, [itemId]);
    res.status(204).end();
  });

  return router;
}
