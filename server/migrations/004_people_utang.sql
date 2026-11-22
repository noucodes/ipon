-- 004: People (utang). A person is an account of type 'person':
--   positive balance = they owe you, negative = you owe them.
--   Lend      = transfer  Wallet/Card -> Person
--   Repayment = transfer  Person -> Wallet/GCash
--   Borrow    = transfer  Person -> Wallet      (balance goes negative)
--   Write off = expense on the person account (category "Written off")
-- Their balance counts toward net worth like any other account.

ALTER TABLE accounts DROP CONSTRAINT accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('bank', 'digital_bank', 'cash', 'credit_card', 'savings', 'person'));

ALTER TABLE accounts ADD COLUMN due_date date;   -- optional "pay back by" date for people
ALTER TABLE accounts ADD COLUMN note text;

-- Built-in category for forgiven / unpaid loans, for existing wallets.
INSERT INTO categories (household_id, name, kind, icon, is_system)
SELECT h.id, 'Written off', 'expense', 'close-circle', true
  FROM households h
 WHERE NOT EXISTS (
   SELECT 1 FROM categories c WHERE c.household_id = h.id AND c.kind = 'expense' AND lower(c.name) = 'written off'
 );
