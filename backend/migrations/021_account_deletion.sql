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
