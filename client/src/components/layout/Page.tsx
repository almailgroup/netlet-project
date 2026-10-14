/**
 * The one page template every shopping page is drawn from.
 *
 * The pages had drifted into seven: titles at 17, 24, 26, 30 and 36 pixels;
 * the first line of a page anywhere from 89 to 235 pixels under the header;
 * some columns centred in the window and some at its edge, so a page's title
 * jumped sideways from the logo's line as somebody moved between them; four
 * different "nothing here" boxes; and an orange eyebrow over one heading. Each
 * was a small decision and together they made every page read as a different
 * site. So there is one of each here, and a page picks from it:
 *
 * - `PageBody` — the container, with the same room above and below on every
 *   page. Its column always starts at the header's logo line; a reading page
 *   (`width="reading"`) is narrower, never moved to the middle.
 * - `PageHeading` — the page's `h1` at one size, an optional line under it,
 *   and room for the page's own actions at its end.
 * - `Breadcrumbs` — one look for the trail on the pages that have one.
 * - `EmptyState` — one card for "nothing here yet", with the next step.
 * - `CARD` — the white surface with a hairline every panel is drawn on.
 */
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";

/** A panel on the page: white, a hairline, the one radius. */
export const CARD = "rounded-2xl border border-[#e6e9ef] bg-white";

/** The space round every page's content, the same on every page. */
export const PAGE_SPACE = "pb-12 pt-6 sm:pb-16 sm:pt-8";

const WIDTH = {
  /* A grid, a bag, a product: the whole container. */
  wide: "",
  /* Prose and forms: a line short enough to read, at the logo's edge. */
  reading: "max-w-4xl",
} as const;

export function PageBody({ width = "wide", className = "", children }: {
  width?: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`container flex-1 ${PAGE_SPACE} ${className}`}>
      <div className={WIDTH[width]}>{children}</div>
    </div>
  );
}

/** The page's title, at the one size every page uses. */
export const TITLE = "text-[24px] font-extrabold leading-tight tracking-[-.01em] text-[#0a285a] sm:text-[30px]";

export function PageHeading({ title, note, actions, id }: {
  title: ReactNode;
  note?: ReactNode;
  /** The page's own controls, at the end of the title's line. */
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-8">
      <div className="min-w-0">
        <h1 id={id} className={TITLE}>{title}</h1>
        {note ? <div className="mt-2 max-w-prose text-[15px] leading-7 text-[#404553]">{note}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * Where the page sits, from Home. The last step is the page itself and is not
 * a link. A merchant's words are isolated, so a Latin product name on the
 * Arabic page stays on its own side of the arrows.
 */
export function Breadcrumbs({ trail }: { trail: { label: ReactNode; href?: string }[] }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.breadcrumb")} className="mb-3 min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1.5 text-[13px] ink-muted">
        <li><Link href="/" className="py-1.5 hover:text-[#0a285a]">{t("nav.home")}</Link></li>
        {trail.map((step, index) => (
          <li key={index} className="flex min-w-0 items-center gap-x-1.5">
            <ChevronRight className="size-3.5 shrink-0 rtl:-scale-x-100" aria-hidden />
            {step.href
              ? <Link href={step.href} className="py-1.5 hover:text-[#0a285a]">{step.label}</Link>
              : <span aria-current="page" className="truncate text-[#404553]"><bdi>{step.label}</bdi></span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Nothing here yet — an empty bag, nothing saved, a page that is not there —
 * said the same way everywhere: an icon, a sentence, and what to do next.
 */
export function EmptyState({ icon, title, note, children, heading = "h2" }: {
  icon: ReactNode;
  title: ReactNode;
  note?: ReactNode;
  /** The way onward: a button or two. */
  children?: ReactNode;
  heading?: "h1" | "h2" | "h3";
}) {
  const Heading = heading;
  return (
    <div className={`${CARD} flex flex-col items-center px-6 py-12 text-center sm:py-16`}>
      <span className="grid size-14 place-items-center rounded-full bg-[#eef2f8] text-[#0a285a]" aria-hidden>{icon}</span>
      <Heading className="mt-5 text-lg font-extrabold text-[#0a285a]">{title}</Heading>
      {note ? <p className="mx-auto mt-2 max-w-md text-[15px] leading-7 text-[#404553]">{note}</p> : null}
      {children ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div> : null}
    </div>
  );
}

/** The primary and the plain button, as the empty states and the page actions draw them. */
export const BUTTON_PRIMARY = "glass glass-navy pressable inline-flex h-11 items-center justify-center gap-2 rounded-full px-5";
export const BUTTON_PLAIN = "glass pressable inline-flex h-11 items-center justify-center gap-2 rounded-full px-5";
