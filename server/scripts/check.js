// "Build" for a plain-JS server: load every module so syntax/import errors fail fast.
import { createApp } from '../src/app.js';
import '../scripts/migrate.js';

const fakePool = { query: async () => ({ rows: [] }) };
createApp({ pool: fakePool, config: { jwtSecret: 'x', jwtExpiresIn: '1h', corsOrigins: [], inviteTtlDays: 7 } });
console.log('Server build check passed: all modules load.');
