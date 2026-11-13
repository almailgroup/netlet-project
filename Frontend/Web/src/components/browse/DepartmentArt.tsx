/**
 * A department's picture, wherever a department is drawn large — the home
 * page's cards, the Categories tiles, the search's department tiles and the
 * portal's picture desk.
 *
 * Its own art (`Frontend/Web/public/departments/<slug>.webp`) where the
 * department has its pictures (`Department.art`); for one added before its
 * pictures arrived, its icon in navy on its own tint, a rounded square in the
 * middle of the same frame, so the row reads as a set while it waits and no
 * file that is not there is ever asked for. `"all"` always has its art.
 *
 * **Always `aria-hidden`**: it sits beside the department's own name, which
 * is what a screen reader says.
 */
import { appPath } from "@/lib/basePath";
import { DepartmentIcon } from "@/components/browse/DepartmentIcon";
import { DEPARTMENTS } from "@shared/commerce/departments";

export function DepartmentArt({ slug, className = "", eager = false }: {
  slug: string;
  /** Sizes the frame: the picture, or the square the icon is drawn in the middle of. */
  className?: string;
  /** The page's first paint (the home page's cards), fetched at once. */
  eager?: boolean;
}) {
  const department = DEPARTMENTS.find(entry => entry.slug === slug);
  if (slug === "all" || department?.art) {
    return (
      <img
        src={appPath(`/departments/${slug}.webp`)}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        width={480}
        height={360}
        className={`object-contain ${className}`}
      />
    );
  }
  return (
    <span aria-hidden className={`grid place-items-center ${className}`}>
      <span
        className="grid aspect-square h-[82%] max-h-full place-items-center rounded-[26%]"
        style={{ background: department?.tint ?? "#eef1f6" }}
      >
        <DepartmentIcon query={department?.name ?? slug} className="size-[46%] text-[#0a285a]" strokeWidth={1.6} />
      </span>
    </span>
  );
}
