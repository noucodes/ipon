-- 008: income/bills on specific days of the month, e.g. the 13th & 16th or the 15th & 31st.
-- 31 means the last day in shorter months.
ALTER TABLE recurring_items DROP CONSTRAINT recurring_items_frequency_check;
ALTER TABLE recurring_items ADD CONSTRAINT recurring_items_frequency_check
  CHECK (frequency IN ('weekly', 'fortnightly', 'semi_monthly', 'monthly', 'quarterly', 'yearly', 'custom_days'));

ALTER TABLE recurring_items ADD COLUMN days_of_month smallint[];
ALTER TABLE recurring_items ADD CONSTRAINT custom_days_need_days
  CHECK (frequency <> 'custom_days' OR (days_of_month IS NOT NULL AND cardinality(days_of_month) BETWEEN 1 AND 10));
