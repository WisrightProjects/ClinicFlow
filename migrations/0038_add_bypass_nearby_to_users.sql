-- Exempts a flagged account from the distance-based clinic filter, so app store
-- and payment gateway reviewers testing from outside India are not shown an
-- empty clinic list. Defaults to FALSE, leaving every existing account unchanged.

ALTER TABLE users ADD COLUMN IF NOT EXISTS bypass_nearby BOOLEAN DEFAULT FALSE;
