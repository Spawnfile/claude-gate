# Custom Rule Packs

claude-gate ships rule packs (e.g. `sql`) that classify tool calls by risk tier. You can
author your own packs or override a shipped pack by placing YAML files in
`<project>/.claude-gate/rules/`.

## Layout

```
<project>/
  .claude-gate/
    config.yaml       # pinned_version entries live here
    rules/
      sql.yaml        # overrides or extends the shipped sql pack
      my-pack.yaml    # brand-new pack unique to your project
```

Each YAML file must conform to the `RulePack` schema (fields: `version`, `name`,
`description`, `applies_to`, `parser`, `risk_tiers`).

## Trust Model

All packs in `.claude-gate/rules/` are trusted without sandboxing.
The user owns the project directory. Signing and sandboxing are planned.

## Pinned-Version Constraint

The `version` field in your pack **must equal** the `pinned_version` in
`config.yaml` for the same pack name:

```yaml
# config.yaml
rule_packs:
  sql:
    pinned_version: "1.0.0"
```

```yaml
# .claude-gate/rules/sql.yaml
version: "1.0.0"   # must match pinned_version exactly
name: sql
...
```

If the versions do not match, the loader throws a `RulePackLoadError` and the
gate process will not start.

To roll a custom pack forward, bump `version` in your YAML **and** update
`pinned_version` in `config.yaml` at the same time.

## Override Semantics

When a user pack and a shipped pack share the same `name` and `version`, the
user pack wins. The shipped file is left on disk; only the in-memory selection
changes.

## policies.yaml Exclusion

A `policies.yaml` file placed in `.claude-gate/rules/` is silently ignored.
The policy decision matrix (ALLOW / DENY / ASK per risk level) can only be
changed by editing the shipped `policies.yaml`.

## Hot Reload

User pack changes take effect on the next call to `bootstrap.reload()`, which
is triggered by:

- A `gate.config_set` tool call that mutates `config.yaml`.
- A new session start (each session creates a fresh bootstrap).
- Any explicit reload in the gate process.
