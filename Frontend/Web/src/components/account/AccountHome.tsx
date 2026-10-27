/**
 * `/account`'s home, drawn the way the delivery apps people here use draw
 * theirs, on the owner's word (a picture of one): who is signed in with a
 * pencil to change it, two tiles showing the last things ordered and saved,
 * the points balance, then the sections as rows in white cards — an icon, a
 * name and a chevron, dashed lines between them — and the language as a
 * two-way switch in its own row. Signing out is the last row of the last
 * card, red, and still asks first.
 *
 * It was tiles in four headed groups, each with a line on what it held, under
 * a welcome heading and an identity card with the dates. The dates moved into
 * "Your profile" (`AccountIdentity`), where somebody checking their account
 * looks; the rows say what they are by their names.
 *
 * **Every row is a section the account has** (`entries`, the page's own list
 * with the hidden ones taken out), so a switched-off programme or a seller's
 * row never appears for somebody who cannot open it. Orders and Saved are the
 * tiles, the points are their own row, and everything else is a row: what
 * somebody shops with, what talks to them, what they run, then the account
 * itself. What is waiting is said on the row ("2 unread"), from
 * `useAccountSignals`, the header's own reader.
 *
 * **The language is here because the phone's bar no longer carries it** — the
 * delivery location took its place — and it is a setting that follows the
 * account between devices. Two buttons, each written in its own language, so
 * whichever one somebody reads is legible to them.
 *
 * The tiles' pictures are what was ordered (`orders.list`'s own photos, the
 * newest orders first) and what was saved (`useProductsByIds`, the hearts in
 * the order given), at most four each; nothing yet is said in words rather
 * than drawn as empty boxes.
 */
