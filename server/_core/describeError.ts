/**
 * The whole error, not the outermost wrapper.
 *
 * Drivers wrap. Drizzle reports "Failed query: select 1" and hangs the real
 * reason — `SASL authentication failed`, `Tenant or user not found`, a DNS
 * failure — on `cause`. Logging only the top message therefore says nothing
 * useful about why production is down, which is the exact failure mode this
 * exists to prevent.
 *
 * Postgres errors also carry `code`, `detail` and `hint` as own properties
 * rather than in the message, so those are picked up where present.
 */
export function describeError(error: unknown, depth = 4): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let level = 0; level < depth && current; level += 1) {
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const extras = (["code", "detail", "hint", "severity"] as const)
      .map(key => {
        const value = (current as unknown as Record<string, unknown>)[key];
        return value === undefined || value === null ? null : `${key}=${String(value)}`;
      })
      .filter(Boolean);
    parts.push(`${current.name}: ${current.message}${extras.length ? ` (${extras.join(" ")})` : ""}`);
    current = current.cause;
  }

  return parts.join("\n  caused by ");
}
