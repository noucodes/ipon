import { unauthorized, forbidden } from '../lib/errors.js';
import { verifyToken } from '../lib/tokens.js';

/**
 * Requires a valid "Authorization: Bearer <token>" header.
 * Sets req.user = { id, household_id, role, email, display_name }.
 */
export function requireAuth({ pool, config }) {
  return async (req, res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let payload;
    try {
      payload = verifyToken(token, config);
    } catch {
      throw unauthorized('Your session has expired, please sign in again', 'token_invalid');
    }

    const { rows } = await pool.query(
      `SELECT id, household_id, role, email, display_name, token_version, onboarded_at FROM users WHERE id = $1`,
      [payload.sub],
    );
    const user = rows[0];
    if (!user || user.token_version !== payload.tv) {
      throw unauthorized('Your session has expired, please sign in again', 'token_invalid');
    }
    req.user = user;
    next();
  };
}

export function requireOwner(req, res, next) {
  if (req.user?.role !== 'owner') throw forbidden('Only the household owner can do that');
  next();
}
