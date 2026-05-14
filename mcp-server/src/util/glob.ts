// mcp-server/src/util/glob.ts
//
// Shared glob-match helper. Converts a simple glob pattern (only * wildcard
// supported) to a regex and tests against value. Used by policy/match.ts,
// policy/session.ts, and ipc/server.ts (sandbox intercept patterns).

export function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$");
  return re.test(value);
}
