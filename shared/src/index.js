// Shared constants and money helpers used by server, web and mobile.
// All money is stored and passed around as integer centavos (1 PHP = 100 centavos).

export const CURRENCY = 'PHP';

export const ACCOUNT_TYPES = ['bank', 'digital_bank', 'cash', 'credit_card', 'savings'];
export const TRANSACTION_TYPES = ['expense', 'income', 'transfer'];
export const FEE_PAID_BY = ['sender', 'receiver'];
export const FREQUENCIES = ['weekly', 'fortnightly', 'semi_monthly', 'monthly', 'quarterly', 'yearly'];
export const RECURRING_KINDS = ['income', 'expense'];

/** How many times per year each frequency occurs. */
const PER_YEAR = {
  weekly: 52,
  fortnightly: 26,
  semi_monthly: 24,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/** Convert a recurring amount to its monthly equivalent (rounded to centavos). */
export function monthlyEquivalentCents(amountCents, frequency) {
  const n = PER_YEAR[frequency];
  if (!n) throw new Error(`Unknown frequency: ${frequency}`);
  return Math.round((amountCents * n) / 12);
}

/** Parse a peso amount ("1,234.50", 1234.5) into integer centavos. Returns null if invalid. */
export function toCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[₱,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const [whole, frac = ''] = cleaned.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}

export const TIME_ZONE = 'Asia/Manila';

/** Today's date in the Philippines as 'YYYY-MM-DD'. */
export function todayInManila(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date);
}

/** Add days to a 'YYYY-MM-DD' date string. */
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** First day of the month after 'YYYY-MM', as 'YYYY-MM-DD'. */
export function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

const formatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
});

/** Format centavos as "₱12,345.67". */
export function formatPHP(cents) {
  return formatter.format(cents / 100);
}

/**
 * Work out how a transaction changes account balances.
 * Returns a map of accountId -> delta in centavos.
 *
 * Transfer fee rules:
 *   fee_paid_by = 'sender'   -> source loses amount + fee, destination gains amount
 *   fee_paid_by = 'receiver' -> source loses amount, destination gains amount - fee
 */
export function balanceEffects(tx) {
  const fee = tx.fee_cents || 0;
  switch (tx.type) {
    case 'income':
      return { [tx.account_id]: tx.amount_cents };
    case 'expense':
      return { [tx.account_id]: -tx.amount_cents };
    case 'transfer': {
      const senderPays = (tx.fee_paid_by || 'sender') === 'sender';
      return {
        [tx.account_id]: -(tx.amount_cents + (senderPays ? fee : 0)),
        [tx.to_account_id]: tx.amount_cents - (senderPays ? 0 : fee),
      };
    }
    default:
      throw new Error(`Unknown transaction type: ${tx.type}`);
  }
}

export const DEFAULT_CATEGORIES = [
  { name: 'Food & Groceries', kind: 'expense', icon: 'cart' },
  { name: 'Dining Out', kind: 'expense', icon: 'utensils' },
  { name: 'Transport', kind: 'expense', icon: 'car' },
  { name: 'Bills & Utilities', kind: 'expense', icon: 'bolt' },
  { name: 'Rent', kind: 'expense', icon: 'home' },
  { name: 'Load & Internet', kind: 'expense', icon: 'wifi' },
  { name: 'Shopping', kind: 'expense', icon: 'bag' },
  { name: 'Health', kind: 'expense', icon: 'heart' },
  { name: 'Subscriptions', kind: 'expense', icon: 'repeat' },
  { name: 'Transfer fees', kind: 'expense', icon: 'swap', system: true },
  { name: 'Other', kind: 'expense', icon: 'dots' },
  { name: 'Salary', kind: 'income', icon: 'briefcase' },
  { name: 'Freelance', kind: 'income', icon: 'laptop' },
  { name: 'Gifts', kind: 'income', icon: 'gift' },
  { name: 'Other income', kind: 'income', icon: 'dots' },
];

export const DEFAULT_FEE_PRESETS = [
  { name: 'InstaPay', fee_cents: 1500, fee_paid_by: 'sender' },
  { name: 'PESONet', fee_cents: 0, fee_paid_by: 'sender' },
];

export { parseMoneyNotification, detectSource, KNOWN_SOURCES } from './detect.js';
export { occurrences } from './schedule.js';
