import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TRANSACTION_TYPES, FEE_PAID_BY, todayInManila } from '@ft/shared';
import { badRequest, forbidden, notFound } from './errors.js';
import { id, positiveCents, nonNegativeCents, dateStr } from './validators.js';
import { visibleSql, isOwner, getVisibleAccounts, assertCategory } from './access.js';

export const createTxSchema = z.object({
  client_id: id.optional(), // phone generates one; makes retries/offline sync safe
  type: z.enum(TRANSACTION_TYPES),
  amount_cents: positiveCents,
  account_id: id, // for transfers: the "from" account
  to_account_id: id.nullable().optional(),
  fee_cents: nonNegativeCents.default(0),
  fee_paid_by: z.enum(FEE_PAID_BY).nullable().optional(),
  category_id: id.nullable().optional(),
  occurred_on: dateStr.optional(), // defaults to today in Manila
  note: z.string().trim().max(500).nullable().optional(),
});

export const updateTxSchema = createTxSchema.omit({ client_id: true }).partial();

/** Fill defaults and check the transaction makes sense. Mutates and returns tx. */
export async function validateTx(db, user, tx, { allowArchived = false } = {}) {
  tx.occurred_on ??= todayInManila();
  tx.note = tx.note || null;
  tx.category_id ??= null;

  if (tx.type === 'transfer') {
    if (!tx.to_account_id) throw badRequest('Choose where the money is going', 'to_account_required');
    if (tx.to_account_id === tx.account_id) throw badRequest("You can't transfer to the same account", 'same_account');
    tx.fee_cents ??= 0;
    tx.fee_paid_by ??= 'sender';
    if (tx.fee_paid_by === 'receiver' && tx.fee_cents > tx.amount_cents) {
      throw badRequest('Fee is larger than the amount received', 'fee_too_large');
    }
    if (tx.category_id) throw badRequest('Transfers do not have a category', 'transfer_category');
  } else {
    tx.to_account_id = null;
    tx.fee_cents = 0;
    tx.fee_paid_by = null;
  }

  const ids = [tx.account_id, tx.to_account_id].filter(Boolean);
  const accounts = await getVisibleAccounts(db, user, ids);
  for (const accountId of ids) {
    const a = accounts.get(accountId);
    if (!a) throw notFound('Account not found');
    if (a.archived && !allowArchived) throw badRequest(`${a.name} is archived`, 'account_archived');
  }

  if (tx.category_id) await assertCategory(db, user, tx.category_id, tx.type);
  return tx;
}

/** Remember the fee used for this from -> to route so the phone can pre-fill it next time. */
async function rememberRouteFee(db, user, tx) {
  await db.query(
    `INSERT INTO transfer_fee_presets (household_id, from_account_id, to_account_id, fee_cents, fee_paid_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (household_id, from_account_id, to_account_id) WHERE from_account_id IS NOT NULL
     DO UPDATE SET fee_cents = EXCLUDED.fee_cents, fee_paid_by = EXCLUDED.fee_paid_by, updated_at = now()`,
    [user.household_id, tx.account_id, tx.to_account_id, tx.fee_cents, tx.fee_paid_by],
  );
}

/**
 * Create a transaction. Idempotent on client_id: sending the same one twice
 * returns the existing transaction with created = false.
 */
export async function createTransaction(db, user, input) {
  const tx = { ...input, client_id: input.client_id ?? randomUUID() };

  const existing = await db.query(
    `SELECT id FROM transactions WHERE household_id = $1 AND client_id = $2`,
    [user.household_id, tx.client_id],
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };

  await validateTx(db, user, tx);
  const { rows } = await db.query(
    `INSERT INTO transactions (household_id, client_id, type, amount_cents, account_id, to_account_id,
                               fee_cents, fee_paid_by, category_id, occurred_on, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (household_id, client_id) DO NOTHING
     RETURNING id`,
    [user.household_id, tx.client_id, tx.type, tx.amount_cents, tx.account_id, tx.to_account_id,
      tx.fee_cents, tx.fee_paid_by, tx.category_id, tx.occurred_on, tx.note, user.id],
  );
  if (!rows[0]) {
    // Lost a race with an identical request
    const again = await db.query(`SELECT id FROM transactions WHERE household_id = $1 AND client_id = $2`, [user.household_id, tx.client_id]);
    return { id: again.rows[0].id, created: false };
  }
  if (tx.type === 'transfer') await rememberRouteFee(db, user, tx);
  return { id: rows[0].id, created: true };
}

