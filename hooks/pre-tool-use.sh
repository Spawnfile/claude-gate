#!/usr/bin/env bash
# hooks/pre-tool-use.sh
#
# Thin POSIX-shell shim that delegates to the Node hook client.
# All policy logic lives in mcp-server/src/hook/client.ts (and compiles
# to mcp-server/dist/hook/client.js).

set -u

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
CLIENT_JS="${PLUGIN_ROOT}/mcp-server/dist/hook/client.js"

if [ ! -f "${CLIENT_JS}" ]; then
  # Build not present - fail open so we never break CC due to a missing build.
  exit 0
fi

exec node "${CLIENT_JS}"
