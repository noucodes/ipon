import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';

export function signToken(user, config) {
  return jwt.sign({ tv: user.token_version }, config.jwtSecret, {
    subject: user.id,
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

export function verifyToken(token, config) {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
}

// No 0/O/1/I/L so codes are easy to read out loud or type on a phone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** e.g. "K7PM-W3QX" */
export function generateInviteCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeInviteCode(input) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}
