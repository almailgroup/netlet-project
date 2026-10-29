/**
 * The departments, as large cards, directly under the front door
 * (`HomeHero`) and under a heading of their own.
 *
 * They replaced a navy hero that said "Small upgrades. A brighter everyday."
 * over blurred colour blobs: a slogan where a shopper looks for something to
 * tap. The front door above them now says what the shop is in one line and
 * goes somewhere; these stay what a shopper taps next, big enough for a thumb.
 * The tiles are white, all six alike — the owner's word: a colour per
 * department was tried in a mockup and declined.
 *
 * **The art is a file per department**, `Frontend/Web/public/departments/<slug>.webp`,
 * so a picture is replaced by dropping a file with the same name — no code
 * change. Each is a few of the department's typical goods as soft, rounded 3D
 * renders in their natural colours, on a transparent background, trimmed to
 * the objects and fitted into the same 480 × 360 frame so no card's picture
 * looks bigger than its neighbours'. About 25 KB each; they are the page's
 * first paint, so they load eagerly.
 *
 * Every card is a link, so it can be opened in a new tab. "All departments"
 * comes last, where a shopper who did not find theirs looks next.
 *
 * **They are one row that scrolls sideways, on the owner's word** — three to a
 * row on a phone made two rows of six tiles the whole first screen under the
 * front door. The row reaches the screen's edges on a phone, so the tile cut
 * off at the edge says there is more; a mouse gets the shelves' arrows
 * (`useSideScroll`, `ScrollArrows`), drawn only while something is off an end.
 *
 * **All six, always.** The header row, the phone's sheet and the footer leave
 * out a department with nothing on sale; these cards did too for a while, and
 * the home page opened on three tiles. The owner asked for the six back: they
 * are the shop's shape, and a department with nothing yet still answers its
 * page with its name and an empty state.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { useSideScroll } from "@/hooks/useSideScroll";
import { ScrollArrows } from "@/components/ui/ScrollArrows";
import { appPath } from "@/lib/basePath";
import { categorySlug } from "@shared/commerce/browse";
import { ALL_DEPARTMENTS, DEPARTMENTS } from "@shared/commerce/departments";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Link } from "wouter";

const CARDS: { slug: string; query: string; label: MessageKey }[] = [
  ...DEPARTMENTS.map(department => ({ slug: department.slug, query: department.name, label: department.label })),
  { slug: "all", query: ALL_DEPARTMENTS.query, label: ALL_DEPARTMENTS.label },
];

export function DepartmentCards() {
  const { t } = useTranslation();
  const cards = CARDS;
  const scroll = useSideScroll<HTMLUListElement>([cards.length]);
  const title = t("home.shopByCategory");
  return (
    <section aria-labelledby="departments-title" className="container pt-2 sm:pt-3">
      <div className="flex items-center justify-between gap-4">
        <h2 id="departments-title" className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{title}</h2>
        <ScrollArrows scroll={scroll} previousLabel={t("home.rowBack", { title })} nextLabel={t("home.rowOn", { title })} />
      </div>
      {/* One row that scrolls sideways, reaching the screen's edges on a
          phone so the next tile shows it is there; from `lg` the tiles share
          the row while they fit, and scroll once they do not. */}
      <ul
        ref={scroll.trackRef}
        className="hide-scrollbar -mx-4 mt-4 flex snap-x gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-1 pt-0.5 sm:mx-0 sm:scroll-px-0 sm:gap-4 sm:px-0"
      >
        {cards.map(card => (
          <li key={card.slug} className="w-[104px] shrink-0 snap-start min-[390px]:w-[112px] sm:w-[148px] lg:min-w-[150px] lg:flex-[1_0_0]">
            <Link
              href={`/category/${categorySlug(card.query)}`}
              className="group flex h-full flex-col items-center rounded-2xl border border-transparent bg-white px-2 pb-3 pt-2 shadow-[0_1px_2px_rgba(10,40,90,.06)] transition-colors hover:border-[#d5dfeb] hover:bg-[#f0f2f5] sm:rounded-[1.375rem] sm:px-3 sm:pb-4 sm:pt-3"
            >
              <img
                src={appPath(`/departments/${card.slug}.webp`)}
                alt=""
                loading="eager"
                decoding="async"
                width={480}
                height={360}
                className="aspect-[4/3] w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
              />
              <span className="mt-1.5 line-clamp-2 text-center text-[13px] font-bold leading-tight text-[#0a285a] sm:mt-2 sm:text-[15px]">
                {t(card.label)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
