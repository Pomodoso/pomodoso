VERSION := $(shell node -p "require('./manifest.json').version")
ZIP     := releases/pomodoso-$(VERSION).zip
ZIP_DEV := releases/pomodoso-$(VERSION)-dev.zip

.PHONY: dev prod zip zip_dev

dev:
	pnpm exec vite build --watch

prod:
	pnpm exec vite build

zip: prod
	@mkdir -p releases
	@rm -f $(ZIP)
	cd dist && zip -r ../$(ZIP) .
	@echo "→ $(ZIP)"

zip_dev:
	pnpm exec vite build --mode development
	@mkdir -p releases
	@rm -f $(ZIP_DEV)
	cd dist && zip -r ../$(ZIP_DEV) .
	@echo "→ $(ZIP_DEV)"
