import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg, code = 'bad_request') => new AppError(400, msg, code);
export const unauthorized = (msg = 'Please sign in', code = 'unauthorized') => new AppError(401, msg, code);
export const forbidden = (msg = 'Not allowed', code = 'forbidden') => new AppError(403, msg, code);
export const notFound = (msg = 'Not found', code = 'not_found') => new AppError(404, msg, code);
export const conflict = (msg, code = 'conflict') => new AppError(409, msg, code);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Some fields are invalid',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_json', message: 'Request body is not valid JSON' });
  }
  // Postgres constraint errors
  if (err.code === '23505') return res.status(409).json({ error: 'duplicate', message: 'That already exists' });
  if (err.code === '23503') return res.status(400).json({ error: 'invalid_reference', message: 'Referenced item does not exist' });
  if (err.code === '23514') return res.status(400).json({ error: 'constraint_failed', message: 'Values are not allowed' });

  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong' });
}