import { initialsFor } from "@/components/account/AccountIdentity";
import { MembershipCard } from "@/components/account/MembershipCard";
import { Thumb } from "@/components/product/Thumb";
import { useCustomer } from "@/contexts/CustomerContext";
import { useAccountSignals } from "@/hooks/useAccountSignals";
import { useProductsByIds } from "@/hooks/useCatalog";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import {
  Bell,
  ChevronRight,
  Coins,
  Gift,
  Languages,
  LifeBuoy,
  LogOut,
  MapPin,
  Megaphone,
  PackageSearch,
  Pencil,
  Repeat,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Store,
  Tag,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "wouter";

type User = { name: string | null; email: string };

/** A row's look: what it opens, its icon and its name. */
type Row = { id: string; label: MessageKey; icon: ComponentType<{ className?: string; strokeWidth?: number }> };

/*
 * The cards, top to bottom: what somebody shops with, what talks to them, what
 * they run, and the account itself. "language" and "signout" are the two rows
 * that are not sections.
 */
const CARDS: Row[][] = [
  [
    { id: "addresses", label: "address.book", icon: MapPin },
    { id: "wishlists", label: "account.sectionWishlists", icon: Gift },
    { id: "offers", label: "offers.mine", icon: Tag },
    { id: "reviews", label: "account.sectionReviews", icon: Star },
    { id: "subscriptions", label: "subscriptions.section", icon: Repeat },
    { id: "language", label: "account.language", icon: Languages },
  ],
  [
    { id: "preferences", label: "account.sectionPreferences", icon: SlidersHorizontal },
    { id: "notifications", label: "notices.title", icon: Bell },
    { id: "help", label: "support.section", icon: LifeBuoy },
  ],
  [
    { id: "affiliate", label: "affiliate.section", icon: Megaphone },
    { id: "selling", label: "account.sectionSelling", icon: Store },
  ],
  [
    { id: "details", label: "account.security", icon: ShieldCheck },
    { id: "signout", label: "header.signOut", icon: LogOut },
  ],
];

const PANEL = "rounded-3xl bg-white shadow-[0_1px_2px_rgba(10,40,90,.05)]";
const ICON = "size-[22px] shrink-0 text-[#5d6b82]";
const CHEVRON = "size-5 shrink-0 text-[#1f2a44] rtl:-scale-x-100";

export function AccountHome({ user, has, badge, onSignOut }: {
  user: User;
  /** Whether the account has this section — the page's own list, hidden ones taken out. */
  has: (id: string) => boolean;
  badge: (id: string) => string | null;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  const signals = useAccountSignals();
  const { savedIds } = useCustomer();
  const orders = trpc.orders.list.useQuery({ pageSize: 4 }, { staleTime: 60_000 });
  const saved = useProductsByIds(savedIds.slice(0, 4));
  const rewards = trpc.rewards.mine.useQuery(undefined, { staleTime: 60_000 });

  const orderPhotos = [...new Set((orders.data?.rows ?? []).flatMap(row => row.summary?.photos ?? []))].slice(0, 4);
  const savedPhotos = saved.products.map(product => product.images[0]?.url ?? null).slice(0, 4);

  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="sr-only">{t("account.yourWay")}</h1>

      <section aria-label={t("account.yourWay")} className={`${PANEL} flex items-center gap-4 p-4 sm:p-5`}>
        <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-[#f1f2f6] text-[22px] font-bold text-[#0a285a]">
          {initialsFor(user)}
        </span>
        <div className="min-w-0 flex-1">
          {/* Wraps rather than truncating: cut on an Arabic page, a Latin
              name lost its first letters, and it is what somebody reads to be
              sure the account is theirs. */}
          <p className="text-[18px] font-bold leading-snug text-[#0a285a] [overflow-wrap:anywhere]">
            <bdi>{user.name?.trim() || t("account.noName")}</bdi>
          </p>
          <p className="mt-0.5 truncate text-[14px] ink-muted"><bdi dir="ltr">{user.email}</bdi></p>
        </div>
        <Link
          href="/account/details"
          aria-label={t("account.editDetails")}
          title={t("account.editDetails")}
          className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-[#0a285a]/70 text-[#0a285a] hover:bg-[#0a285a]/[.06]"
        >
          <Pencil className="size-5" aria-hidden />
        </Link>
      </section>

      {/* Only for a member (4.1): nobody can buy one yet. */}
      <MembershipCard />

      <div className="grid grid-cols-2 gap-3">
        <PreviewTile
          href="/account/orders"
          title={t("account.myOrders")}
          photos={orderPhotos}
          loading={orders.isPending}
          empty={t("orders.emptyTitle")}
          waiting={signals.onTheWay ? t("header.onTheWay", { count: signals.onTheWay }) : null}
        />
        <PreviewTile
          href="/saved"
          title={t("footer.savedItems")}
          photos={savedPhotos}
          loading={saved.waiting}
          empty={t("saved.emptyTitle")}
          waiting={null}
        />
      </div>

      <Link href="/account/rewards" className={`${PANEL} flex min-h-[68px] items-center gap-3.5 px-5 py-3 hover:bg-[#f0f2f5]`}>
        <Coins className={ICON} strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 text-[16px] font-medium text-[#1f2a44]">{t("account.points")}</span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#f1f2f6] py-2 pe-2.5 ps-3.5 text-[15px] font-bold text-[#1f2a44]">
          {rewards.data ? t("rewards.balance", { points: rewards.data.balance }) : "—"}
          <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </span>
      </Link>

      <nav aria-label={t("account.menu")} className="space-y-3">
        {CARDS.map((rows, index) => {
          const shown = rows.filter(row => row.id === "language" || row.id === "signout" || has(row.id));
          if (!shown.length) return null;
          return (
            <ul key={index} className={`${PANEL} divide-y divide-dashed divide-[#e3e6ec] px-5`}>
              {shown.map(row => (
                <li key={row.id}>
                  {row.id === "language" ? (
                    <LanguageRow row={row} />
                  ) : row.id === "signout" ? (
                    <button type="button" onClick={onSignOut} className="-mx-5 flex min-h-[64px] w-[calc(100%+2.5rem)] items-center gap-3.5 px-5 text-start hover:bg-[#fdf5f3]">
                      <LogOut className="size-[22px] shrink-0 text-[#c2362a]" strokeWidth={1.75} aria-hidden />
                      <span className="min-w-0 flex-1 text-[16px] font-medium text-[#1f2a44]">{t(row.label)}</span>
                      <ChevronRight className={CHEVRON} aria-hidden />
                    </button>
                  ) : (
                    <RowLink row={row} waiting={badge(row.id)} />
                  )}
                </li>
              ))}
            </ul>
          );
        })}
      </nav>
    </div>
  );
}

/** One section: its icon, its name, what is waiting there, and the way in. */
function RowLink({ row, waiting }: { row: Row; waiting: string | null }) {
  const { t } = useTranslation();
  const Icon = row.icon;
  return (
    <Link href={`/account/${row.id}`} className="-mx-5 flex min-h-[64px] items-center gap-3.5 px-5 hover:bg-[#f0f2f5]">
      <Icon className={ICON} strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 text-[16px] font-medium text-[#1f2a44]">{t(row.label)}</span>
      {waiting ? <span className="shrink-0 rounded-full bg-[#f2683a] px-2 py-0.5 text-[12px] font-bold text-[#0a285a]">{waiting}</span> : null}
      <ChevronRight className={CHEVRON} aria-hidden />
    </Link>
  );
}

/**
 * The language, as a two-way switch: each choice written in its own language
 * and marked with it, so a screen reader says "العربية" in Arabic.
 */
function LanguageRow({ row }: { row: Row }) {
  const { t, locale } = useTranslation();
  const { setLocale } = useCustomer();
  const Icon = row.icon;
  return (
    <div className="flex min-h-[64px] items-center gap-3.5">
      <Icon className={ICON} strokeWidth={1.75} aria-hidden />
      <span id="account-language" className="min-w-0 flex-1 text-[16px] font-medium text-[#1f2a44]">{t(row.label)}</span>
      <div role="group" aria-labelledby="account-language" className="flex shrink-0 rounded-full bg-[#f1f2f6] p-1">
        {(["en", "ar"] as const).map(code => {
          const active = locale === code;
          return (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={active}
              onClick={() => {
                if (active) return;
                pressHaptic();
                setLocale(code);
              }}
              className={`min-h-10 rounded-full px-4 text-[15px] font-semibold transition-colors ${
                active ? "bg-white text-[#1f2a44] shadow-[0_1px_3px_rgba(10,40,90,.14)]" : "text-[#5d6b82] hover:bg-transparent hover:text-[#1f2a44]"
              }`}
            >
              {t(code === "en" ? "account.english" : "account.arabic")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A tile with a title and the last few pictures of what is in it — orders,
 * or saved things — or a line saying there is nothing yet.
 */
function PreviewTile({ href, title, photos, loading, empty, waiting }: {
  href: string;
  title: string;
  photos: (string | null)[];
  loading: boolean;
  empty: string;
  waiting: string | null;
}) {
  let body: ReactNode;
  if (photos.length) {
    body = (
      <div aria-hidden className="mt-3 flex">
        {photos.map((photo, index) => (
          <Thumb
            key={`${photo}-${index}`}
            src={photo}
            alt=""
            className="-me-[5.3%] aspect-[3/4] w-[29%] min-w-0 rounded-xl border-2 border-white bg-[#f4f6f9] object-contain last:me-0"
            icon={<PackageSearch className="size-4" />}
          />
        ))}
      </div>
    );
  } else if (loading) {
    body = <div aria-hidden className="mt-3 aspect-[4/1.3] animate-pulse rounded-xl bg-[#f1f2f6]" />;
  } else {
    body = <p className="mt-3 flex aspect-[4/1.3] items-center rounded-xl bg-[#f4f6f9] px-3 text-[13px] leading-snug ink-muted">{empty}</p>;
  }
  return (
    <Link href={href} className={`${PANEL} block p-3.5 hover:bg-[#f0f2f5] sm:p-4`}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[17px] font-bold text-[#0a285a]">{title}</span>
        {waiting ? <span className="rounded-full bg-[#f2683a] px-2 py-0.5 text-[12px] font-bold text-[#0a285a]">{waiting}</span> : null}
      </span>
      {body}
    </Link>
  );
}
