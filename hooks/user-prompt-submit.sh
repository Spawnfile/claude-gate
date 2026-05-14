#!/usr/bin/env bash
set -u
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CLIENT_JS="${PLUGIN_ROOT}/mcp-server/dist/hook/user-prompt-submit.js"
if [ ! -f "${CLIENT_JS}" ]; then exit 0; fi
exec node "${CLIENT_JS}"
