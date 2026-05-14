```
 ███ █   ███ █ █ ██  ███     ███ ███ ███ ███
 █   █   █ █ █ █ █ █ █       █   █ █  █  █
 █   █   ███ █ █ █ █ ██  ███ █ █ ███  █  ██
 █   █   █ █ █ █ █ █ █       █ █ █ █  █  █
 ███ ███ █ █ ███ ██  ███     ███ █ █  █  ███

 tool call  ->  [ gate ]  ->  ALLOW / ASK / DENY
```

A fully-local Claude Code guardrail that knows which of your databases is
production — and gates every tool call against that database's own policy.
No SaaS, no external calls, no generic pattern lists.

## What it does

claude-gate intercepts each database tool call, classifies its risk, and
returns **ALLOW**, **ASK**, or **DENY** — based on the policy of the *specific
database* the call targets:

```
   DROP TABLE ...  ->  prod-db    (strict)    ->  DENY
   DROP TABLE ...  ->  dev-db     (confirm)   ->  ASK
   DROP TABLE ...  ->  local-db   (allow)     ->  ALLOW
```

The identical query is blocked, questioned, or allowed depending on where it
lands. On setup, claude-gate discovers your databases from `.env` files and
`.mcp.json` and tags each as prod / dev / local — so it knows production from
the rest. Every decision is local and deterministic; no external API calls.

## How is this different from Claude Code's built-in permissions?

Claude Code already prompts for tool permissions and has a classifier that
flags risky-looking calls. That works on **general intuition** — "does this
look dangerous?"

claude-gate works on **project context**. It knows *this* connection string is
your prod database, that prod is set to the `strict` policy, and that the SQL
is an unscoped `UPDATE` — so it gives a deterministic, explainable decision
instead of a guess. The two run side by side: Claude Code's classifier is the
broad net, claude-gate is the project-aware rule.

## Install

**Prerequisites:** Claude Code 2.1.x+.

### Option A — from the marketplace (recommended)

Claude Code clones and registers the repo for you:

    claude plugin marketplace add Spawnfile/claude-gate
    claude plugins install claude-gate@claude-gate

### Option B — clone, then install

For reading the code first, forking, or offline use:

    git clone https://github.com/Spawnfile/claude-gate.git
    claude plugin marketplace add ./claude-gate
    claude plugins install claude-gate@claude-gate

Either way the plugin is self-contained — there is no `npm install` step; the
runtime ships pre-bundled in the repo.

### Choosing a scope

Both `marketplace add` and `plugins install` take `-s` / `--scope`:

    Scope              Applies to                        Stored in                     Committed
    -----------------  --------------------------------  ----------------------------  ---------
    user (default)     every project, for your user      ~/.claude/                    no
    project            this repo, shared with your team  .claude/settings.json         yes
    local              this repo, just you               .claude/settings.local.json   no

claude-gate is project-context-aware, so `project` scope is the usual choice
for a shared repo — everyone who clones it gets the same gating. Use `user`
scope to enable it across all your projects. For a team repo, add the
marketplace and install at the same scope so both are committed:

    claude plugin marketplace add Spawnfile/claude-gate -s project
    claude plugins install claude-gate@claude-gate -s project

### Verify, update, uninstall

    claude plugins list                            # shows claude-gate@claude-gate, enabled
    /gate                                          # inside Claude Code: command help

    claude plugin marketplace update claude-gate   # pull the latest from the source
    claude plugins update claude-gate              # apply it (restart Claude Code after)

    claude plugins uninstall claude-gate           # remove it

(For hacking on the plugin itself, `claude --plugin-dir /path/to/claude-gate`
loads it for one session without installing.)

## Quickstart

**1. Run setup** — a 3-step wizard (Discover → Set policy → Activate):

    /gate setup

It finds your databases, recommends policies, and writes
`<project>/.claude-gate/config.yaml`. The recommended defaults are safe.

**2. Use Claude normally.** claude-gate now gates every database tool call:

    "Run SELECT * FROM products LIMIT 5"   ->  ALLOW   (low risk)
    "Run UPDATE products SET price = 0"    ->  DENY    (unscoped UPDATE, strict)
    "Run DROP TABLE customers"             ->  DENY    (critical)

Critical actions (like changing a policy) need out-of-band confirmation:
claude-gate prints an exact `gate-confirm` command for you to run in your own
terminal — something Claude cannot do for itself.

## Policies (modes)

Each database is assigned one of four policies:

    Policy   | LOW   | MED   | HIGH  | CRIT
    ---------+-------+-------+-------+-------
    strict   | ALLOW | DENY  | DENY  | DENY
    confirm  | ALLOW | ASK   | ASK   | DENY
    dev      | ALLOW | ALLOW | ASK   | ASK
    allow    | ALLOW | ALLOW | ALLOW | ALLOW

Risk levels: **LOW** = reads (SELECT, EXPLAIN) · **MED** = scoped writes
(INSERT, UPDATE … WHERE) · **HIGH** = unscoped writes · **CRIT** = DDL
(DROP, TRUNCATE, ALTER, GRANT).

`ASK` is interactive — Claude Code interrupts and prompts you to approve or
deny. Recommended defaults: prod → `strict`, dev → `confirm`, local → `allow`.

## Slash commands

    /gate                          Show help
    /gate status                   Current policies and session state
    /gate setup                    Run / resume the setup wizard
    /gate db list                  Registered databases and their policies
    /gate db policy <name> <mode>  Change a database's policy
    /gate allow-once <pattern>     One-time override for the current session
    /gate debug <subcommand>       simulate / fixture / sandbox-mcp

## What claude-gate is NOT

It is **not** a primary security control. Database-side controls — read-only
roles, row-level security — are stricter and unbypassable; claude-gate is
defense-in-depth for when those aren't in place. It is Claude Code-only (it
does not govern Cline, Continue, or Claude Desktop), carries no compliance
attestations, and cannot see connection strings built at runtime.

See [docs/honest-positioning.md](docs/honest-positioning.md) for the full
"when not to use" table and [docs/threat-model.md](docs/threat-model.md) for
the security model.

## Status

v0.6.0 — see [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
