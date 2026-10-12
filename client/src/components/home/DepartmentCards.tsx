/**
 * The departments, as large cards — the first thing on the home page.
 *
 * They replace a navy hero that said "Small upgrades. A brighter everyday."
 * over blurred colour blobs and an abstract illustration: a slogan where a
 * shopper looks for something to tap, and the clearest sign the page had come
 * out of a template. The marketplaces people here use every day open on their
 * departments as pictures, big enough to hit with a thumb, and so does this.
 *
 * **The art is a file per department**, `client/public/departments/<slug>.webp`,
 * so a picture is replaced by dropping a file with the same name — no code
 * change. Each is a few of the department's typical goods as soft, rounded 3D
 * renders in their natural colours, on a transparent background, trimmed to
 * the objects and fitted into the same 480 × 360 frame so no card's picture
 * looks bigger than its neighbours'. About 25 KB each; they are the page's
 * first paint, so they load eagerly.
 *
 * Every card is a link, so it can be opened in a new tab. "All departments"
 * comes last, where a shopper who did not find theirs looks next.
 */
import { useTranslation } from "@/hooks/useTranslation";
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
  return (
    <section id="main" aria-labelledby="departments-title" className="container pt-4 sm:pt-6">
      <h2 id="departments-title" className="sr-only">{t("home.shopByCategory")}</h2>
      <ul className="grid grid-cols-3 gap-2.5 sm:gap-4 lg:grid-cols-6">
        {CARDS.map(card => (
          <li key={card.slug}>
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
