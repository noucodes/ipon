import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler, notFound } from './lib/errors.js';
import { authRouter } from './routes/auth.js';
import { householdRouter } from './routes/household.js';
import { accountsRouter } from './routes/accounts.js';
import { transactionsRouter } from './routes/transactions.js';
import { categoriesRouter } from './routes/categories.js';
import { feePresetsRouter } from './routes/feePresets.js';
import { recurringRouter } from './routes/recurring.js';
import { summaryRouter } from './routes/summary.js';
import { loansRouter } from './routes/loans.js';
import { payslipsRouter } from './routes/payslips.js';

export function createApp({ pool, config }) {
  const app = express();

  app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct client IPs in rate limiting
  app.use(helmet());
  app.use(
    cors({
      // The phone app sends no Origin header, so it is always allowed; browsers must be listed.
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/auth', authRouter({ pool, config }));
  app.use('/household', householdRouter({ pool, config }));
  app.use('/accounts', accountsRouter({ pool, config }));
  app.use('/transactions', transactionsRouter({ pool, config }));
  app.use('/categories', categoriesRouter({ pool, config }));
  app.use('/fee-presets', feePresetsRouter({ pool, config }));
  app.use('/recurring', recurringRouter({ pool, config }));
  app.use('/summary', summaryRouter({ pool, config }));
  app.use('/loans', loansRouter({ pool, config }));
  app.use('/payslips', payslipsRouter({ pool, config }));

  app.use((req, res, next) => next(notFound('Route not found')));
  app.use(errorHandler);
  return app;
}
