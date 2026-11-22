import pg from 'pg';

// Return BIGINT (int8) columns as JS numbers. Centavo values stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// Return DATE columns as 'YYYY-MM-DD' strings instead of shifting them through local time.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

/**
 * Neon URLs use sslmode=require, which node-postgres currently treats as verify-full
 * but warns will change. Pin verify-full (full certificate check) explicitly.
 */
export function normalizeSsl(connectionString) {
  return connectionString.replace(/([?&])sslmode=(require|prefer|verify-ca)(?=&|$)/, '$1sslmode=verify-full');
}

export function createPool(connectionString, { max = 10 } = {}) {
  const pool = new pg.Pool({
    connectionString: normalizeSsl(connectionString),
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  return pool;
}

/** Run fn(client) inside a transaction; rolls back on error. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
