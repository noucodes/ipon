-- 002: one row per money movement per account. Balances, monthly reports and
-- net-worth history all read from this so they always agree.
--   kind = income | expense | transfer_out | transfer_in | fee
-- Transfer fees get their own 'fee' row on whichever account paid them.

DROP VIEW account_balances;

CREATE VIEW transaction_effects AS
SELECT t.id AS transaction_id, t.household_id, t.account_id, t.occurred_on, t.category_id,
       CASE t.type WHEN 'income' THEN 'income' WHEN 'expense' THEN 'expense' ELSE 'transfer_out' END AS kind,
       CASE t.type WHEN 'income' THEN t.amount_cents ELSE -t.amount_cents END AS delta
  FROM transactions t
 WHERE t.deleted_at IS NULL
UNION ALL
SELECT t.id, t.household_id, t.to_account_id, t.occurred_on, NULL, 'transfer_in', t.amount_cents
  FROM transactions t
 WHERE t.deleted_at IS NULL AND t.type = 'transfer'
UNION ALL
SELECT t.id, t.household_id,
       CASE WHEN t.fee_paid_by = 'receiver' THEN t.to_account_id ELSE t.account_id END,
       t.occurred_on, NULL, 'fee', -t.fee_cents
  FROM transactions t
 WHERE t.deleted_at IS NULL AND t.type = 'transfer' AND t.fee_cents > 0;

CREATE VIEW account_balances AS
SELECT a.id AS account_id,
       (a.opening_balance_cents + COALESCE(SUM(e.delta), 0))::bigint AS balance_cents
  FROM accounts a
  LEFT JOIN transaction_effects e ON e.account_id = a.id
 GROUP BY a.id, a.opening_balance_cents;
