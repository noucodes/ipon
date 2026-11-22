-- 006: Payslips. A pay entry (salary, part-time, project) is an income transaction for the
-- NET amount, plus a breakdown: gross, additions (overtime…) and deductions (SSS, PhilHealth,
-- Pag-IBIG, tax, lates, platform fees…). Breakdowns are private to the owner by default.

CREATE TABLE payslips (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  transaction_id     uuid NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  recurring_item_id  uuid REFERENCES recurring_items(id) ON DELETE SET NULL, -- e.g. "Salary"
  income_type        text NOT NULL CHECK (income_type IN ('salary', 'part_time', 'project')),
  source_name        text NOT NULL,          -- "Main job", "Café part-time", "Client: ABC"
  cutoff             smallint CHECK (cutoff IN (1, 2)), -- 1 = 1st–15th, 2 = 16th–end
  gross_cents        bigint NOT NULL CHECK (gross_cents >= 0),
  -- [{ "label": "SSS", "kind": "contribution", "amount_cents": 67500 }, ...]
  -- kind: addition | contribution | tax | lost_pay | fee | other
  lines              jsonb NOT NULL DEFAULT '[]'::jsonb,
  net_cents          bigint NOT NULL CHECK (net_cents > 0),
  hours              numeric(8, 2),          -- part-time helper (optional)
  rate_cents         bigint,                 -- per hour (optional)
  is_private         boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payslips_household_idx ON payslips (household_id);
CREATE INDEX payslips_recurring_idx ON payslips (recurring_item_id);

-- Built-in income category for part-time jobs, for existing wallets.
INSERT INTO categories (household_id, name, kind, icon)
SELECT h.id, 'Part-time', 'income', 'time'
  FROM households h
 WHERE NOT EXISTS (
   SELECT 1 FROM categories c WHERE c.household_id = h.id AND c.kind = 'income' AND lower(c.name) = 'part-time'
 );
