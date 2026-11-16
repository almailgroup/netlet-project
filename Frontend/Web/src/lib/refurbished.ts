/**
 * The refurbished section's addresses, on the owner's word ("a section for
 * used products, completely separate from the new products"):
 * `/refurbished` for all of it and `/refurbished/<department>` for one
 * department, the new shop's `/category/<slug>` beside it. The department
 * page draws both (`Category.tsx`), over the refurbished shelf alone.
 */
export const REFURBISHED_PATH = "/refurbished";

/** The section, or one department of it ("all" is the whole section). */
export function refurbishedPath(slug: string | null | undefined): string {
  return !slug || slug === "all" ? REFURBISHED_PATH : `${REFURBISHED_PATH}/${encodeURIComponent(slug)}`;
}

/** Whether an address is in the refurbished section. */
export function inRefurbished(location: string): boolean {
  return location === REFURBISHED_PATH || location.startsWith(`${REFURBISHED_PATH}/`);
}
