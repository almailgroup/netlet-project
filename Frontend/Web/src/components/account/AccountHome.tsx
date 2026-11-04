/**
 * `/account`'s home, drawn the way the delivery apps people here use draw
 * theirs, on the owner's word (a picture of one): who is signed in with a
 * pencil to change it, two tiles showing the last things ordered and saved,
 * the points balance, then the sections as rows in white cards — an icon, a
 * name and a chevron, dashed lines between them. Signing out is the last row
 * of the last card, red, and still asks first.
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
 * **Help is the help centre's row, and the affiliate programme is the card
 * at the top, on the owner's word** — each was on the page twice. "Help from
 * NetLet" went: the help centre's "Message NetLet" opens the same
 * conversation, and an answer from NetLet is a notice under the bell, which
 * opens it too. The affiliate row went: the card above the rows offers
 * joining to somebody not in and opens the programme for a member.
 *
 * **Only the rows somebody needs, on the owner's word** ("I only want the
 * options that are 100 percent needed"). Returns and Payment methods joined
 * the first card; Price requests and Subscribe & Save are rows only for
 * somebody who has one, since for everybody else they open an empty page.
 *
 * **Account information and the quick settings lead, on the owner's word**
 * ("organize the customer's personal information and clearly display name,
 * email and phone"; "country, currency and language clearly visible and
 * directly accessible, rather than hidden inside Preferences"). The first
 * card names the shopper, the email and the phone (or offers to add one),
 * with the pencil to change them; `QuickSettings` follows it, each of its
 * three rows changed where it is drawn, and Preferences keeps the delivery
 * area and the notices.
 *
 * The tiles' pictures are what was ordered (`orders.list`'s own photos, the
 * newest orders first) and what was saved (`useProductsByIds`, the hearts in
 * the order given), at most four each; nothing yet is said in words rather
 * than drawn as empty boxes.
 */
import { ProfileAvatar } from "@/components/account/ProfileAvatar";
import { PANEL } from "@/components/account/profileParts";
import { MembershipCard } from "@/components/account/MembershipCard";
import { Thumb } from "@/components/product/Thumb";
import { PointsCoin } from "@/components/ui/PointsCoin";
import { CountBadge } from "@/components/ui/CountBadge";
import { QuickSettings } from "@/components/account/QuickSettings";
import { formatPhone } from "@shared/commerce/wishlist";
import { useFeature } from "@/hooks/useFeature";
import { formatCount } from "@/lib/format";
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
  CreditCard,
  Gift,
  History,
  LifeBuoy,
  ListRestart,
  LogOut,
  MapPin,
  Megaphone,
  PackageSearch,
  Pencil,
  Repeat,
  RotateCcw,
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
type Row = {
  id: string;
  label: MessageKey;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Where the row goes when it is not a section of the account. */
  href?: string;
};

/*
 * The cards, top to bottom: what somebody shops with, their settings and
 * help, what they run, and the account itself. "signout" is the one row that
 * is not a section. Price requests and Subscribe & Save are rows only while
 * the shopper has one (`has`); the language and the currency are inside
 * Preferences, whose row names both.
 */
const CARDS: Row[][] = [
  [
    { id: "frequent", label: "frequent.section", icon: ListRestart },
    { id: "returns", label: "account.sectionReturns", icon: RotateCcw },
    { id: "addresses", label: "address.book", icon: MapPin },
    { id: "payments", label: "account.sectionPayments", icon: CreditCard },
    { id: "wishlists", label: "account.sectionWishlists", icon: Gift },
    { id: "reviews", label: "account.sectionReviews", icon: Star },
    { id: "offers", label: "offers.mine", icon: Tag },
    { id: "subscriptions", label: "subscriptions.section", icon: Repeat },
  ],
  [
    { id: "preferences", label: "account.sectionPreferences", icon: SlidersHorizontal },
    { id: "helpCentre", label: "footer.helpCentre", icon: LifeBuoy, href: "/help" },
    /* Less prominent than the home's own shelf, on the owner's word. */
    { id: "history", label: "history.title", icon: History },
  ],
  [
    { id: "security", label: "account.security", icon: ShieldCheck },
    { id: "signout", label: "header.signOut", icon: LogOut },
  ],
];

