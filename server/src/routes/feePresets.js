import { Router } from 'express';
import { z } from 'zod';
import { FEE_PAID_BY } from '@ft/shared';
import { notFound } from '../lib/errors.js';
import { id, nonNegativeCents, parseId } from '../lib/validators.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner, getVisibleAccounts } from '../lib/access.js';

const fields = {
  name: z.string().trim().min(1).max(40),
  fee_cents: nonNegativeCents,
  fee_paid_by: z.enum(FEE_PAID_BY),
};

export function feePresetsRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  // Named presets like "InstaPay ₱15"
  router.get('/', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, fee_cents, fee_paid_by FROM transfer_fee_presets
        WHERE household_id = $1 AND name IS NOT NULL ORDER BY name`,
      [req.user.household_id],
    );
    res.json({ presets: rows });
  });

  // Fee last used for this from -> to route, for pre-filling the transfer form.
  router.get('/suggest', async (req, res) => {
    const q = z.object({ from: id, to: id }).parse(req.query);
    const visible = await getVisibleAccounts(pool, req.user, [q.from, q.to]);
    if (visible.size < 2) return res.json({ suggestion: null });
    const { rows } = await pool.query(
      `SELECT fee_cents, fee_paid_by, updated_at AS last_used_at FROM transfer_fee_presets
        WHERE household_id = $1 AND from_account_id = $2 AND to_account_id = $3`,
      [req.user.household_id, q.from, q.to],
    );
    res.json({ suggestion: rows[0] ?? null });
  });

  router.post('/', requireOwner, async (req, res) => {
    const body = z.object({ ...fields, fee_paid_by: fields.fee_paid_by.default('sender') }).parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO transfer_fee_presets (household_id, name, fee_cents, fee_paid_by)
       VALUES ($1, $2, $3, $4) RETURNING id, name, fee_cents, fee_paid_by`,
      [req.user.household_id, body.name, body.fee_cents, body.fee_paid_by],
    );
    res.status(201).json({ preset: rows[0] });
  });

  router.patch('/:id', requireOwner, async (req, res) => {
    const patch = z.object(fields).partial().parse(req.body);
    const { rows: [current] } = await pool.query(
      `SELECT * FROM transfer_fee_presets WHERE id = $1 AND household_id = $2 AND name IS NOT NULL`,
      [parseId(req.params.id), req.user.household_id],
    );
    if (!current) throw notFound('Preset not found');
    const next = { ...current, ...patch };
    const { rows } = await pool.query(
      `UPDATE transfer_fee_presets SET name = $1, fee_cents = $2, fee_paid_by = $3, updated_at = now()
        WHERE id = $4 RETURNING id, name, fee_cents, fee_paid_by`,
      [next.name, next.fee_cents, next.fee_paid_by, current.id],
    );
    res.json({ preset: rows[0] });
  });

  router.delete('/:id', requireOwner, async (req, res) => {
    const { rowCount } = await pool.query(
      `DELETE FROM transfer_fee_presets WHERE id = $1 AND household_id = $2 AND name IS NOT NULL`,
      [parseId(req.params.id), req.user.household_id],
    );
    if (!rowCount) throw notFound('Preset not found');
    res.status(204).end();
  });

  return router;
}
