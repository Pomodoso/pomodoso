VERSION := $(shell node -p "require('./manifest.json').version")
ZIP     := releases/pomodoso-$(VERSION).zip
ZIP_DEV := releases/pomodoso-$(VERSION)-dev.zip

.PHONY: dev prod zip zip_dev

dev:
	pnpm exec vite build --watch

prod:
	pnpm exec vite build

# Packages the Web Store zip, then puts dist/ back on a dev build.
#
# That last step is the point: every other build target here is dev-mode, so
# dist/ is what you load unpacked while working. Leaving it on a production
# build means the extension you're testing against talks to api.pomodoso.com
# and the real Supabase without saying so. Packaging is the one operation
# that has to touch prod, so it's also the one that has to undo itself.
zip: prod
	@mkdir -p releases
	@rm -f $(ZIP)
	cd dist && zip -rq ../$(ZIP) .
	@echo "→ $(ZIP)"
	@echo "→ restoring dev build…"
	@pnpm exec vite build --mode development >/dev/null
	@echo "→ dist/ is back on dev"

zip_dev:
	pnpm exec vite build --mode development
	@mkdir -p releases
	@rm -f $(ZIP_DEV)
	cd dist && zip -r ../$(ZIP_DEV) .
	@echo "→ $(ZIP_DEV)"
