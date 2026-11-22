import { Router } from 'express';
import { z } from 'zod';
import { ACCOUNT_TYPES } from '@ft/shared';
import { conflict, notFound } from '../lib/errors.js';
import { parseId, signedCents, dateStr } from '../lib/validators.js';
import { visibleSql, isOwner, requireOwner } from '../lib/access.js';
import { requireAuth } from '../middleware/auth.js';

const fields = {
  name: z.string().trim().min(1).max(60),
  type: z.enum(ACCOUNT_TYPES),
  // Credit cards: enter what you owe as a negative number
  opening_balance_cents: signedCents,
  is_private: z.boolean(), // hidden from your partner
  archived: z.boolean(),
  sort_order: z.number().int().min(0).max(10_000),
  // People (type 'person') only: optional pay-back date and a note
  due_date: dateStr.nullable(),
  note: z.string().trim().max(300).nullable(),
};

const createSchema = z.object({
  name: fields.name,
  type: fields.type,
  opening_balance_cents: fields.opening_balance_cents.default(0),
  is_private: fields.is_private.default(false),
  sort_order: fields.sort_order.default(0),
  due_date: fields.due_date.default(null),
  note: fields.note.default(null),
});

const updateSchema = z.object(fields).partial();

const SELECT = `
  SELECT a.id, a.name, a.type, a.is_private, a.archived, a.sort_order, a.due_date, a.note,
         a.loan_total_cents, a.loan_installment_cents, a.loan_months, a.loan_first_due,
         a.opening_balance_cents, b.balance_cents, a.created_at, a.updated_at
    FROM accounts a
    JOIN account_balances b ON b.account_id = a.id`;

const serialize = (user, row) => ({ ...row, can_edit: isOwner(user) });

async function fetchAccount(db, user, accountId) {
  const { rows } = await db.query(
    `${SELECT} WHERE a.id = $1 AND a.household_id = $2 AND ${visibleSql('a', '$3')}`,
    [accountId, user.household_id, user.role],
  );
  if (!rows[0]) throw notFound('Account not found');
  return rows[0];
}

export function accountsRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  router.get('/', async (req, res) => {
    const { include_archived } = z.object({ include_archived: z.stringbool().default(false) }).parse(req.query);
    const { rows } = await pool.query(
      `${SELECT}
        WHERE a.household_id = $1 AND ${visibleSql('a', '$2')} AND ($3 OR NOT a.archived)
        ORDER BY a.archived, a.sort_order, a.created_at`,
      [req.user.household_id, req.user.role, include_archived],
    );
    res.json({ accounts: rows.map((r) => serialize(req.user, r)) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ account: serialize(req.user, await fetchAccount(pool, req.user, parseId(req.params.id))) });
  });

  router.post('/', requireOwner, async (req, res) => {
    const body = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO accounts (household_id, name, type, opening_balance_cents, is_private, sort_order, due_date, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user.household_id, body.name, body.type, body.opening_balance_cents, body.is_private, body.sort_order, body.due_date, body.note || null],
    );
    res.status(201).json({ account: serialize(req.user, await fetchAccount(pool, req.user, rows[0].id)) });
  });

  router.patch('/:id', requireOwner, async (req, res) => {
    const accountId = parseId(req.params.id);
    const patch = updateSchema.parse(req.body);
    const next = { ...(await fetchAccount(pool, req.user, accountId)), ...patch };
    await pool.query(
      `UPDATE accounts
          SET name = $1, type = $2, opening_balance_cents = $3, is_private = $4,
              archived = $5, sort_order = $6, due_date = $7, note = $8, updated_at = now()
        WHERE id = $9 AND household_id = $10`,
      [next.name, next.type, next.opening_balance_cents, next.is_private, next.archived, next.sort_order,
        next.due_date, next.note || null, accountId, req.user.household_id],
    );
    res.json({ account: serialize(req.user, await fetchAccount(pool, req.user, accountId)) });
  });

  // Only accounts with no transactions can be deleted; otherwise archive them.
  router.delete('/:id', requireOwner, async (req, res) => {
    const accountId = parseId(req.params.id);
    await fetchAccount(pool, req.user, accountId);
    const used = await pool.query(`SELECT 1 FROM transactions WHERE account_id = $1 OR to_account_id = $1 LIMIT 1`, [accountId]);
    if (used.rowCount) throw conflict('This account has transactions. Archive it instead.', 'account_in_use');
    await pool.query(`DELETE FROM accounts WHERE id = $1 AND household_id = $2`, [accountId, req.user.household_id]);
    res.status(204).end();
  });

  return router;
}
