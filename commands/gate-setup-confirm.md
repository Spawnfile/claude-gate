---
description: Advance the setup wizard to the next step
argument-hint: (no arguments required)
---

# /gate setup confirm

When the user runs this command, call the MCP tool `gate.setup_advance` with no arguments.

Display the rendered output showing the next setup step. If advancement fails (e.g. prerequisites not met), display the error message and guidance on how to resolve it.

This command is typically used when Claude indicates that the current step is complete and the user is ready to proceed.
