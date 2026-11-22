import { z } from 'zod';

const MAX_CENTS = 10_000_000_000_000; // ₱100 billion, well inside JS safe integers

export const id = z.uuid();
export const positiveCents = z.number().int().positive().max(MAX_CENTS);
export const nonNegativeCents = z.number().int().min(0).max(MAX_CENTS);
export const signedCents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);
export const dateStr = z.iso.date();
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');


/** Parse a :id route param */
export const parseId = (value) => id.parse(value);
