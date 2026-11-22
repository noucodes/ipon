// End-to-end tests for step 1 against an in-memory Postgres (PGlite), no Neon needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../scripts/migrate.js';
import { startTestServer } from './helpers.js';

let ctx, api, pool;

before(async () => {
  ctx = await startTestServer(54329);
  ({ api, pool } = ctx);
  await migrate(ctx.url, { log: () => {} }); // a second run must be a no-op
});

after(() => ctx?.stop());

let ownerToken, partnerToken, inviteCode;

test('health check', async () => {
  const r = await api('GET', '/health');
  assert.equal(r.status, 200);
});

test('owner registers and gets a new household with seeded data', async () => {
  const r = await api('POST', '/auth/register', {
    body: { email: 'Owner@Example.com', password: 'supersecret1', display_name: 'Elton' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.role, 'owner');
  assert.equal(r.body.user.email, 'owner@example.com');
  ownerToken = r.body.token;

  const cats = await pool.query(`SELECT name, is_system FROM categories WHERE household_id = $1`, [r.body.user.household_id]);
  assert.ok(cats.rows.some((c) => c.name === 'Transfer fees' && c.is_system));
  const presets = await pool.query(`SELECT name, fee_cents FROM transfer_fee_presets WHERE household_id = $1`, [r.body.user.household_id]);
  assert.ok(presets.rows.some((p) => p.name === 'InstaPay' && p.fee_cents === 1500));
});

test('duplicate email is rejected (case-insensitive)', async () => {
  const r = await api('POST', '/auth/register', {
    body: { email: 'owner@example.com', password: 'supersecret1', display_name: 'X' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'email_taken');
});

test('validation errors are reported', async () => {
  const r = await api('POST', '/auth/register', { body: { email: 'nope', password: 'short', display_name: '' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'validation_error');
});

test('login works and wrong password fails', async () => {
  const ok = await api('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'supersecret1' } });
  assert.equal(ok.status, 200);
  const bad = await api('POST', '/auth/login', { body: { email: 'owner@example.com', password: 'wrong-password' } });
  assert.equal(bad.status, 401);
  const missing = await api('POST', '/auth/login', { body: { email: 'ghost@example.com', password: 'whatever1' } });
  assert.equal(missing.status, 401);
});

test('protected routes need a token', async () => {
  assert.equal((await api('GET', '/auth/me')).status, 401);
  assert.equal((await api('GET', '/auth/me', { token: 'garbage' })).status, 401);
  const me = await api('GET', '/auth/me', { token: ownerToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.display_name, 'Elton');
});

test('owner creates an invite and partner joins with it', async () => {
  const inv = await api('POST', '/household/invites', { token: ownerToken });
  assert.equal(inv.status, 201);
  assert.match(inv.body.invite.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  inviteCode = inv.body.invite.code;

  // lower-case, no dash should still work
  const r = await api('POST', '/auth/register', {
    body: { email: 'partner@example.com', password: 'partnerpass1', display_name: 'Partner', invite_code: inviteCode.replace('-', '').toLowerCase() },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.role, 'member');
  partnerToken = r.body.token;

  const hh = await api('GET', '/household', { token: partnerToken });
  assert.equal(hh.status, 200);
  assert.equal(hh.body.members.length, 2);
});

test('an invite cannot be used twice', async () => {
  const r = await api('POST', '/auth/register', {
    body: { email: 'third@example.com', password: 'thirdpass12', display_name: 'Third', invite_code: inviteCode },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invite_invalid');
});

test('partner (member) cannot create invites', async () => {
  const r = await api('POST', '/household/invites', { token: partnerToken });
  assert.equal(r.status, 403);
});

test('logout-all invalidates existing tokens', async () => {
  const login = await api('POST', '/auth/login', { body: { email: 'partner@example.com', password: 'partnerpass1' } });
  const t = login.body.token;
  assert.equal((await api('POST', '/auth/logout-all', { token: t })).status, 204);
  assert.equal((await api('GET', '/auth/me', { token: t })).status, 401);
});

test('database rules: balances and transfer fees', async () => {
  const { rows: [u] } = await pool.query(`SELECT id, household_id FROM users WHERE email = 'owner@example.com'`);
  const acct = async (name, type, opening, extra = {}) =>
    (await pool.query(
      `INSERT INTO accounts (household_id, name, type, opening_balance_cents, is_private)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [u.household_id, name, type, opening, extra.is_private ?? false],
    )).rows[0].id;
  const bdo = await acct('BDO', 'bank', 1000000);
  const gcash = await acct('GCash', 'digital_bank', 0);

  const tx = (type, amount, from, to, fee, by) =>
    pool.query(
      `INSERT INTO transactions (household_id, client_id, type, amount_cents, account_id, to_account_id, fee_cents, fee_paid_by, created_by)
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8)`,
      [u.household_id, type, amount, from, to, fee, by, u.id],
    );
  await tx('transfer', 100000, bdo, gcash, 1500, 'sender');   // BDO -1015, GCash +1000
  await tx('transfer', 50000, bdo, gcash, 1000, 'receiver');  // BDO -500, GCash +490
  await tx('expense', 20000, gcash, null, 0, null);           // GCash -200

  const bal = async (id) => (await pool.query(`SELECT balance_cents FROM account_balances WHERE account_id = $1`, [id])).rows[0].balance_cents;
  assert.equal(await bal(bdo), 1000000 - 101500 - 50000);
  assert.equal(await bal(gcash), 100000 + 49000 - 20000);

  // a transfer to the same account is rejected
  await assert.rejects(tx('transfer', 100, bdo, bdo, 0, 'sender'), /transfer_shape/);
  // an expense can't carry a fee
  await assert.rejects(tx('expense', 100, bdo, null, 50, null), /transfer_shape/);
});
