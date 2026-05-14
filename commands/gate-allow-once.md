---
description: Queue a one-shot approval for a tool call matching the given pattern
argument-hint: <tool-pattern>
---

# /gate allow-once <pattern>

Parse the user's input to extract the tool pattern (glob-style).

Call the MCP tool `gate.allow_once` with:
```json
{ "tool_pattern": "<pattern>" }
```

Examples of valid patterns:
- `mcp__supabase__execute_sql` (exact tool name)
- `mcp__supabase_prod__*` (glob: match all tools from supabase_prod)
- `mcp__supabase_*__execute_sql` (glob: match execute_sql from any supabase instance)

Display the confirmation message indicating that the one-shot approval has been queued.
