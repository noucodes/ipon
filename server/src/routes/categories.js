import { Router } from 'express';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { parseId } from '../lib/validators.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOwner } from '../lib/access.js';

const name = z.string().trim().min(1).max(40);
const icon = z.string().trim().max(30).nullable();

export function categoriesRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  router.get('/', async (req, res) => {
    const q = z.object({
      kind: z.enum(['expense', 'income']).optional(),
      include_archived: z.stringbool().default(false),
    }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.kind, c.icon, c.is_system, c.archived,
              (SELECT max(t.created_at) FROM transactions t
                WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS last_used_at
         FROM categories c
        WHERE c.household_id = $1 AND ($2::text IS NULL OR c.kind = $2) AND ($3 OR NOT c.archived)
        ORDER BY c.kind, last_used_at DESC NULLS LAST, c.name`,
      [req.user.household_id, q.kind ?? null, q.include_archived],
    );
    res.json({ categories: rows });
  });

  router.post('/', requireOwner, async (req, res) => {
    const body = z.object({ name, kind: z.enum(['expense', 'income']), icon: icon.optional() }).parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO categories (household_id, name, kind, icon) VALUES ($1, $2, $3, $4)
       RETURNING id, name, kind, icon, is_system, archived`,
      [req.user.household_id, body.name, body.kind, body.icon ?? null],
    );
    res.status(201).json({ category: rows[0] });
  });

  async function load(req) {
    const { rows } = await pool.query(
      `SELECT * FROM categories WHERE id = $1 AND household_id = $2`,
      [parseId(req.params.id), req.user.household_id],
    );
    if (!rows[0]) throw notFound('Category not found');
    return rows[0];
  }

  router.patch('/:id', requireOwner, async (req, res) => {
    const patch = z.object({ name, icon, archived: z.boolean() }).partial().parse(req.body);
    const current = await load(req);
    if (current.is_system && (patch.name !== undefined || patch.archived)) {
      throw badRequest('Built-in categories cannot be renamed or archived', 'system_category');
    }
    const next = { ...current, ...patch };
    const { rows } = await pool.query(
      `UPDATE categories SET name = $1, icon = $2, archived = $3 WHERE id = $4
       RETURNING id, name, kind, icon, is_system, archived`,
      [next.name, next.icon, next.archived, current.id],
    );
    res.json({ category: rows[0] });
  });

  // Archives rather than deletes so past transactions keep their category.
  router.delete('/:id', requireOwner, async (req, res) => {
    const current = await load(req);
    if (current.is_system) throw badRequest('Built-in categories cannot be removed', 'system_category');
    await pool.query(`UPDATE categories SET archived = true WHERE id = $1`, [current.id]);
    res.status(204).end();
  });

  return router;
}
