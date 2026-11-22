// Payslips: salary / part-time / project pay with a breakdown of deductions.
// Only the NET amount becomes an income transaction (matches the bank deposit).
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { INCOME_TYPES, LINE_KINDS, computeNet, payslipTotals, cutoffOf, todayInManila } from '@ft/shared';
import { withTransaction } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { id, dateStr, nonNegativeCents, positiveCents, parseId } from '../lib/validators.js';
import { isOwner, requireOwner } from '../lib/access.js';
import { createTransaction, fetchTransaction } from '../lib/transactions.js';
import { requireAuth } from '../middleware/auth.js';

const line = z.object({
  label: z.string().trim().min(1).max(40),
  kind: z.enum(Object.keys(LINE_KINDS)),
  amount_cents: nonNegativeCents,
});

const payslipSchema = z.object({
  client_id: id.optional(),
  income_type: z.enum(INCOME_TYPES),
  source_name: z.string().trim().min(1).max(60),
  recurring_item_id: id.nullable().optional(),
  account_id: id, // where the net pay arrived
  occurred_on: dateStr.optional(),
  gross_cents: nonNegativeCents,
  lines: z.array(line).max(40).default([]),
  hours: z.number().positive().max(10_000).nullable().optional(),
  rate_cents: positiveCents.nullable().optional(),
  category_id: id.nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  is_private: z.boolean().default(true),
});

const DEFAULT_CATEGORY = { salary: 'salary', part_time: 'part-time', project: 'freelance' };

/** Partners see payslips only when the owner made them non-private. */
const visibleWhere = (alias, roleParam) => `(${alias}.is_private = false OR ${roleParam}::text = 'owner')`;

function serialize(row) {
  return { ...row, lines: row.lines ?? [] };
}