const ICON = "size-[22px] shrink-0 text-[#5d6b82]";
const CHEVRON = "size-5 shrink-0 text-[#1f2a44] rtl:-scale-x-100";

export function AccountHome({ user, has, badge, onSignOut }: {
  user: User;
  /** Whether the account has this section — the page's own list, hidden ones taken out. */
  has: (id: string) => boolean;
  badge: (id: string) => string | null;
  onSignOut: () => void;
}) {
  const { t, locale } = useTranslation();
  const signals = useAccountSignals();
  const details = trpc.customer.details.get.useQuery(undefined, { staleTime: 60_000 });
  const { savedIds } = useCustomer();
  const orders = trpc.orders.list.useQuery({ pageSize: 4 }, { staleTime: 60_000 });
  const saved = useProductsByIds(savedIds.slice(0, 4));
  const rewards = trpc.rewards.mine.useQuery(undefined, { staleTime: 60_000 });
  const affiliatesOn = useFeature("affiliates");
  const member = trpc.affiliates.code.useQuery(undefined, { enabled: affiliatesOn, staleTime: 5 * 60_000 });

  // Join for somebody the server says is not in; open for a member, or for
  // somebody whose account the page keeps while the switch is off.
  const affiliate: "join" | "open" | null = !has("affiliate")
    ? null
    : !affiliatesOn || member.data?.joined
      ? "open"
      : member.isSuccess
        ? "join"
        : null;

  const orderPhotos = [...new Set((orders.data?.rows ?? []).flatMap(row => row.summary?.photos ?? []))].slice(0, 4);
  const savedPhotos = saved.products.map(product => product.images[0]?.url ?? null).slice(0, 4);

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {/* The page's name and the notifications in its end corner, on the
          owner's word — the bell replaced the Notifications row, so what is
          unread is in sight before the first card. */}
      <div className="flex items-center justify-between gap-3 pb-1">
        <h1 className="text-[22px] font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-[26px]">{t("account.yourWay")}</h1>
        <Link
          href="/account/notifications"
          onClick={() => pressHaptic()}
          aria-label={signals.unreadNotices ? `${t("notices.menu")}, ${t("header.unreadCount", { count: signals.unreadNotices })}` : t("notices.menu")}
          title={t("notices.menu")}
          className="relative grid size-11 shrink-0 place-items-center rounded-full border border-[#e6e9ef] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"
        >
          <Bell className="size-[20px]" aria-hidden />
          <CountBadge value={signals.unreadNotices} className="absolute -end-1 -top-1" />
        </Link>
      </div>

      <section aria-label={t("account.yourWay")} className={`${PANEL} flex items-center gap-4 p-4 sm:p-5`}>
        {/* The photo the shopper chose, or their initials (`ProfileAvatar`). */}
        <ProfileAvatar user={user} size="size-16" textClass="text-[22px]" />
        <div className="min-w-0 flex-1">
          {/* Wraps rather than truncating: cut on an Arabic page, a Latin
              name lost its first letters, and it is what somebody reads to be
              sure the account is theirs. */}
          <p className="text-[18px] font-bold leading-snug text-[#0a285a] [overflow-wrap:anywhere]">
            <bdi>{user.name?.trim() || t("account.noName")}</bdi>
          </p>
          <p className="mt-0.5 truncate text-[14px] ink-muted"><bdi dir="ltr">{user.email}</bdi></p>
          {/* The phone the driver calls, saved under Your profile — or a way to add one. */}
          {details.data?.phone ? (
            <p className="mt-0.5 truncate text-[14px] ink-muted"><bdi dir="ltr">{formatPhone(details.data.phone).startsWith("+") ? formatPhone(details.data.phone) : `+965 ${formatPhone(details.data.phone)}`}</bdi></p>
          ) : details.isSuccess ? (
            <Link href="/account/details" className="mt-0.5 inline-block text-[14px] font-semibold text-[#0a285a] underline underline-offset-2">{t("account.addPhone")}</Link>
          ) : null}
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

      <QuickSettings />

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
        <PointsCoin size={26} />
        <span className="min-w-0 flex-1 text-[16px] font-medium text-[#1f2a44]">{t("account.points")}</span>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#f1f2f6] py-2 pe-2.5 ps-3.5 text-[15px] font-bold text-[#1f2a44]">
          {rewards.data ? t("rewards.balance", { points: formatCount(rewards.data.balance, locale) }) : "—"}
          <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </span>
      </Link>

      <SellerEntry />

      {/* Affiliate marketing is this card and no row, on the owner's word:
          joining for somebody not in, the programme for a member — or for
          somebody who holds an account while the switch is off, since a
          switch closes the door and never locks anybody in. Drawn once the
          server has answered, so it never says Join to a member. */}
      {affiliate ? (
        <Link href="/account/affiliate" className="flex items-center gap-4 overflow-hidden rounded-[1.35rem] bg-[#0a285a] p-4 text-white hover:bg-[#0d3372] sm:p-5">
          <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-white/10">
            <Megaphone className="size-6 text-[#ffab85]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-bold">{t("affiliate.section")}</span>
            <span className="mt-0.5 block text-[13px] leading-5 text-[#d6deea]">{t(affiliate === "join" ? "affiliate.promoBody" : "affiliate.promoMemberBody")}</span>
          </span>
          <span className="shrink-0 rounded-full bg-white px-3.5 py-2 text-[13px] font-bold text-[#0a285a]">{t(affiliate === "join" ? "affiliate.promoJoin" : "affiliate.promoOpen")}</span>
        </Link>
      ) : null}

      <nav aria-label={t("account.menu")} className="space-y-3">
        {CARDS.map((rows, index) => {
          const shown = rows.filter(row => row.id === "signout" || row.href || has(row.id));
          if (!shown.length) return null;
          return (
            <ul key={index} className={`${PANEL} divide-y divide-dashed divide-[#e3e6ec] px-5`}>
              {shown.map(row => (
                <li key={row.id}>
                  {row.id === "signout" ? (
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

/**
 * The seller portal's door, in plain sight (on the owner's word: "a clearly
 * visible entry … easy switching between the shopping and seller
 * experiences; users who are not sellers go to Become a Seller"). Somebody
 * who runs a store is named it and taken to the portal, which has its own way
 * back to the shop; anybody else is offered `/sell`. The server decides which
 * (`inventory.me`), so nobody is shown a door that refuses them.
 */
function SellerEntry() {
  const { t } = useTranslation();
  const me = trpc.inventory.me.useQuery(undefined, { staleTime: 10 * 60 * 1000, retry: false });
  const seller = Boolean(me.data && me.data.kind !== "customer");
  const store = trpc.inventory.myStore.useQuery(undefined, { enabled: me.data?.kind === "vendor", staleTime: 10 * 60 * 1000, retry: false });
  if (me.isPending) return null;
  return (
    <Link href={seller ? "/admin" : "/sell"} className={`${PANEL} flex items-center gap-4 p-4 hover:bg-[#f0f2f5] sm:p-5`}>
      <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-[#eef2f8] text-[#0a285a]">
        <Store className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold text-[#0a285a]">{t(seller ? "seller.cardTitle" : "seller.becomeTitle")}</span>
        <span className="mt-0.5 block text-[13px] leading-5 ink-muted">
          {seller
            ? t("seller.cardBody", { store: store.data?.name ? `\u2068${store.data.name}\u2069` : t("account.sellerPlatform") })
            : t("seller.becomeBody")}
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-[#0a285a] px-3.5 py-2 text-[13px] font-bold text-white">{t(seller ? "seller.open" : "seller.become")}</span>
    </Link>
  );
}

/** One section: its icon, its name, what is waiting there or what it is set to, and the way in. */
function RowLink({ row, waiting, value = null }: { row: Row; waiting: string | null; value?: string | null }) {
  const { t } = useTranslation();
  const Icon = row.icon;
  return (
    <Link href={row.href ?? `/account/${row.id}`} className="-mx-5 flex min-h-[64px] items-center gap-3.5 px-5 hover:bg-[#f0f2f5]">
      <Icon className={ICON} strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 text-[16px] font-medium text-[#1f2a44]">{t(row.label)}</span>
      {waiting ? <span className="shrink-0 rounded-full bg-[#f2683a] px-2 py-0.5 text-[12px] font-bold text-[#0a285a]">{waiting}</span> : null}
      {value ? <span className="shrink-0 text-[14px] ink-muted">{value}</span> : null}
      <ChevronRight className={CHEVRON} aria-hidden />
    </Link>
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
