---
description: Start or resume the claude-gate setup wizard for database discovery and policy configuration
---

# /gate setup

When the user runs this command, call the MCP tool `gate.setup_start` with no arguments.

Display the rendered output showing the current setup step (1, 2, 3, or already active).

As the user converses naturally with Claude during the setup process:
- Claude may call `gate.setup_edit_db` to edit database entries (assign env or mark for removal)
- Claude may call `gate.setup_set_policy` to assign policies to databases
- Claude may call `gate.setup_advance` to move to the next step when prerequisites are met

The wizard is stateful and persists between invocations.