export function payslipsRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  // Log pay: creates the income transaction (net) and the breakdown together.
  router.post('/', requireOwner, async (req, res) => {
    const b = payslipSchema.parse(req.body);
    const net = computeNet(b.gross_cents, b.lines);
    if (net <= 0) throw badRequest('Deductions are more than the pay', 'net_not_positive');
    const occurredOn = b.occurred_on ?? todayInManila();
    const user = req.user;

    const result = await withTransaction(pool, async (db) => {
      if (b.recurring_item_id) {
        const { rowCount } = await db.query(
          `SELECT 1 FROM recurring_items WHERE id = $1 AND household_id = $2 AND kind = 'income'`,
          [b.recurring_item_id, user.household_id],
        );
        if (!rowCount) throw notFound('Income source not found');
      }
      let categoryId = b.category_id ?? null;
      if (categoryId === null) {
        const { rows } = await db.query(
          `SELECT id FROM categories WHERE household_id = $1 AND kind = 'income' AND lower(name) = $2`,
          [user.household_id, DEFAULT_CATEGORY[b.income_type]],
        );
        categoryId = rows[0]?.id ?? null;
      }
      const tx = await createTransaction(db, user, {
        client_id: b.client_id ?? randomUUID(),
        type: 'income',
        amount_cents: net,
        account_id: b.account_id,
        category_id: categoryId,
        occurred_on: occurredOn,
        note: b.note || b.source_name,
      });
      if (!tx.created) {
        // Same client_id sent again (offline retry): return the existing payslip
        const { rows } = await db.query(`SELECT * FROM payslips WHERE transaction_id = $1`, [tx.id]);
        return { txId: tx.id, payslip: rows[0] };
      }
      const { rows } = await db.query(
        `INSERT INTO payslips (household_id, transaction_id, recurring_item_id, income_type, source_name, cutoff,
                               gross_cents, lines, net_cents, hours, rate_cents, is_private, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [user.household_id, tx.id, b.recurring_item_id ?? null, b.income_type, b.source_name, cutoffOf(occurredOn),
          b.gross_cents, JSON.stringify(b.lines), net, b.hours ?? null, b.rate_cents ?? null, b.is_private, user.id],
      );
      return { txId: tx.id, payslip: rows[0] };
    });

    res.status(201).json({
      payslip: serialize(result.payslip),
      transaction: await fetchTransaction(pool, user, result.txId),
    });
  });

  // Add a breakdown to an income you already logged (e.g. swiped right for ₱14,300).
  // The amount received stays as-is; gross = net + deductions − additions.
  router.post('/attach', requireOwner, async (req, res) => {
    const b = z.object({
      transaction_id: id,
      income_type: z.enum(INCOME_TYPES),
      source_name: z.string().trim().min(1).max(60),
      recurring_item_id: id.nullable().optional(),
      lines: z.array(line).max(40).default([]),
      is_private: z.boolean().default(true),
    }).parse(req.body);
    const user = req.user;

    const payslip = await withTransaction(pool, async (db) => {
      const { rows: [tx] } = await db.query(
        `SELECT id, type, amount_cents, occurred_on, category_id FROM transactions
          WHERE id = $1 AND household_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [b.transaction_id, user.household_id],
      );
      if (!tx) throw notFound('Transaction not found');
      if (tx.type !== 'income') throw badRequest('Payslip details can only be added to income', 'not_income');
      const existing = await db.query(`SELECT 1 FROM payslips WHERE transaction_id = $1`, [tx.id]);
      if (existing.rowCount) throw badRequest('This income already has payslip details', 'already_attached');
      if (b.recurring_item_id) {
        const { rowCount } = await db.query(
          `SELECT 1 FROM recurring_items WHERE id = $1 AND household_id = $2 AND kind = 'income'`,
          [b.recurring_item_id, user.household_id],
        );
        if (!rowCount) throw notFound('Income source not found');
      }

      // Work backwards from what arrived: gross = net + deductions − additions
      const deducted = b.lines.reduce((n, l) => n + (LINE_KINDS[l.kind].sign === 1 ? -l.amount_cents : l.amount_cents), 0);
      const gross = tx.amount_cents + deducted;
      if (gross < 0) throw badRequest('Additions are more than the pay', 'gross_negative');

      // Give it the matching income category if it has none yet
      if (!tx.category_id) {
        const { rows } = await db.query(
          `SELECT id FROM categories WHERE household_id = $1 AND kind = 'income' AND lower(name) = $2`,
          [user.household_id, DEFAULT_CATEGORY[b.income_type]],
        );
        if (rows[0]) await db.query(`UPDATE transactions SET category_id = $1, updated_at = now() WHERE id = $2`, [rows[0].id, tx.id]);
      }

      const { rows } = await db.query(
        `INSERT INTO payslips (household_id, transaction_id, recurring_item_id, income_type, source_name, cutoff,
                               gross_cents, lines, net_cents, is_private, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [user.household_id, tx.id, b.recurring_item_id ?? null, b.income_type, b.source_name, cutoffOf(tx.occurred_on),
          gross, JSON.stringify(b.lines), tx.amount_cents, b.is_private, user.id],
      );
      return rows[0];
    });
    res.status(201).json({ payslip: serialize(payslip) });
  });

  // Last payslip for this source (same cutoff when possible), to pre-fill the form.
  router.get('/template', async (req, res) => {
    const q = z.object({
      recurring_item_id: id.optional(),
      source_name: z.string().trim().min(1).max(60).optional(),
      date: dateStr.optional(),
    }).parse(req.query);
    if (!q.recurring_item_id && !q.source_name) return res.json({ template: null });
    const cutoff = cutoffOf(q.date ?? todayInManila());
    const { rows } = await pool.query(
      `SELECT p.* FROM payslips p
         JOIN transactions t ON t.id = p.transaction_id AND t.deleted_at IS NULL
        WHERE p.household_id = $1
          AND (($2::uuid IS NOT NULL AND p.recurring_item_id = $2) OR ($2::uuid IS NULL AND lower(p.source_name) = lower($3)))
          AND ${visibleWhere('p', '$5')}
        ORDER BY (p.cutoff = $4) DESC, t.occurred_on DESC, p.created_at DESC
        LIMIT 1`,
      [req.user.household_id, q.recurring_item_id ?? null, q.source_name ?? '', cutoff, req.user.role],
    );
    res.json({ template: rows[0] ? serialize(rows[0]) : null });
  });

  // Recent payslips (newest first)
  router.get('/', async (req, res) => {
    const q = z.object({
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT p.*, t.occurred_on, t.account_id, a.name AS account_name
         FROM payslips p
         JOIN transactions t ON t.id = p.transaction_id AND t.deleted_at IS NULL
         JOIN accounts a ON a.id = t.account_id
        WHERE p.household_id = $1 AND ${visibleWhere('p', '$2')}
          AND ($3::int IS NULL OR extract(year FROM t.occurred_on) = $3)
        ORDER BY t.occurred_on DESC, p.created_at DESC
        LIMIT $4`,
      [req.user.household_id, req.user.role, q.year ?? null, q.limit],
    );
    res.json({ payslips: rows.map(serialize) });
  });

  // Deductions report for a year: totals per kind, per label, per source and per month.
  router.get('/summary', async (req, res) => {
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(Number(todayInManila().slice(0, 4))) }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT p.*, t.occurred_on FROM payslips p
         JOIN transactions t ON t.id = p.transaction_id AND t.deleted_at IS NULL
        WHERE p.household_id = $1 AND ${visibleWhere('p', '$2')} AND extract(year FROM t.occurred_on) = $3`,
      [req.user.household_id, req.user.role, year],
    );
    const all = rows.map(serialize);
    const bySource = {};
    for (const p of all) (bySource[p.source_name] ??= []).push(p);
    const byMonth = {};
    for (const p of all) (byMonth[p.occurred_on.slice(0, 7)] ??= []).push(p);
    const pack = (t) => ({ ...t, byLabel: Object.values(t.byLabel).sort((a, b) => b.amount_cents - a.amount_cents) });
    res.json({
      year,
      totals: pack(payslipTotals(all)),
      by_source: Object.entries(bySource).map(([source, ps]) => ({ source, income_type: ps[0].income_type, ...pack(payslipTotals(ps)) })),
      by_month: Object.entries(byMonth).sort().map(([month, ps]) => {
        const t = payslipTotals(ps);
        return { month, gross: t.gross, net: t.net, deductions: t.gross + t.addition - t.net };
      }),
    });
  });

  router.get('/:id', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.*, t.occurred_on, t.account_id FROM payslips p JOIN transactions t ON t.id = p.transaction_id
        WHERE p.id = $1 AND p.household_id = $2 AND ${visibleWhere('p', '$3')}`,
      [parseId(req.params.id), req.user.household_id, req.user.role],
    );
    if (!rows[0]) throw notFound('Payslip not found');
    res.json({ payslip: serialize(rows[0]) });
  });

  // Deleting a payslip removes its income transaction too.
  router.delete('/:id', requireOwner, async (req, res) => {
    const { rows } = await pool.query(
      `SELECT transaction_id FROM payslips WHERE id = $1 AND household_id = $2`,
      [parseId(req.params.id), req.user.household_id],
    );
    if (!rows[0]) throw notFound('Payslip not found');
    await withTransaction(pool, async (db) => {
      await db.query(`UPDATE transactions SET deleted_at = now() WHERE id = $1`, [rows[0].transaction_id]);
      await db.query(`DELETE FROM payslips WHERE id = $1`, [parseId(req.params.id)]);
    });
    res.status(204).end();
  });

  return router;
}

export { isOwner };
