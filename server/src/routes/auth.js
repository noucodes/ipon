import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { withTransaction } from '../db.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { signToken, normalizeInviteCode } from '../lib/tokens.js';
import { seedHousehold } from '../lib/seed.js';
import { requireAuth } from '../middleware/auth.js';

const BCRYPT_ROUNDS = 12;
// Used when the email doesn't exist so login takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')).pipe(z.string().max(254));
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

const registerSchema = z.object({
  email,
  password,
  display_name: z.string().trim().min(1).max(60),
  household_name: z.string().trim().min(1).max(80).optional(),
  invite_code: z.string().trim().min(1).max(20).optional(),
});

const loginSchema = z.object({ email, password: z.string().min(1).max(128) });

function publicUser(u) {
  return {
    id: u.id, email: u.email, display_name: u.display_name, role: u.role, household_id: u.household_id,
    onboarded: Boolean(u.onboarded_at), // finished or skipped the setup guide
  };
}

export function authRouter({ pool, config }) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Too many attempts, try again in a few minutes' },
  });

  // Create an account. Without an invite code a new household is created;
  // with one, the user joins the inviter's household.
  router.post('/register', limiter, async (req, res) => {
    const body = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

    const user = await withTransaction(pool, async (client) => {
      const existing = await client.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [body.email]);
      if (existing.rowCount) throw badRequest('An account with that email already exists', 'email_taken');

      let householdId;
      let role;
      let inviteId = null;

      if (body.invite_code) {
        const { rows } = await client.query(
          `SELECT id, household_id FROM household_invites
            WHERE code = $1 AND used_at IS NULL AND expires_at > now()
            FOR UPDATE`,
          [normalizeInviteCode(body.invite_code)],
        );
        if (!rows[0]) throw badRequest('That invite code is invalid or has expired', 'invite_invalid');
        householdId = rows[0].household_id;
        inviteId = rows[0].id;
        role = 'member';
      } else {
        const { rows } = await client.query(
          `INSERT INTO households (name) VALUES ($1) RETURNING id`,
          [body.household_name || `${body.display_name}'s wallet`],
        );
        householdId = rows[0].id;
        role = 'owner';
        await seedHousehold(client, householdId);
      }

      const { rows } = await client.query(
        `INSERT INTO users (household_id, email, password_hash, display_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, household_id, email, display_name, role, token_version, onboarded_at`,
        [householdId, body.email, passwordHash, body.display_name, role],
      );

      if (inviteId) {
        await client.query(`UPDATE household_invites SET used_by = $1, used_at = now() WHERE id = $2`, [rows[0].id, inviteId]);
      }
      return rows[0];
    });

    res.status(201).json({ token: signToken(user, config), user: publicUser(user) });
  });

  router.post('/login', limiter, async (req, res) => {
    const body = loginSchema.parse(req.body);
    const { rows } = await pool.query(
      `SELECT id, household_id, email, display_name, role, token_version, onboarded_at, password_hash
         FROM users WHERE lower(email) = $1`,
      [body.email],
    );
    const user = rows[0];
    const ok = await bcrypt.compare(body.password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Email or password is incorrect', 'bad_credentials');

    res.json({ token: signToken(user, config), user: publicUser(user) });
  });

  const auth = requireAuth({ pool, config });

  router.get('/me', auth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  // Setup guide finished or skipped: don't show it again (on any device).
  router.post('/onboarded', auth, async (req, res) => {
    const { done } = z.object({ done: z.boolean().default(true) }).parse(req.body ?? {});
    const { rows } = await pool.query(
      `UPDATE users SET onboarded_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1
       RETURNING id, household_id, email, display_name, role, onboarded_at`,
      [req.user.id, done],
    );
    res.json({ user: publicUser(rows[0]) });
  });

  // Signs out every device (e.g. a lost phone) by invalidating all existing tokens.
  router.post('/logout-all', auth, async (req, res) => {
    await pool.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [req.user.id]);
    res.status(204).end();
  });

  return router;
}
