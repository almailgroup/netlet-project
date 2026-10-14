/**
 * The shopper's own account: a home, and one page per section.
 *
 * It was one page carrying fifteen sections — orders, messages, help, reviews,
 * wishlists, price requests, points, the affiliate programme, selling, the
 * profile, addresses, preferences, activity and signing out — 7,000px tall on
 * a laptop and 8,300px on a phone, where there was no menu at all. Somebody
 * who came to change a password scrolled past every parcel they had ever
 * ordered to find it.
 *
 * Now `/account` is a short page of tiles, grouped by what somebody came to do,
 * each saying in one line what it holds and, where there is one, what is
 * waiting ("1 on the way", "2 unread"). A tile opens `/account/<section>`,
 * which is that section alone: beside a menu of all of them on a wide screen,
 * under a way back on a phone. The sections themselves are the components they
 * always were; only the page around them changed.
 *
 * It wears the shop's own header, tab bar and footer now. It kept a bare
 * "settings page" header of its own, which took the search, the cart and the
 * phone's tab bar away the moment somebody looked at their orders.
 *
 * The old in-page addresses still land: `/account#orders` is answered with
 * `/account/orders`, so a link in an old email or a bookmark is not a dead end.
 */
import { AccountAffiliate } from "@/components/account/AccountAffiliate";
import { useAuth } from "@/hooks/useAuth";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PixelDot } from "@/components/ui/PixelBadge";
import { ProfileManager } from "@/components/account/ProfileManager";
import { AccountIdentity, initialsFor } from "@/components/account/AccountIdentity";
import { AccountPreferences } from "@/components/account/AccountPreferences";
import { AddressBook } from "@/components/account/AddressBook";
import { AccountSubscriptions } from "@/components/account/AccountSubscriptions";
import { AccountSupport } from "@/components/account/AccountSupport";
import { MembershipCard } from "@/components/account/MembershipCard";
import { AccountOffers } from "@/components/account/AccountOffers";
import { AccountRewards } from "@/components/account/AccountRewards";
import { SellerMode } from "@/components/account/SellerMode";
import { AccountOrders } from "@/components/account/AccountOrders";
import { AccountMessages } from "@/components/account/AccountMessages";
import { WishlistManager } from "@/components/account/WishlistManager";
import { AccountReviews } from "@/components/account/AccountReviews";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { AuthScreen } from "@/components/auth/AuthScreen";
import type { AuthMode } from "@/components/auth/AuthForm";
import { DEMO_MODE } from "@/lib/demoMode";
import { PageBody, PageHeading, TITLE } from "@/components/layout/Page";
import { useEffect, useState, type ComponentType } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useFeature } from "@/hooks/useFeature";
import { useAccountSignals } from "@/hooks/useAccountSignals";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import {
  ArrowLeft,
  ChevronRight,
  Gift,
  Heart,
  LifeBuoy,
  LogOut,
  MapPin,
  Megaphone,
  MessageCircle,
  Package,
  Repeat,
  SlidersHorizontal,
  Star,
  Store,
  Tag,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useLocation, useRoute } from "wouter";

type Group = "shopping" | "conversations" | "rewards" | "settings";

type Entry = {
  id: string;
  label: MessageKey;
  hint: MessageKey;
  icon: ComponentType<{ className?: string }>;
  group: Group;
  /** Somewhere else on the site rather than a section here. */
  href?: string;
};

/**
 * Every section, in the order the home and the menu show them. One list, so
 * the two cannot disagree about what exists or where it sits.
 */
