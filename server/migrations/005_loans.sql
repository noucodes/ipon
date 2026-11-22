-- 005: Loans / buy-now-pay-later (BillEase, SPayLater, GGives, Atome, Home Credit...).
-- A loan is a debt account (type 'credit_card') with installment details, so the app
-- can show "3 of 6 paid". Its monthly reminder is a recurring item linked to it, which
-- stops counting once the loan is paid off.

ALTER TABLE accounts ADD COLUMN loan_total_cents bigint CHECK (loan_total_cents > 0);
ALTER TABLE accounts ADD COLUMN loan_installment_cents bigint CHECK (loan_installment_cents > 0);
ALTER TABLE accounts ADD COLUMN loan_months integer CHECK (loan_months BETWEEN 1 AND 120);
ALTER TABLE accounts ADD COLUMN loan_first_due date;

ALTER TABLE recurring_items ADD COLUMN loan_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

-- Built-in category for loan interest and fees, for existing wallets.
INSERT INTO categories (household_id, name, kind, icon, is_system)
SELECT h.id, 'Interest & fees', 'expense', 'trending-up', true
  FROM households h
 WHERE NOT EXISTS (
   SELECT 1 FROM categories c WHERE c.household_id = h.id AND c.kind = 'expense' AND lower(c.name) = 'interest & fees'
 );
