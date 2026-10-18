/**
 * The picture beside a department name.
 *
 * Requirement 3.1.12 asks for icons "for easy visual recognition", and the
 * home page already had icons — chosen by **position in the array**, through a
 * nested ternary on the map index. So Electronics got a sparkle, Home &
 * Kitchen got a shop front, and Style got `ArrowDownRight`: a directional
 * arrow, the same glyph drawn two lines below as the "browse" chevron. Every
 * merchant-added department past the sixth got a shopping bag. That is
 * decoration bound to array order, and reordering the list silently reassigned
 * all of it — the opposite of recognition.
 *
 * The choice now lives on the department itself, in
 * `Shared/commerce/departments.ts`, as a name of what the icon *depicts*. This
 * is the only place that turns one of those names into a drawing, so the four
 * surfaces that show a department cannot disagree about it.
 *
 * **It is always `aria-hidden`.** The icon sits beside the department's own
 * name everywhere it appears, so announcing it would read the department
 * twice. An icon that repeats its label is noise to a screen reader, and one
 * that replaces a label is a control with no name at all — this is neither.
 */
import { Carrot, CookingPot, Flower2, LayoutGrid, Plug, Shirt, Tag, type LucideIcon } from "lucide-react";
import { departmentIcon, type DepartmentIcon as IconName } from "@shared/commerce/departments";

/*
 * The union is closed, so this record is exhaustive by construction: adding an
 * icon name without a drawing is a type error rather than a blank square.
 */
const DRAWINGS: Record<IconName, LucideIcon> = {
  plug: Plug,
  "cooking-pot": CookingPot,
  flower: Flower2,
  shirt: Shirt,
  carrot: Carrot,
  grid: LayoutGrid,
  tag: Tag,
};

export function DepartmentIcon({ query, className = "size-4" }: { query: string; className?: string }) {
  const Drawing = DRAWINGS[departmentIcon(query)];
  return <Drawing className={className} aria-hidden />;
}
