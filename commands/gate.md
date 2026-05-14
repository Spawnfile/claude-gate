---
description: Show claude-gate help and list available commands
---

# /gate

When the user runs this command without a subcommand, display the available /gate commands:

- `/gate status` - Show active session, databases, and policies
- `/gate setup` - Start or resume the setup wizard
- `/gate setup confirm` - Advance the setup wizard to the next step
- `/gate setup finish` - Finalize setup (requires terminal confirmation)
- `/gate db list` - List registered databases and their policies
- `/gate db policy <name> <mode>` - Change a database policy
- `/gate allow-once <pattern>` - Queue a one-shot tool approval
- `/gate debug` - Debug utilities (simulate, fixture, sandbox-mcp)

For detailed help on any command, type `/gate <command>` or ask Claude.
