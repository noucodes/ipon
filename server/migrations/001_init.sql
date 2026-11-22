-- 001_init: households, users, invites, accounts, categories, transactions,
-- transfer fee presets, recurring income/expenses, and a balance view.
-- Money is always BIGINT centavos.

CREATE TABLE households (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email          text NOT NULL,
  password_hash  text NOT NULL,
  display_name   text NOT NULL,
  role           text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  token_version  integer NOT NULL DEFAULT 0,  -- bump to log out all devices
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_household_idx ON users (household_id);

CREATE TABLE household_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  code          text NOT NULL UNIQUE,
  created_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  used_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id           uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id          uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL = shared
  name                   text NOT NULL,
  type                   text NOT NULL CHECK (type IN ('bank', 'digital_bank', 'cash', 'credit_card', 'savings')),
  opening_balance_cents  bigint NOT NULL DEFAULT 0,
  is_private             boolean NOT NULL DEFAULT false,
  archived               boolean NOT NULL DEFAULT false,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- a private account must belong to someone
  CONSTRAINT private_needs_owner CHECK (NOT is_private OR owner_user_id IS NOT NULL)
);
CREATE INDEX accounts_household_idx ON accounts (household_id);

CREATE TABLE categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('expense', 'income')),
  icon          text,
  is_system     boolean NOT NULL DEFAULT false,  -- e.g. "Transfer fees", cannot be deleted
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_unique_name ON categories (household_id, kind, lower(name));

CREATE TABLE transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL,  -- generated on the phone; makes offline sync idempotent
  type           text NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id  uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  fee_cents      bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  fee_paid_by    text CHECK (fee_paid_by IN ('sender', 'receiver')),
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  occurred_on    date NOT NULL DEFAULT CURRENT_DATE,
  note           text,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT transfer_shape CHECK (
    (type = 'transfer' AND to_account_id IS NOT NULL AND to_account_id <> account_id AND fee_paid_by IS NOT NULL)
    OR
    (type <> 'transfer' AND to_account_id IS NULL AND fee_cents = 0 AND fee_paid_by IS NULL)
  ),
  -- a receiver-paid fee can't exceed what arrives
  CONSTRAINT receiver_fee_le_amount CHECK (fee_paid_by IS DISTINCT FROM 'receiver' OR fee_cents <= amount_cents)
);
CREATE UNIQUE INDEX transactions_client_id_unique ON transactions (household_id, client_id);
CREATE INDEX transactions_household_date_idx ON transactions (household_id, occurred_on DESC);
CREATE INDEX transactions_account_idx ON transactions (account_id);
CREATE INDEX transactions_to_account_idx ON transactions (to_account_id);

-- Named presets (InstaPay ₱15) have a name and no route.
-- Remembered route fees (BDO -> GCash) have from/to and no name.
CREATE TABLE transfer_fee_presets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name             text,
  from_account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  to_account_id    uuid REFERENCES accounts(id) ON DELETE CASCADE,
  fee_cents        bigint NOT NULL CHECK (fee_cents >= 0),
  fee_paid_by      text NOT NULL DEFAULT 'sender' CHECK (fee_paid_by IN ('sender', 'receiver')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preset_is_named_or_route CHECK (
    (name IS NOT NULL AND from_account_id IS NULL AND to_account_id IS NULL)
    OR
    (name IS NULL AND from_account_id IS NOT NULL AND to_account_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX fee_presets_route_unique ON transfer_fee_presets (household_id, from_account_id, to_account_id)
  WHERE from_account_id IS NOT NULL;
CREATE UNIQUE INDEX fee_presets_name_unique ON transfer_fee_presets (household_id, lower(name))
  WHERE name IS NOT NULL;

-- Salary, freelance, rent, subscriptions, etc.
CREATE TABLE recurring_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  owner_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,  -- NULL = shared
  kind           text NOT NULL CHECK (kind IN ('income', 'expense')),
  name           text NOT NULL,
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  frequency      text NOT NULL CHECK (frequency IN ('weekly', 'fortnightly', 'semi_monthly', 'monthly', 'quarterly', 'yearly')),
  account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  next_date      date,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recurring_household_idx ON recurring_items (household_id);

-- Current balance of every account = opening balance + effect of all non-deleted transactions.
CREATE VIEW account_balances AS
SELECT
  a.id AS account_id,
  (a.opening_balance_cents + COALESCE(SUM(fx.delta), 0))::bigint AS balance_cents  -- SUM(bigint) is numeric; cast back
FROM accounts a
LEFT JOIN (
  -- money leaving / entering the main account
  SELECT account_id AS acct,
         CASE type
           WHEN 'income'   THEN amount_cents
           WHEN 'expense'  THEN -amount_cents
           WHEN 'transfer' THEN -(amount_cents + CASE WHEN fee_paid_by = 'sender' THEN fee_cents ELSE 0 END)
         END AS delta
  FROM transactions WHERE deleted_at IS NULL
  UNION ALL
  -- money arriving at the transfer destination
  SELECT to_account_id,
         amount_cents - CASE WHEN fee_paid_by = 'receiver' THEN fee_cents ELSE 0 END
  FROM transactions WHERE deleted_at IS NULL AND type = 'transfer'
) fx ON fx.acct = a.id
GROUP BY a.id, a.opening_balance_cents;
