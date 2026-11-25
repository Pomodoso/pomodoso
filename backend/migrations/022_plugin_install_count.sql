-- How many times each directory app has been installed. A bare number: no
-- user, device or IP, because installing needs no account and the count is
-- all we want to know.
--
-- Its own table rather than a column on plugin_listing: that table's
-- updated_at trigger orders the directory, so bumping a counter there would
-- float every installed app to the top.
CREATE TABLE IF NOT EXISTS plugin_install_count (
  listing_id UUID   PRIMARY KEY REFERENCES plugin_listing(id) ON DELETE CASCADE,
  installs   BIGINT NOT NULL DEFAULT 0
);