const ENTRIES: Entry[] = [
  { id: "orders", label: "account.sectionOrders", hint: "account.hint.orders", icon: Package, group: "shopping" },
  { id: "subscriptions", label: "subscriptions.section", hint: "account.hint.subscriptions", icon: Repeat, group: "shopping" },
  { id: "saved", label: "footer.savedItems", hint: "account.hint.saved", icon: Heart, group: "shopping", href: "/saved" },
  { id: "wishlists", label: "account.sectionWishlists", hint: "account.hint.wishlists", icon: Gift, group: "shopping" },
  { id: "offers", label: "offers.mine", hint: "account.hint.offers", icon: Tag, group: "shopping" },
  { id: "reviews", label: "account.sectionReviews", hint: "account.hint.reviews", icon: Star, group: "shopping" },
  { id: "messages", label: "chat.sectionMessages", hint: "account.hint.messages", icon: MessageCircle, group: "conversations" },
  { id: "help", label: "support.section", hint: "account.hint.help", icon: LifeBuoy, group: "conversations" },
  { id: "rewards", label: "account.sectionRewards", hint: "account.hint.rewards", icon: Users, group: "rewards" },
  { id: "affiliate", label: "affiliate.section", hint: "account.hint.affiliate", icon: Megaphone, group: "rewards" },
  { id: "details", label: "account.sectionProfile", hint: "account.hint.details", icon: UserRound, group: "settings" },
  { id: "addresses", label: "address.book", hint: "account.hint.addresses", icon: MapPin, group: "settings" },
  { id: "preferences", label: "account.sectionPreferences", hint: "account.hint.preferences", icon: SlidersHorizontal, group: "settings" },
  { id: "selling", label: "account.sectionSelling", hint: "account.hint.selling", icon: Store, group: "settings" },
];

const GROUPS: { id: Group; label: MessageKey }[] = [
  { id: "shopping", label: "account.groupShopping" },
  { id: "conversations", label: "account.groupConversations" },
  { id: "rewards", label: "account.groupRewards" },
  { id: "settings", label: "account.groupSettings" },
];

