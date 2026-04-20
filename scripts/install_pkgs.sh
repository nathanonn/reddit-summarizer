#!/usr/bin/env bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

npm install

# Start dev server detached so the hook exits quickly
nohup npm run dev >/tmp/reddit-summarizer-dev.log 2>&1 &

exit 0