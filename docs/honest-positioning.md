# claude-gate -- Honest Positioning

This document is the authoritative "when not to use" reference for claude-gate.
It is ported from PRD Section 10 and is mandatory reading before installing.
Honesty builds trust: we would rather you not install claude-gate than install
it expecting protection it cannot provide.

## When NOT to use

| Don't install if...                                                            | Reason                                                                                                 |
|--------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| Your DB MCP already uses a read-only role at L9                                | claude-gate adds latency without value; L9 is unbypassable                                             |
| You only use Claude Code in default-prompt mode                                | Marginal value; you're already approving everything manually                                           |
| You need cross-client governance (Cline, Continue, Claude Desktop)             | Use an MCP gateway instead                                                                             |
| You need SOC 2 / HIPAA / regulated-industry compliance                         | Get an enterprise gateway with proper attestations                                                     |
| Your discovery surface is dynamic (runtime-built connection strings, no env files) | False sense of security is worse than no plugin; we will miss things                              |

## What claude-gate actually is

claude-gate is a defense-in-depth layer at L5 (PreToolUse hook) for developers
who use Claude Code with permissive allow lists or auto-accept mode and have not
yet applied L9 database-side controls. It parses SQL parameters, classifies
risk, and blocks or flags operations based on per-resource policies. It is
Claude Code-native, project-scoped, and deterministic.

It does not replace stronger controls. It closes a specific gap: Claude Code's
built-in permission rules cannot inspect tool parameters, and its auto-mode
classifier does not know which resource is production vs development. claude-gate
fills exactly that gap, and nothing more.

## What you should do instead

### If you have a few hours: apply L9 controls

L9 controls are architecturally stronger and cannot be bypassed by any L5
plugin, prompt injection, or Claude Code behavior change.

- **Read-only Postgres role:** Create a role with SELECT-only grants and
  configure your MCP server to connect as that role. Any write attempt fails at
  the database itself, not at the plugin layer.
- **Supabase Row Level Security:** Enable RLS on sensitive tables. Even if a
  write reaches the DB, RLS can restrict what rows are affected.
- **Separate MCP servers per environment:** Point one MCP server at prod and one
  at dev. Configure only the dev MCP server in your default workflow.

These measures make claude-gate optional for that resource. If you apply L9
hygiene everywhere, you may not need claude-gate at all.

### If you need cross-client governance

MCP gateways (such as the ones listed in the awesome-mcp-gateway category of
awesome-mcp and similar community lists) operate at L7-L8 and intercept calls
from any MCP client -- Cline, Continue, Claude Desktop, or Claude Code. If you
need to enforce policies across multiple AI tools, an MCP gateway is the right
architecture. claude-gate only governs Claude Code.

### If you need enterprise compliance

Commercial MCP gateway products provide audit attestations, SSO integration,
RBAC, and compliance reporting suitable for SOC 2, HIPAA, and similar
frameworks. claude-gate is MIT-licensed open-source software with no SLA,
no attestations, and no commercial support. It is not appropriate as the sole
security control in a regulated environment.

## The coverage gap we will always have

claude-gate discovers databases from static sources: .env files, .mcp.json, and
(in a future version) docker-compose and ORM configs. It cannot discover:

- Connection strings built at runtime (string interpolation, environment
  variable assembly in application code).
- Databases accessed through custom MCP servers whose configuration is not in
  any scanned file.
- Cloud-provider-managed databases configured entirely through environment
  variables set outside the project directory.
- MCP servers configured in shell rc files (~/.bashrc, ~/.zshrc).

For these cases, a false sense of security is worse than no plugin. The
/gate db audit-coverage command shows exactly what was and was not scanned.
Use it before trusting that a resource is governed.