/** What each section draws. The profile needs the user, so it takes it. */
function SectionBody({ id, user }: { id: string; user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  switch (id) {
    case "orders": return <AccountOrders />;
    case "subscriptions": return <AccountSubscriptions />;
    case "wishlists": return <WishlistManager />;
    case "offers": return <AccountOffers />;
    case "reviews": return <AccountReviews />;
    case "messages": return <AccountMessages />;
    case "help": return <AccountSupport />;
    case "rewards": return <AccountRewards />;
    case "affiliate": return <AccountAffiliate />;
    case "details": return <ProfileManager user={user} />;
    case "addresses": return <AddressBook />;
    case "preferences": return <AccountPreferences />;
    case "selling": return <SellerMode />;
    default: return null;
  }
}

export default function Account() {
  usePageMeta(privatePageMeta("Your account"));
  const [guestMode, setGuestMode] = useState<AuthMode>("signin");
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { t } = useTranslation();
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const [onSection, params] = useRoute("/account/:section");
  const signals = useAccountSignals();

  /*
   * Whether this account also sells (3.4.17). Asked of the server rather than
   * inferred from anything the client holds, cached hard because it only
   * changes when an administrator adds somebody to a store, and `retry: false`
   * because a shopper's 403 here is the ordinary answer, not a failure. Gated
   * on being signed in: this page is reachable signed out, and a refused
   * request on every guest visit is how a real failure gets lost among ones
   * that were expected.
   */
  const me = trpc.inventory.me.useQuery(undefined, { enabled: isAuthenticated, staleTime: 10 * 60 * 1000, retry: false });
  const isSeller = Boolean(me.data && me.data.kind !== "customer");
  /*
   * Subscribe & Save and the affiliate programme are switched off until there
   * is something behind them. Off, the section is offered only to somebody who
   * already has a standing order or an affiliate account — a switch closes the
   * door, it does not hide what a shopper already holds.
   */
  const subscriptionsOn = useFeature("subscriptions");
  const affiliatesOn = useFeature("affiliates");
  const mySubscriptions = trpc.subscriptions.mine.useQuery(undefined, { enabled: isAuthenticated && !subscriptionsOn });
  const myAffiliate = trpc.affiliates.mine.useQuery(undefined, { enabled: isAuthenticated && !affiliatesOn });
  const hidden = new Set<string>();
  if (!isSeller) hidden.add("selling");
  if (!subscriptionsOn && !(mySubscriptions.data?.length)) hidden.add("subscriptions");
  if (!affiliatesOn && !myAffiliate.data) hidden.add("affiliate");
  const entries = ENTRIES.filter(entry => !hidden.has(entry.id));

  /* What is waiting, said on the tile and in the menu. */
  const badge = (id: string): string | null => {
    if (id === "orders" && signals.onTheWay) return t("header.onTheWay", { count: signals.onTheWay });
    if (id === "messages" && signals.unreadMessages) return t("header.unreadCount", { count: signals.unreadMessages });
    if (id === "help" && signals.unreadSupport) return t("header.unreadCount", { count: signals.unreadSupport });
    return null;
  };

  /* An old in-page address — a footer link, an email, a bookmark — opens its section. */
  useEffect(() => {
    if (onSection) return;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash && ENTRIES.some(entry => entry.id === hash && !entry.href)) navigate(`/account/${hash}`, { replace: true });
  }, [onSection, navigate]);

  const section = onSection ? entries.find(entry => entry.id === params?.section && !entry.href) ?? null : null;
  /* A section this account does not have — typed in, or from somebody else's link — is the home. */
  const settled = !loading && !me.isLoading;
  useEffect(() => {
    if (onSection && settled && isAuthenticated && !section) navigate("/account", { replace: true });
  }, [onSection, settled, isAuthenticated, section, navigate]);


  return (
    <PageBody>
      {/* Signing out costs a password to undo, so it asks — the same
          treatment anything with a real cost gets. */}
      <ConfirmDialog
        open={signOutOpen}
        tone="danger"
        icon={<LogOut className="size-5" />}
        title={t("account.signOutTitle")}
        body={t("account.signOutBody")}
        confirmLabel={t("header.signOut")}
        pending={signingOut}
        onClose={() => setSignOutOpen(false)}
        onConfirm={async () => {
          setSigningOut(true);
          try {
            await logout();
            toast.success(t("header.signedOut"));
            setSignOutOpen(false);
            navigate("/account");
          } finally {
            setSigningOut(false);
          }
        }}
      />

        {loading ? (
          <div className="space-y-3" aria-hidden>
            <div className="h-9 w-56 animate-pulse rounded-xl bg-[#e7edf5]" />
            <div className="h-28 animate-pulse rounded-2xl bg-[#e7edf5]" />
          </div>
        ) : !isAuthenticated || !user ? (
          /* Signed out, the account page is the form itself rather than a
             panel with two buttons opening it — one press fewer, and the
             "Create account" button that opened on signing in has gone with it. */
          <>
            <h1 className="sr-only">{t("account.yourWay")}</h1>
            {DEMO_MODE ? (
              <p role="note" className="mx-auto mb-6 max-w-[1080px] rounded-xl border border-[#e3e1d9] bg-white px-4 py-3 text-[14px] text-[#3d5170]">
                <strong className="text-[#0a285a]">{t("header.signInDisabled")}</strong> {t("header.signInDisabledNote")}
              </p>
            ) : null}
            <AuthScreen mode={guestMode} onModeChange={setGuestMode} heading="h2" />
          </>
        ) : section ? (
          <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-10">
            <SideMenu user={user} entries={entries} current={section.id} badge={badge} onSignOut={() => setSignOutOpen(true)} />
            <div className="min-w-0">
              {/* A phone has no side menu, so the way back is the first thing on the page. */}
              <Link href="/account" className="mb-4 inline-flex items-center gap-1.5 rounded-full py-1 text-[14px] font-semibold text-[#536b8c] hover:text-[#0a285a] lg:hidden">
                <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
                {t("account.backToAccount")}
              </Link>
              {/* The page is the account and this is one part of it, which is
                  also what keeps the cards' own h3s one level below a heading. */}
              <h1 className="sr-only">{t("account.backToAccount")}</h1>
              <h2 className={TITLE}>{t(section.label)}</h2>
              <p className="mt-2 max-w-prose text-[15px] leading-7 text-[#404553]">{t(section.hint)}</p>
              <div className="mt-6 sm:mt-8">
                <SectionBody id={section.id} user={user} />
              </div>
            </div>
          </div>
        ) : (
          <div className="max-w-5xl">
            <PageHeading title={user.name ? t("account.welcomeBackName", { name: user.name }) : t("account.welcomeBack")} />
            <div className="space-y-4">
              <AccountIdentity user={user} />
              {/* Only for a member (4.1): nobody can buy one yet. */}
              <MembershipCard />
            </div>

            {GROUPS.map(group => {
              const items = entries.filter(entry => entry.group === group.id);
              if (!items.length) return null;
              return (
                <section key={group.id} aria-labelledby={`account-group-${group.id}`} className="mt-8">
                  <h2 id={`account-group-${group.id}`} className="text-[15px] font-bold text-[#0a285a]">{t(group.label)}</h2>
                  <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map(entry => (
                      <li key={entry.id}>
                        <Tile entry={entry} badge={badge(entry.id)} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            <div className="mt-10 border-t border-[#e6e9ef] pt-6">
              <button
                type="button"
                onClick={() => setSignOutOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-[#e6e9ef] bg-white px-4 py-2.5 text-[14px] font-semibold text-[#8c2f22] hover:border-[#f2b69e] hover:bg-[#fdf5f3]"
              >
                <LogOut className="size-4" aria-hidden />
                {t("header.signOut")}
              </button>
            </div>
          </div>
        )}
    </PageBody>
  );
}

/**
 * One way into the account: an icon, what it is, one line on what it holds,
 * and what is waiting there when anything is.
 */
function Tile({ entry, badge }: { entry: Entry; badge: string | null }) {
  const { t } = useTranslation();
  const Icon = entry.icon;
  return (
    <Link
      href={entry.href ?? `/account/${entry.id}`}
      className="group flex h-full items-center gap-3.5 rounded-2xl border border-[#e6e9ef] bg-white p-4 transition-colors hover:border-[#c9d6e6] hover:bg-[#f0f2f5]"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#eef2f8] text-[#0a285a]">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-bold text-[#0a285a]">{t(entry.label)}</span>
          {badge ? <span className="rounded-full bg-[#f2683a] px-2 py-0.5 text-[11px] font-bold text-[#0a285a]">{badge}</span> : null}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug ink-muted">{t(entry.hint)}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-[#8aa0bd] transition-colors group-hover:text-[#0a285a] rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

/**
 * The account's menu beside a section, on a wide screen: who is signed in,
 * every section by group, and signing out at the foot.
 */
function SideMenu({ user, entries, current, badge, onSignOut }: {
  user: NonNullable<ReturnType<typeof useAuth>["user"]>;
  entries: Entry[];
  current: string;
  badge: (id: string) => string | null;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="sticky top-[100px] hidden lg:block">
      <Link href="/account" className="flex items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-3 hover:border-[#c9d6e6] hover:bg-[#f0f2f5]">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0a285a] text-[14px] font-bold text-white">{initialsFor(user)}</span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-bold"><bdi>{user.name?.trim() || t("account.noName")}</bdi></span>
          <span className="block truncate text-[12px] ink-muted"><bdi dir="ltr">{user.email}</bdi></span>
        </span>
      </Link>
      <nav aria-label={t("account.menu")} className="mt-5 space-y-5">
        {GROUPS.map(group => {
          const items = entries.filter(entry => entry.group === group.id);
          if (!items.length) return null;
          return (
            <div key={group.id}>
              <p className="px-3 text-[12px] font-semibold ink-muted">{t(group.label)}</p>
              <ul className="mt-1.5 space-y-0.5">
                {items.map(entry => {
                  const Icon = entry.icon;
                  const active = entry.id === current;
                  const waiting = badge(entry.id);
                  return (
                    <li key={entry.id}>
                      <Link
                        href={entry.href ?? `/account/${entry.id}`}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition-colors ${active ? "bg-[#0a285a] font-semibold text-white" : "font-medium text-[#3d5170] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]"}`}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t(entry.label)}</span>
                        {waiting ? <PixelDot className="shrink-0" label={waiting} /> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <button type="button" onClick={onSignOut} className="mt-5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] font-medium text-[#8c2f22] hover:bg-[#fdf5f3]">
        <LogOut className="size-4" aria-hidden />
        {t("header.signOut")}
      </button>
    </aside>
  );
}

