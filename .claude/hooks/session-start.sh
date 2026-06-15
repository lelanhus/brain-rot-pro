#!/bin/bash
set -euo pipefail

# Prepares a Claude Code on the web session so `npm run verify` works:
# installs JS dependencies and the Chromium browser used by the component
# (vitest browser mode) and e2e (Playwright) test projects.
#
# Synchronous + idempotent. Only runs in the remote (web) environment; local
# machines manage their own dependencies.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# `npm install` (not `npm ci`) so the cached container layer is reused.
npm install

# Browser for `npm run test:component` and `npm run test:e2e`.
npx playwright install chromium