const SELECT = (roleParam) => `
  SELECT t.id, t.client_id, t.type, t.amount_cents, t.fee_cents, t.fee_paid_by,
         t.occurred_on, t.note, t.created_at, t.updated_at,
         t.account_id, a.name AS account_name, a.type AS account_type, ${visibleSql('a', roleParam)} AS account_visible,
         t.to_account_id, ta.name AS to_account_name, ta.type AS to_account_type,
         (ta.id IS NULL OR ${visibleSql('ta', roleParam)}) AS to_account_visible,
         t.category_id, c.name AS category_name, c.icon AS category_icon,
         t.created_by, u.display_name AS created_by_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN accounts ta ON ta.id = t.to_account_id
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN users u ON u.id = t.created_by`;

const VISIBLE_WHERE = (roleParam) =>
  `t.deleted_at IS NULL AND (${visibleSql('a', roleParam)} OR (ta.id IS NOT NULL AND ${visibleSql('ta', roleParam)}))`;

const PRIVATE = 'Private account';

function serialize(user, row) {
  const { account_visible, to_account_visible, ...t } = row;
  if (!account_visible) Object.assign(t, { account_id: null, account_name: PRIVATE, account_type: null });
  if (!to_account_visible) Object.assign(t, { to_account_id: null, to_account_name: PRIVATE, to_account_type: null });
  // Owner can edit anything; a partner only entries they logged (and can fully see).
  t.can_edit = account_visible && to_account_visible && (isOwner(user) || t.created_by === user.id);
  return t;
}

export async function fetchTransaction(db, user, txId) {
  const { rows } = await db.query(
    `${SELECT('$3')} WHERE t.id = $1 AND t.household_id = $2 AND ${VISIBLE_WHERE('$3')}`,
    [txId, user.household_id, user.role],
  );
  if (!rows[0]) throw notFound('Transaction not found');
  return serialize(user, rows[0]);
}

/** List transactions with filters. Returns { transactions, has_more }. */
export async function listTransactions(db, user, f = {}) {
  const params = [user.household_id, user.role];
  const where = [`t.household_id = $1`, VISIBLE_WHERE('$2')];
  const add = (value) => `$${params.push(value)}`;

  if (f.from) where.push(`t.occurred_on >= ${add(f.from)}`);
  if (f.to) where.push(`t.occurred_on <= ${add(f.to)}`);
  if (f.type) where.push(`t.type = ${add(f.type)}`);
  if (f.category_id) where.push(`t.category_id = ${add(f.category_id)}`);
  if (f.created_by) where.push(`t.created_by = ${add(f.created_by)}`);
  if (f.account_id) {
    const p = add(f.account_id);
    where.push(`(t.account_id = ${p} OR t.to_account_id = ${p})`);
  }
  if (f.account_ids) {
    const p = add(f.account_ids);
    where.push(`(t.account_id = ANY(${p}::uuid[]) OR t.to_account_id = ANY(${p}::uuid[]))`);
  }
  if (f.q) where.push(`t.note ILIKE ${add(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`)}`);

  const limit = f.limit ?? 50;
  const { rows } = await db.query(
    `${SELECT('$2')} WHERE ${where.join(' AND ')}
      ORDER BY t.occurred_on DESC, t.created_at DESC, t.id DESC
      LIMIT ${add(limit + 1)} OFFSET ${add(f.offset ?? 0)}`,
    params,
  );
  return { transactions: rows.slice(0, limit).map((r) => serialize(user, r)), has_more: rows.length > limit };
}

/** Load a raw transaction row the user is allowed to modify. */
export async function loadEditable(db, user, txId) {
  const tx = await fetchTransaction(db, user, txId);
  if (!tx.can_edit) throw forbidden('You can only change entries you logged yourself');
  const { rows } = await db.query(`SELECT * FROM transactions WHERE id = $1`, [txId]);
  return rows[0];
}
