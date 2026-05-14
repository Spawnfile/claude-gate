---
description: Change a database policy
argument-hint: <db-name> <strict|confirm|dev|allow>
---

# /gate db policy <name> <mode>

Parse the user's input to extract the database name and desired policy mode.

Call the MCP tool `gate.db_set_policy` with:
```json
{ "name": "<db-name>", "policy": "<mode>" }
```

Where `<mode>` must be one of: `strict`, `confirm`, `dev`, or `allow`.

If the response indicates that confirmation is required (policy=allow):
- Display the action ID and the exact gate-confirm command to run
- Instruct the user to run the command in their terminal
- Then call gate.db_set_policy again with the action_id:
  ```json
  { "name": "<db-name>", "policy": "allow", "action_id": "<id>" }
  ```

For non-allow policies, the change takes effect immediately. Display the confirmation message.
