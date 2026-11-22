// Who can see / change what.
//
// The household is one person's wallet:
//  - owner   : sees and manages everything.
//  - member  : the owner's partner. Sees every non-private account, can log
//              transactions on them, and edit/delete the ones they logged.
//              Cannot change accounts, recurring items, categories or presets.
// A transfer between a private and a visible account is shown to the partner with
// the private side masked as "Private account", and is read-only for them.

import { badRequest, forbidden, notFound } from './errors.js';

export const isOwner = (user) => user.role === 'owner';

/** SQL predicate: account `alias` is visible to a user whose role is in parameter `roleParam`. */
export const visibleSql = (alias, roleParam) => `(${alias}.is_private = false OR ${roleParam}::text = 'owner')`;

/** Express middleware: only the wallet owner may continue. */
export function requireOwner(req, res, next) {
  if (!isOwner(req.user)) throw forbidden('Only the wallet owner can do that');
  next();
}

/** Load accounts by id that the user can see. Returns Map(id -> row). */
export async function getVisibleAccounts(db, user, ids) {
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT * FROM accounts a WHERE a.household_id = $1 AND a.id = ANY($2::uuid[]) AND ${visibleSql('a', '$3')}`,
    [user.household_id, ids, user.role],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Load a category in the household; throws if missing or wrong kind. */
export async function assertCategory(db, user, categoryId, kind) {
  const { rows } = await db.query(`SELECT id, kind FROM categories WHERE id = $1 AND household_id = $2`, [categoryId, user.household_id]);
  if (!rows[0]) throw notFound('Category not found');
  if (kind && rows[0].kind !== kind) throw badRequest(`That is not an ${kind} category`, 'category_kind_mismatch');
  return rows[0];
}
