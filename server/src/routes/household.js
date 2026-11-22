import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../lib/errors.js';
import { withTransaction } from '../db.js';
import { generateInviteCode } from '../lib/tokens.js';
import { requireAuth, requireOwner } from '../middleware/auth.js';

export function householdRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  // Household details and members
  router.get('/', async (req, res) => {
    const [household, members] = await Promise.all([
      pool.query(`SELECT id, name, created_at FROM households WHERE id = $1`, [req.user.household_id]),
      pool.query(
        `SELECT id, display_name, email, role, created_at FROM users WHERE household_id = $1 ORDER BY created_at`,
        [req.user.household_id],
      ),
    ]);
    res.json({ household: household.rows[0], members: members.rows });
  });

  router.patch('/', requireOwner, async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    const { rows } = await pool.query(
      `UPDATE households SET name = $1 WHERE id = $2 RETURNING id, name, created_at`,
      [name, req.user.household_id],
    );
    res.json({ household: rows[0] });
  });

  // Start over: delete all money data in the wallet. Keeps logins, partner access,
  // categories and named fee presets. Requires { confirm: "RESET" }.
  router.post('/reset', requireOwner, async (req, res) => {
    z.object({ confirm: z.literal('RESET') }).parse(req.body);
    const hh = req.user.household_id;
    const counts = await withTransaction(pool, async (db) => {
      const tx = await db.query(`DELETE FROM transactions WHERE household_id = $1`, [hh]); // payslips cascade
      const rec = await db.query(`DELETE FROM recurring_items WHERE household_id = $1`, [hh]);
      await db.query(`DELETE FROM transfer_fee_presets WHERE household_id = $1 AND name IS NULL`, [hh]); // remembered routes
      const acc = await db.query(`DELETE FROM accounts WHERE household_id = $1`, [hh]);
      await db.query(`UPDATE users SET onboarded_at = NULL WHERE id = $1`, [req.user.id]); // show the setup guide again
      return { transactions: tx.rowCount, recurring: rec.rowCount, accounts: acc.rowCount };
    });
    res.json({ deleted: counts });
  });

  // Create an invite code for your partner
  router.post('/invites', requireOwner, async (req, res) => {
    // Retry on the (very unlikely) chance of a code collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO household_invites (household_id, code, created_by, expires_at)
           VALUES ($1, $2, $3, now() + make_interval(days => $4))
           RETURNING id, code, expires_at`,
          [req.user.household_id, generateInviteCode(), req.user.id, config.inviteTtlDays],
        );
        return res.status(201).json({ invite: rows[0] });
      } catch (err) {
        if (err.code !== '23505') throw err;
      }
    }
    throw new Error('Could not generate a unique invite code');
  });

  // Invites that are still usable
  router.get('/invites', requireOwner, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, code, expires_at, created_at FROM household_invites
        WHERE household_id = $1 AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC`,
      [req.user.household_id],
    );
    res.json({ invites: rows });
  });

  router.delete('/invites/:id', requireOwner, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { rowCount } = await pool.query(
      `DELETE FROM household_invites WHERE id = $1 AND household_id = $2 AND used_at IS NULL`,
      [id, req.user.household_id],
    );
    if (!rowCount) throw notFound('Invite not found');
    res.status(204).end();
  });

  return router;
}
