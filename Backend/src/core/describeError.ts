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

/**
 * The innermost reason, on its own.
 *
 * `describeError` is for a log, where every layer is worth keeping. This is for
 * the one line a person reads: the deepest message in the chain, which for a
 * failed query is the database's own — `column products.size_class does not
 * exist` rather than a hundred characters of `select`.
 *
 * Falls back to the outermost message when there is no cause, and to the
 * string itself when what was thrown is not an `Error` at all.
 */
export function rootCauseOf(error: unknown, depth = 6): string {
  let current: unknown = error;
  let best = typeof error === "string" ? error : "";

  for (let level = 0; level < depth && current; level += 1) {
    if (!(current instanceof Error)) {
      const text = String(current).trim();
      if (text) best = text;
      break;
    }
    if (current.message.trim()) best = current.message.trim();
    current = current.cause;
  }

  return best || "Unknown error";
}

/**
 * Did this write bounce off a particular unique index?
 *
 * The chain is walked rather than the message read, because what is thrown is
 * Drizzle's own wrapper — its `message` is "Failed query: insert into …" and
 * the constraint name is only on the driver error underneath it. Reading the
 * top-level message looked right, matched nothing, and turned a refusal
 * somebody can act on into a 500.
 *
 * Both spellings are checked: node-postgres and PGlite put the name on
 * `constraint`, postgres.js on `constraint_name`. `23505` is Postgres's unique
 * violation. A violation carrying no name at all is taken as this one, since a
 * driver that withholds it leaves nothing else to go on; a violation naming a
 * *different* index is not, so a second index added later cannot be quietly
 * reported as this one.
 *
 * It lives here rather than beside its first caller because there are two now:
 * the one-open-request index on `price_offers` and the per-product SKU index on
 * `product_variants`. A copy is how one of them stops matching.
 */
export function violatesUnique(error: unknown, constraint: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 6; depth += 1) {
    const step = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
    if (step.code === "23505") {
      const named = step.constraint ?? step.constraint_name;
      if (typeof named !== "string" || named === constraint) return true;
    }
    current = step.cause;
  }
  return false;
}
