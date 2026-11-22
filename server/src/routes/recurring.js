import { Router } from 'express';
import { z } from 'zod';
import { FREQUENCIES, RECURRING_KINDS, monthlyEquivalentCents } from '@ft/shared';
import { notFound } from '../lib/errors.js';
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
};

const createSchema = z.object({
  ...fields,
  account_id: fields.account_id.default(null),
  category_id: fields.category_id.default(null),
  next_date: fields.next_date.default(null),
  active: fields.active.default(true),
});

// Hidden from a partner if it's tied to a private account. $role param = viewer's role.
export const RECURRING_SELECT = (roleParam) => `
  SELECT r.id, r.kind, r.name, r.amount_cents, r.frequency,
         r.account_id, a.name AS account_name, r.category_id, c.name AS category_name,
         r.next_date, r.active, r.created_at, r.updated_at
    FROM recurring_items r
    LEFT JOIN accounts a ON a.id = r.account_id
    LEFT JOIN categories c ON c.id = r.category_id
   WHERE (a.id IS NULL OR ${visibleSql('a', roleParam)})`;

export function serializeRecurring(user, r) {
  return {
    ...r,
    monthly_equivalent_cents: monthlyEquivalentCents(r.amount_cents, r.frequency),
    can_edit: isOwner(user),
  };
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
    await validateRefs(pool, req.user, item);
    const { rows } = await pool.query(
      `INSERT INTO recurring_items (household_id, kind, name, amount_cents, frequency, account_id, category_id, next_date, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.user.household_id, item.kind, item.name, item.amount_cents, item.frequency,
        item.account_id, item.category_id, item.next_date, item.active],
    );
    res.status(201).json({ item: await fetchOne(req.user, rows[0].id) });
  });

  router.patch('/:id', requireOwner, async (req, res) => {
    const itemId = parseId(req.params.id);
    const patch = z.object(fields).partial().parse(req.body);
    const current = await fetchOne(req.user, itemId);
    if (patch.kind && patch.kind !== current.kind && patch.category_id === undefined) patch.category_id = null;
    const next = { ...current, ...patch };
    await validateRefs(pool, req.user, next);
    await pool.query(
      `UPDATE recurring_items
          SET kind = $1, name = $2, amount_cents = $3, frequency = $4, account_id = $5,
              category_id = $6, next_date = $7, active = $8, updated_at = now()
        WHERE id = $9`,
      [next.kind, next.name, next.amount_cents, next.frequency, next.account_id,
        next.category_id, next.next_date, next.active, itemId],
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
