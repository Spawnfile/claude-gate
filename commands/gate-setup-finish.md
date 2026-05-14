---
description: Finalize setup and activate gating (critical action requiring terminal confirmation)
---

# /gate setup finish

When the user runs this command, call the MCP tool `gate.setup_finalize` with no arguments.

The response will include an action ID and instructions to run `gate-confirm <action_id>` in the terminal.

Display the output verbatim, including:
- The action ID
- The exact command to run in the terminal
- Instructions to call gate.setup_finalize again with action_id after confirming

This is a critical action requiring out-of-band terminal confirmation. The user MUST run the gate-confirm command in their terminal before setup can be finalized.
