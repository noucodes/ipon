import { formatPHP, todayInManila, addDays } from '@ft/shared';

export { formatPHP };

export const ACCOUNT_TYPE_LABELS = {
  bank: 'Bank',
  digital_bank: 'Digital bank / e-wallet',
  cash: 'Cash on hand',
  credit_card: 'Credit card',
  savings: 'Savings / investment',
};

export const ACCOUNT_TYPE_ICONS = {
  bank: 'business-outline',
  digital_bank: 'phone-portrait-outline',
  cash: 'cash-outline',
  credit_card: 'card-outline',
  savings: 'trending-up-outline',
};

export const FREQUENCY_LABELS = {
  weekly: 'Weekly',
  fortnightly: 'Every 2 weeks',
  semi_monthly: 'Twice a month (kinsenas)',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/** Peso string for an input field: 150000 -> "1500", 1550 -> "15.50" */
export function centsToInput(cents) {
  if (cents == null) return '';
  const abs = Math.abs(cents);
  return abs % 100 === 0 ? String(abs / 100) : (abs / 100).toFixed(2);
}

/** "Today", "Yesterday", or "Mon, 18 Nov" */
export function friendlyDate(dateStr) {
  const today = todayInManila();
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, -1)) return 'Yesterday';
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
