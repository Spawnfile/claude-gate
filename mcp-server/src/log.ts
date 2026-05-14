const PREFIX = "[claude-gate]";

export function info(message: string): void {
  console.error(`${PREFIX} ${message}`);
}

export function warn(message: string): void {
  console.error(`${PREFIX} WARN ${message}`);
}

export function err(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `: ${error.message}` : "";
  console.error(`${PREFIX} ERROR ${message}${detail}`);
}
