/**
 * Which departments have something on sale, for the navigation to leave out
 * the ones that do not.
 *
 * Beauty, Style and Grocery sat in the header, the phone's department sheet and
 * the footer with nothing behind them — a link that leads to "nothing here
 * yet" is a dead end that looks like an open shop. A department with no
 * products is dropped from those (the home page's six cards stay, on the
 * owner's word); its page still answers its address with
 * its own name and an empty state, because a link already shared must not 404.
 *
 * Until the counts arrive every department is shown, so the bar does not start
 * empty and fill in.
 */
import { DEPARTMENTS } from "@shared/commerce/departments";
import { trpc } from "@/lib/trpc";

export function useDepartmentsInStock(): (departmentName: string) => boolean {
  const counts = trpc.commerce.departmentCounts.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  return (departmentName: string) => {
    if (!counts.data) return true;
    const slug = slugFor(departmentName);
    return slug === null || (counts.data[slug] ?? 0) > 0;
  };
}

/** NetLet's slug for one of its own departments; null for "All" and a merchant's own type, which are always shown. */
function slugFor(name: string): string | null {
  return DEPARTMENTS.find(entry => entry.name === name)?.slug ?? null;
}
