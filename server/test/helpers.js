// Spins up an in-memory Postgres (PGlite) + the API for a test file.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { migrate } from '../scripts/migrate.js';
import { createPool } from '../src/db.js';
import { createApp } from '../src/app.js';

export async function startTestServer(dbPort) {
  const url = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`;
  const db = await PGlite.create();
  const socketServer = new PGLiteSocketServer({ db, port: dbPort });
  await socketServer.start();
  await migrate(url, { log: () => {} });

  const pool = createPool(url, { max: 1 }); // PGlite serves one connection at a time
  const config = { jwtSecret: 'test-secret', jwtExpiresIn: '1h', corsOrigins: [], inviteTtlDays: 7 };
  const server = createApp({ pool, config }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, path, { body, token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function stop() {
    server.close();
    await pool.end();
    await socketServer.stop();
    await db.close();
  }

  return { api, pool, url, stop };
}
