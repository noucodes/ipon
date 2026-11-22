import { Router } from 'express';
import { z, ZodError } from 'zod';
import { TRANSACTION_TYPES } from '@ft/shared';
import { AppError } from '../lib/errors.js';
import { withTransaction } from '../db.js';
import { id, dateStr, parseId } from '../lib/validators.js';
import {
  createTxSchema, updateTxSchema, validateTx, createTransaction,
  fetchTransaction, listTransactions, loadEditable,
} from '../lib/transactions.js';
import { requireAuth } from '../middleware/auth.js';

const listQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  account_id: id.optional(),
  category_id: id.optional(),
  created_by: id.optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const syncSchema = z.object({ transactions: z.array(z.unknown()).min(1).max(100) });

export function transactionsRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  router.get('/', async (req, res) => {
    res.json(await listTransactions(pool, req.user, listQuery.parse(req.query)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ transaction: await fetchTransaction(pool, req.user, parseId(req.params.id)) });
  });

  router.post('/', async (req, res) => {
    const input = createTxSchema.parse(req.body);
    const result = await withTransaction(pool, (db) => createTransaction(db, req.user, input));
    res.status(result.created ? 201 : 200).json({
      transaction: await fetchTransaction(pool, req.user, result.id),
      created: result.created,
    });
  });

  // Upload entries the phone saved while offline. Each one succeeds or fails on its own,
  // and re-sending the same client_id is harmless.
  router.post('/sync', async (req, res) => {
    const { transactions } = syncSchema.parse(req.body);
    const results = [];
    for (const raw of transactions) {
      const clientId = raw && typeof raw === 'object' ? raw.client_id : undefined;
      try {
        const input = createTxSchema.extend({ client_id: id }).parse(raw);
        const r = await withTransaction(pool, (db) => createTransaction(db, req.user, input));
        results.push({ client_id: clientId, status: r.created ? 'created' : 'duplicate', id: r.id });
      } catch (err) {
        if (err instanceof AppError) {
          results.push({ client_id: clientId, status: 'error', error: err.code, message: err.message });
        } else if (err instanceof ZodError) {
          results.push({ client_id: clientId, status: 'error', error: 'validation_error', message: 'Some fields are invalid' });
        } else {
          console.error('sync item failed:', err);
          results.push({ client_id: clientId, status: 'error', error: 'server_error', message: 'Could not save this entry' });
        }
      }
    }
    res.json({ results });
  });

  router.patch('/:id', async (req, res) => {
    const txId = parseId(req.params.id);
    const patch = updateTxSchema.parse(req.body);

    await withTransaction(pool, async (db) => {
      const current = await loadEditable(db, req.user, txId);
      // Changing type (e.g. expense -> transfer) drops a category that no longer fits.
      if (patch.type && patch.type !== current.type && patch.category_id === undefined) patch.category_id = null;
      const next = await validateTx(db, req.user, { ...current, ...patch }, { allowArchived: true });
      await db.query(
        `UPDATE transactions
            SET type = $1, amount_cents = $2, account_id = $3, to_account_id = $4, fee_cents = $5,
                fee_paid_by = $6, category_id = $7, occurred_on = $8, note = $9, updated_at = now()
          WHERE id = $10`,
        [next.type, next.amount_cents, next.account_id, next.to_account_id, next.fee_cents,
          next.fee_paid_by, next.category_id, next.occurred_on, next.note, txId],
      );
    });
    res.json({ transaction: await fetchTransaction(pool, req.user, txId) });
  });

  router.delete('/:id', async (req, res) => {
    const txId = parseId(req.params.id);
    await loadEditable(pool, req.user, txId);
    await pool.query(`UPDATE transactions SET deleted_at = now() WHERE id = $1`, [txId]);
    res.status(204).end();
  });

  return router;
}
