/**
 * The referral code somebody arrived with (3.1.14).
 *
 * A friend's invitation link is `/?ref=NLXXXX`, and almost nobody registers on
 * the page they land on: they look at the shop first. So the code is put aside
 * the moment it is seen and read back when the account is actually made.
 *
 * `localStorage` is exactly the right store for this and exactly the wrong one
 * for anything else here: it is a per-viewer convenience, it never reaches the
 * server on its own, and losing it costs one referral rather than a fact NetLet
 * needs. The wrapping that makes a private window and blocked site data safe
 * lives in `lib/browserStore` — it was written down here first and then missed
 * by three other callers, which is the argument for it being one function.
 */
import { readStored, removeStored, writeStored } from "@/lib/browserStore";

const KEY = "netlet.referral";

/** Codes are short and shaped; anything else is somebody editing the URL. */
const SHAPE = /^[A-Za-z0-9]{2,32}$/;

/** Remember the `?ref=` on this page, if there is a plausible one. */
export function captureReferral(search: string): void {
  const code = new URLSearchParams(search).get("ref")?.trim();
  if (!code || !SHAPE.test(code)) return;
  /* Private window, blocked site data: the invitation is lost, not the visit. */
  writeStored(KEY, code.toUpperCase());
}

/** The code to send with a registration, if one was ever seen. */
export function storedReferral(): string | undefined {
  return readStored(KEY) ?? undefined;
}

/** Forget it once it has been used, so it cannot ride along on a second account. */
export function clearReferral(): void {
  removeStored(KEY);
}
