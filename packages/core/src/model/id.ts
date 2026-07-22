/**
 * Every transaction gets a stable app-generated UUID at import/creation
 * time. Never reuse a CSV `Nr` (restarts per export) or an array index
 * (the override-loss bug documented in CLAUDE.md §3.1.1) as identity.
 */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
