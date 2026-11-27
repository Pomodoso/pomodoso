-- Why people remove the extension: the short form Chrome opens right after an
-- uninstall (chrome.runtime.setUninstallURL → the web's /goodbye page).
-- Anonymous on purpose: no user, email, device or IP. Only the reason, an
-- optional comment, the extension version and how many days it was installed,
-- which is all that's needed to see why people leave. Not linked to "user",
-- so account deletion has nothing to clean up here. Read straight from the
-- database for now.
CREATE TABLE IF NOT EXISTS uninstall_feedback (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One of REASONS in routes/feedback.rs.
  reason         TEXT        NOT NULL,
  comment        TEXT,
  version        TEXT,
  days_installed INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS uninstall_feedback_created ON uninstall_feedback (created_at);
