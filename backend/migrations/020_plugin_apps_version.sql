-- APPS_VERSION: the version of the app file format (shared/types
-- src/plugins/apps-version.ts), on its own clock. Each published version
-- records the lowest one that can open it, computed on publish, so the
-- directory shows a client only what it understands and hands it the latest
-- version it can open. Clients send theirs as ?apps_version=; one that
-- doesn't is treated as 0.1 (extension 1.4.0, the first with apps).
--
-- Everything published before this column existed used the 0.1 format.
ALTER TABLE plugin_version ADD COLUMN IF NOT EXISTS min_apps_version TEXT NOT NULL DEFAULT '0.1';
