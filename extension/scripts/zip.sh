#!/usr/bin/env bash
# Package a production Chrome Web Store zip, then restore the dev build so the
# local dist/ stays on dev (mirrors otpilot: default dev, flip to prod only to
# package, then back to dev).
set -euo pipefail
cd "$(dirname "$0")/.."   # → extension/

VERSION=$(node -p "require('./manifest.json').version")
OUT="pomodoso-extension-v${VERSION}.zip"

echo "→ Production build (.env.production)…"
pnpm run build:prod

echo "→ Packaging ${OUT}…"
rm -f "${OUT}"
( cd dist && zip -rq "../${OUT}" . )

echo "→ Restoring dev build (.env.development)…"
pnpm run build

echo "✓ ${OUT} created — dist/ is back on dev."
