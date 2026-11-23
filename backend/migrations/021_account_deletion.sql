-- Deleting an account removes the "user" row, and every user-owned table
-- cascades from it. plugin_listing is the one exception: a slug belongs to its
-- first publisher for good, so a deleted author's listing has to survive
-- (taken down, ownerless) to keep its slug from being claimed by someone else
-- and pushed to the app's existing users.

ALTER TABLE plugin_listing ALTER COLUMN owner_user_id DROP NOT NULL;

ALTER TABLE plugin_listing DROP CONSTRAINT IF EXISTS plugin_listing_owner_user_id_fkey;
ALTER TABLE plugin_listing
  ADD CONSTRAINT plugin_listing_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES "user"(id) ON DELETE SET NULL;

-- Ids of deleted accounts. Deleting the Supabase login does not revoke access
-- tokens already issued, and /me provisions any user it doesn't know — so
-- without this, another signed-in device could recreate the account within the
-- token's lifetime. Only the id is kept: it is a random UUID that Supabase
-- never reissues, and it identifies nobody once the account is gone.
CREATE TABLE IF NOT EXISTS deleted_account (
  user_id    UUID        PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The check in /me alone leaves a window: a request that passed it just before
-- the deletion committed would insert the user right after. The database
-- closes it. The deletion holds the "user" row locked until it commits, so a
-- concurrent upsert waits on it and only then inserts — and this trigger,
-- whose query takes a fresh snapshot at that moment (VOLATILE, READ
-- COMMITTED), sees the committed deleted_account row and refuses.
CREATE OR REPLACE FUNCTION refuse_deleted_account() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM deleted_account WHERE user_id = NEW.id) THEN
    RAISE EXCEPTION 'account % was deleted', NEW.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

DROP TRIGGER IF EXISTS refuse_deleted_account ON "user";
CREATE TRIGGER refuse_deleted_account
  BEFORE INSERT ON "user"
  FOR EACH ROW EXECUTE FUNCTION refuse_deleted_account();
