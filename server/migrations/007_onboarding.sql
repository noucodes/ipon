-- 007: remember (per user, on the server) whether the "Set up your finances" guide was
-- finished or skipped, so it shows until then and never again after (on any device).
-- New users with no accounts are taken to it automatically and can skip it.
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;
