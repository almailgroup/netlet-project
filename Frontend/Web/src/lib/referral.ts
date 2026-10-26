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
import { MAX_PRODUCT_REFERRALS, PRODUCT_LINK_DAYS, userIdFromCode } from "@shared/commerce/referral";

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

/* ---------------------------------------------------------- product links --- */

/*
 * A product link (3.1.14) is the same code on a product's own address,
 * `/products/x?ref=NL…`. The sharer earns on a line for *that* product, so the
 * browser keeps which product each code arrived on, for `PRODUCT_LINK_DAYS`,
 * and checkout sends them. The server checks everything else — that the code
 * names an account and that it is not the buyer — and freezes it on the line.
 */
const LINKS_KEY = "netlet.productLinks";

type ProductLink = { productId: string; code: string; at: string };

function readLinks(now: Date): ProductLink[] {
  try {
    const stored = JSON.parse(readStored(LINKS_KEY) ?? "[]") as ProductLink[];
    if (!Array.isArray(stored)) return [];
    const cutoff = now.getTime() - PRODUCT_LINK_DAYS * 86_400_000;
    return stored.filter(link =>
      typeof link?.productId === "string" && typeof link.code === "string" && new Date(link.at).getTime() >= cutoff);
  } catch {
    return [];
  }
}

/** Remember the `?ref=` on a product's page against that product; the latest link for a product wins. */
export function rememberProductLink(productId: string, search: string, now = new Date()): void {
  const code = new URLSearchParams(search).get("ref")?.trim().toUpperCase();
  if (!code || userIdFromCode(code) === null || !productId) return;
  const kept = readLinks(now).filter(link => link.productId !== productId);
  const next = [{ productId, code, at: now.toISOString() }, ...kept].slice(0, MAX_PRODUCT_REFERRALS);
  writeStored(LINKS_KEY, JSON.stringify(next));
}

/** The product links to send with an order. */
export function productLinks(now = new Date()): { productId: string; code: string }[] {
  return readLinks(now).map(({ productId, code }) => ({ productId, code }));
}
