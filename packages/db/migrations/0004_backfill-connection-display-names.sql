-- Name existing connections after the account holder rather than the address.
--
-- Connections recorded before `account_name` was captured defaulted to the email address, so a
-- workspace's list read as a column of addresses. New connections take the name; this brings the
-- older ones into line.
--
-- Deliberately narrow: it only touches rows whose name is *exactly* the stored address, which is
-- the signature of the old default. A name someone chose is left alone, and so is any row where
-- the provider gave us no name to use instead.
UPDATE "connections"
SET "display_name" = "account_name",
    "updated_at" = now()
WHERE "display_name" = "account_email"
  AND "account_name" IS NOT NULL
  AND "account_name" <> '';
