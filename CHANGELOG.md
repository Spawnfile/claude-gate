# Changelog

All notable changes to claude-gate are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions
follow semver.

## [0.6.0] - 2026-05-14

Initial public release.

### Added
- PreToolUse hook end-to-end: parses MCP tool parameters, runs the decision
  pipeline over a local Unix socket, and returns an ALLOW / ASK / DENY
  decision.
- Multi-source discovery (`.env` files, `.mcp.json`) with a 3-step setup
  wizard: Discovery, Per-DB Policy, Review and Activate.
- Four built-in policies -- strict / confirm / dev / allow -- applied
  per-resource by environment (prod / dev / local).
- Shipped SQL rule pack with deterministic risk classification
  (LOW / MED / HIGH / CRIT), plus user-authored rule packs loaded from
  `<project>/.claude-gate/rules/`.
- SessionStart and UserPromptSubmit hooks for first-run and debug notices.
- `gate-confirm` CLI for out-of-band confirmation of critical actions.
- Nine slash commands: `/gate`, `status`, `setup`, `db list`, `db policy`,
  `allow-once`, and `debug`.
- Debug mode: decision simulator, discovery fixture, and sandbox-MCP
  synthetic responses.
- Append-only JSONL audit log with a SHA-256 hash chain and parameter
  redaction.
- Tiered fail policy when the engine is unreachable: prod closed, dev and
  local open.

### Notes
- All decisions are local and deterministic. claude-gate makes no external
  API calls.
- The published plugin ships a self-contained, esbuild-bundled
  `mcp-server/dist/`, so a bare `git clone` works with no `npm install`.
