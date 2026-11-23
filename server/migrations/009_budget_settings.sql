-- 009: budget settings for the wallet.
-- daily_budget_cents: a fixed amount to spend per day. NULL = work it out automatically
--   (money on hand minus bills before payday, spread over the days until payday).
-- save_rate_pct: share of what's left after bills that the payroll plan suggests saving.
ALTER TABLE households ADD COLUMN daily_budget_cents bigint CHECK (daily_budget_cents > 0);
ALTER TABLE households ADD COLUMN save_rate_pct smallint NOT NULL DEFAULT 20 CHECK (save_rate_pct BETWEEN 0 AND 100);
