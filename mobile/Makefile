# Local iOS/Android builds. No EAS: these run on this machine, cost nothing
# and need no queue. EAS becomes worth it when builds have to happen without
# the Mac (CI, or another person shipping) — until then this is the whole
# pipeline.
#
# Signing comes from app.json's ios.appleTeamId. With a paid Apple Developer
# account, a build signed this way lasts a year on the device instead of the
# seven days a free personal team allows.

VERSION := $(shell node -p "require('./app.json').expo.version")
BUILD   := $(shell node -p "require('./app.json').expo.ios.buildNumber")

# Override per invocation: `make ios DEVICE=00008130-…`
# Find yours with `make devices`.
DEVICE ?=
PORT   ?= 8084

.PHONY: help devices ios ios-dev sim install prebuild version archive upload testflight bump

help:
	@echo "Pomodoso mobile — $(VERSION) (build $(BUILD))"
	@echo
	@echo "  make devices        list connected iPhones and their UDIDs"
	@echo "  make ios            Release build → connected iPhone (standalone, no Metro)"
	@echo "  make ios-dev        dev-client build → iPhone, needs 'make metro' running"
	@echo "  make sim            Release build → booted simulator"
	@echo "  make install        install the last Release build without rebuilding"
	@echo "  make metro          start Metro on port $(PORT)"
	@echo "  make prebuild       regenerate ios/ and android/ from app.json"
	@echo
	@echo "  DEVICE=<udid> selects a device; PORT=<n> moves Metro."
	@echo
	@echo "TestFlight:"
	@echo "  make bump           increment ios.buildNumber"
	@echo "  make archive        build + export a signed .ipa"
	@echo "  make upload         send the .ipa to App Store Connect"
	@echo "  make testflight     bump, archive and upload in one go"

devices:
	@xcrun xctrace list devices 2>/dev/null | grep -i iphone | grep -v Simulator || echo "no iPhone connected"

# The one to use for real testing: embeds the JS bundle, so the app runs with
# the Mac closed and off the network. A dev-client build cannot do that — it
# fetches JS from Metro at launch and shows "No script URL provided" without it.
ios:
	@test -n "$(DEVICE)" || (echo "DEVICE is required — run 'make devices'"; exit 1)
	npx expo run:ios --configuration Release --device $(DEVICE)

ios-dev:
	@test -n "$(DEVICE)" || (echo "DEVICE is required — run 'make devices'"; exit 1)
	npx expo run:ios --device $(DEVICE) --port $(PORT)

sim:
	npx expo run:ios --configuration Release

# Installing is separate from building because `expo run:ios` fails its launch
# step when the phone is locked, after having built and signed successfully.
# This picks up that build rather than doing it again.
install:
	@test -n "$(DEVICE)" || (echo "DEVICE is required — run 'make devices'"; exit 1)
	@APP=$$(ls -d ~/Library/Developer/Xcode/DerivedData/Pomodoso-*/Build/Products/Release-iphoneos/Pomodoso.app 2>/dev/null | head -1); \
	  test -n "$$APP" || (echo "no Release build found — run 'make ios' first"; exit 1); \
	  xcrun devicectl device install app --device $(DEVICE) "$$APP"

metro:
	npx expo start --port $(PORT)

# Regenerates the native projects. Needed after changing app.json's plugins,
# icons or entitlements — `expo run:ios` alone reuses whatever ios/ already
# holds, which is why icon and splash changes appear to do nothing until this
# runs.
prebuild:
	npx expo prebuild --clean

version:
	@echo "version    $(VERSION)   (marketing version, shown in the App Store)"
	@echo "build      $(BUILD)     (must increase on every upload of the same version)"

# ─── TestFlight ───────────────────────────────────────────────────────────────
#
# Local, no EAS. Three steps that can each be run alone, because when an
# upload fails it is almost never the build that was wrong.
#
# One-time setup, both in App Store Connect and both yours to do:
#   1. Create the app (bundle id com.pomodoso.app).
#   2. Users and Access → Integrations → App Store Connect API → generate a
#      key with the "App Manager" role. Save the .p8 to
#      ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8 and note the Key ID
#      and Issuer ID — the .p8 downloads exactly once.
#
# Then export these (a shell profile, not this file — the key id and issuer
# are account credentials and this file is public):
#   export ASC_KEY_ID=…
#   export ASC_ISSUER_ID=…

ARCHIVE := build/Pomodoso.xcarchive
IPA_DIR := build/ipa

# App Store Connect rejects a second upload carrying a buildNumber it has
# already seen, even after the first was deleted. Rejection happens after the
# whole upload, so it is worth spending a second here rather than ten minutes
# there.
bump:
	@node -e "const fs=require('fs'),p='app.json',c=JSON.parse(fs.readFileSync(p));\
	  const n=String(Number(c.expo.ios.buildNumber||0)+1);c.expo.ios.buildNumber=n;\
	  fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n');console.log('buildNumber →',n)"
	npx expo prebuild --platform ios

archive:
	@rm -rf $(ARCHIVE) $(IPA_DIR)
	cd ios && xcodebuild archive \
	  -workspace Pomodoso.xcworkspace \
	  -scheme Pomodoso \
	  -configuration Release \
	  -destination "generic/platform=iOS" \
	  -archivePath ../$(ARCHIVE) \
	  -allowProvisioningUpdates
	xcodebuild -exportArchive \
	  -archivePath $(ARCHIVE) \
	  -exportOptionsPlist ExportOptions.plist \
	  -exportPath $(IPA_DIR) \
	  -allowProvisioningUpdates
	@echo "→ $(IPA_DIR)/Pomodoso.ipa"

upload:
	@test -n "$$ASC_KEY_ID"    || (echo "ASC_KEY_ID is not set — see the Makefile header"; exit 1)
	@test -n "$$ASC_ISSUER_ID" || (echo "ASC_ISSUER_ID is not set — see the Makefile header"; exit 1)
	@test -f $(IPA_DIR)/Pomodoso.ipa || (echo "no .ipa — run 'make archive' first"; exit 1)
	xcrun altool --upload-app \
	  --type ios \
	  --file $(IPA_DIR)/Pomodoso.ipa \
	  --apiKey $$ASC_KEY_ID \
	  --apiIssuer $$ASC_ISSUER_ID
	@echo "→ uploaded. Processing in App Store Connect takes a few minutes."

testflight: bump archive upload
