import { occurrences, addDays } from '@ft/shared';

export const LENDER_CHOICES = ['BillEase', 'SPayLater', 'GGives', 'GLoan', 'MariBank Credit', 'Atome', 'Home Credit'];

/**
 * Progress of a loan account (credit_card with loan_* fields):
 * { owed, paid, paidCount, months, remainingPayments, nextDue, done, pct } or null.
 */
export function loanProgress(a) {
  if (!a?.loan_months || !a.loan_total_cents || !a.loan_installment_cents) return null;
  const owed = Math.max(0, -a.balance_cents);
  const paid = Math.max(0, a.loan_total_cents - owed);
  const paidCount = Math.min(a.loan_months, Math.floor(paid / a.loan_installment_cents + 1e-9));
  const done = owed === 0;
  let nextDue = null;
  if (!done && a.loan_first_due) {
    const dates = occurrences(a.loan_first_due, 'monthly', a.loan_first_due, addDays(a.loan_first_due, (a.loan_months + 1) * 31));
    nextDue = dates[paidCount] ?? dates.at(-1) ?? null;
  }
  return {
    owed,
    paid,
    paidCount,
    months: a.loan_months,
    remainingPayments: done ? 0 : Math.max(1, Math.ceil(owed / a.loan_installment_cents)),
    nextDue,
    done,
    pct: Math.min(1, paid / a.loan_total_cents),
  };
}
