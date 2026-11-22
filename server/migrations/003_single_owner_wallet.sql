-- 003: the app is one person's wallet. The owner manages everything; partners
-- (role 'member') can view it and log entries. Accounts and recurring items no
-- longer have individual owners. Private accounts are hidden from partners.

ALTER TABLE accounts DROP CONSTRAINT private_needs_owner;
ALTER TABLE accounts DROP COLUMN owner_user_id;
ALTER TABLE recurring_items DROP COLUMN owner_user_id;
