---
description: Debug utilities for testing and troubleshooting
argument-hint: <simulate|fixture|sandbox-mcp-on|sandbox-mcp-off> [args...]
---

# /gate debug

Parse the user's input to determine the debug subcommand.

Dispatch to the appropriate MCP tool based on the subcommand:

## /gate debug simulate

Call `gate.debug_simulate` with parameters:
```json
{ "tool": "<tool-name>", "parameters": {...}, "as_db": "<db-name>" }
```

Simulates a tool call decision without executing the real call. Returns what the gating policy would decide.

Note: `gate.debug_simulate` is side-effect-free -- it runs the policy engine
against an in-memory audit writer and never touches a database. Claude Code's
own permission classifier may still flag the call because its arguments
contain database-shaped strings. If it is auto-denied, allowlist the tool in
`.claude/settings.json`:
```json
{ "permissions": { "allow": ["mcp__plugin_claude-gate_claude-gate__gate_debug_simulate"] } }
```

## /gate debug fixture

Call `gate.debug_fixture` with parameters:
```json
{ "project_dir": "<directory>" }
```

Run discovery against a synthetic project directory.

## /gate debug sandbox-mcp-on

Call `gate.debug_sandbox_mcp_on` with parameters:
```json
{ "intercept": "pattern1,pattern2", "confirm_i_am_testing": true, "minutes": 10 }
```

`intercept` is a comma-separated list of tool-name glob patterns.
`confirm_i_am_testing` must be `true` or the call is refused. `minutes`
defaults to 60 and is capped at 60.

Enable sandbox-MCP mode to intercept and mock matching tool calls.

## /gate debug sandbox-mcp-off

Call `gate.debug_sandbox_mcp_off` with no parameters.

Disable sandbox-MCP mode.

Display the output from the called debug tool.
