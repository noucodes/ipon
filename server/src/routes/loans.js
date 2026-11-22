// Loan / buy-now-pay-later helper (BillEase, SPayLater, GGives, Atome, Home Credit…).
// One request sets everything up atomically:
//   1. a debt account for the loan (type credit_card) with installment details
//   2. the purchase (expense from the loan) or the cash-out (transfer loan -> your account)
//   3. the interest & fees (expense from the loan) = total payable - principal
//   4. a monthly reminder (recurring bill) linked to the loan
// Each monthly payment is then a normal transfer: GCash -> loan account.
import { Router } from 'express';
import { z } from 'zod';
import { todayInManila } from '@ft/shared';
import { withTransaction } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { id, positiveCents, dateStr } from '../lib/validators.js';
import { requireOwner } from '../lib/access.js';
import { createTransaction } from '../lib/transactions.js';
import { requireAuth } from '../middleware/auth.js';

const loanSchema = z.object({
  lender: z.string().trim().min(1).max(40),
  label: z.string().trim().max(40).optional(), // e.g. "Phone" -> account "BillEase · Phone"
  // purchase / cash = a new loan; existing = one you're already paying (no purchase recorded)
  kind: z.enum(['purchase', 'cash', 'existing']),
  principal_cents: positiveCents.optional(), // item price, or cash you received (new loans)
  total_payable_cents: positiveCents.optional(), // everything you'll pay back (new loans)
  remaining_cents: positiveCents.optional(), // existing loans: what you still owe today
  months: z.number().int().min(1).max(120), // new: number of payments; existing: payments left
  installment_cents: positiveCents.optional(), // defaults to total / months
  first_due_date: dateStr,
  occurred_on: dateStr.optional(),
  category_id: id.nullable().optional(), // purchase category (e.g. Shopping)
  to_account_id: id.optional(), // cash loans: where the money went
  is_private: z.boolean().default(false),
});

async function loadLoan(pool, accountId) {
  const { rows } = await pool.query(
    `SELECT a.*, b.balance_cents FROM accounts a JOIN account_balances b ON b.account_id = a.id WHERE a.id = $1`,
    [accountId],
  );
  return { ...rows[0], can_edit: true };
}

export function loansRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth({ pool, config }));

  router.post('/', requireOwner, async (req, res) => {
    const b = loanSchema.parse(req.body);
    const name = b.label ? `${b.lender} · ${b.label}` : b.lender;
    const user = req.user;

    // An existing loan: start the account at what you owe now. Nothing is recorded as
    // this month's spending, since the money was spent before you started tracking.
    if (b.kind === 'existing') {
      if (!b.remaining_cents) throw badRequest('Enter how much you still owe', 'remaining_required');
      const installment = b.installment_cents ?? Math.ceil(b.remaining_cents / b.months);
      const accountId = await withTransaction(pool, async (db) => {
        const { rows: [acct] } = await db.query(
          `INSERT INTO accounts (household_id, name, type, opening_balance_cents, is_private,
                                 loan_total_cents, loan_installment_cents, loan_months, loan_first_due)
           VALUES ($1, $2, 'credit_card', $3, $4, $5, $6, $7, $8) RETURNING id`,
          [user.household_id, name, -b.remaining_cents, b.is_private, b.remaining_cents, installment, b.months, b.first_due_date],
        );
        await db.query(
          `INSERT INTO recurring_items (household_id, kind, name, amount_cents, frequency, next_date, loan_account_id)
           VALUES ($1, 'expense', $2, $3, 'monthly', $4, $5)`,
          [user.household_id, `${name} payment`, installment, b.first_due_date, acct.id],
        );
        return acct.id;
      });
      return res.status(201).json({ account: await loadLoan(pool, accountId) });
    }

    if (!b.principal_cents || !b.total_payable_cents) throw badRequest('Enter the amount and the total to pay back', 'amounts_required');
    if (b.total_payable_cents < b.principal_cents) {
      throw badRequest('Total to pay back is less than the amount borrowed', 'total_too_small');
    }
    if (b.kind === 'cash' && !b.to_account_id) throw badRequest('Choose where the cash went', 'to_account_required');
    const installment = b.installment_cents ?? Math.ceil(b.total_payable_cents / b.months);
    const occurredOn = b.occurred_on ?? todayInManila();

    const accountId = await withTransaction(pool, async (db) => {
      const { rows: [acct] } = await db.query(
        `INSERT INTO accounts (household_id, name, type, opening_balance_cents, is_private,
                               loan_total_cents, loan_installment_cents, loan_months, loan_first_due)
         VALUES ($1, $2, 'credit_card', 0, $3, $4, $5, $6, $7) RETURNING id`,
        [user.household_id, name, b.is_private, b.total_payable_cents, installment, b.months, b.first_due_date],
      );

      // 2. the purchase or the cash you received
      if (b.kind === 'purchase') {
        await createTransaction(db, user, {
          type: 'expense', amount_cents: b.principal_cents, account_id: acct.id,
          category_id: b.category_id ?? null, occurred_on: occurredOn,
          note: b.label ? `${b.label} (${b.lender} installment)` : `${b.lender} purchase`,
        });
      } else {
        await createTransaction(db, user, {
          type: 'transfer', amount_cents: b.principal_cents, account_id: acct.id, to_account_id: b.to_account_id,
          fee_cents: 0, fee_paid_by: 'sender', occurred_on: occurredOn, note: `${b.lender} cash loan`,
        });
      }

      // 3. interest & fees
      const interest = b.total_payable_cents - b.principal_cents;
      if (interest > 0) {
        const { rows: [cat] } = await db.query(
          `SELECT id FROM categories WHERE household_id = $1 AND kind = 'expense' AND lower(name) = 'interest & fees'`,
          [user.household_id],
        );
        await createTransaction(db, user, {
          type: 'expense', amount_cents: interest, account_id: acct.id, category_id: cat?.id ?? null,
          occurred_on: occurredOn, note: `${b.lender} interest & fees`,
        });
      }

      // 4. monthly reminder linked to the loan
      await db.query(
        `INSERT INTO recurring_items (household_id, kind, name, amount_cents, frequency, next_date, loan_account_id)
         VALUES ($1, 'expense', $2, $3, 'monthly', $4, $5)`,
        [user.household_id, `${name} payment`, installment, b.first_due_date, acct.id],
      );
      return acct.id;
    });

    res.status(201).json({ account: await loadLoan(pool, accountId) });
  });

  return router;
}
