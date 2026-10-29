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
 * Now `/account` is a short page (`AccountHome`): who is signed in, the last
 * things ordered and saved, the points, and every section as a row, with what
 * is waiting said on it ("1 on the way", "2 unread"). A row opens
 * `/account/<section>`, which is that section alone under a round way back and
 * its name. The sections themselves are the components they always were; only
 * the page around them changed.
 *
 * **Every width draws the same column, centred, on the owner's word.** A wide
 * screen had the home at the page's start and each section beside a menu of
 * all of them — navy pills under group headings, the account's old look —
 * around cards in its new one. The column is the home's width (`COLUMN`) and
 * sits in the middle of the page, where every other page starts at the logo's
 * line: an account is read as one card, not browsed as a shelf.
 *
 * It wears the shop's own tab bar and footer, and its header on a wide screen;
 * a phone draws it with no header, on the owner's word (`StorefrontShell`).
 *
 * The old in-page addresses still land: `/account#orders` is answered with
 * `/account/orders`, so a link in an old email or a bookmark is not a dead end.
 */
import { AccountAffiliate } from "@/components/account/AccountAffiliate";
import { useAuth } from "@/hooks/useAuth";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProfileManager } from "@/components/account/ProfileManager";
import { AccountHome } from "@/components/account/AccountHome";
import { AccountIdentity } from "@/components/account/AccountIdentity";
import { AccountPreferences } from "@/components/account/AccountPreferences";
import { AddressBook } from "@/components/account/AddressBook";
import { AccountSubscriptions } from "@/components/account/AccountSubscriptions";
import { AccountSupport } from "@/components/account/AccountSupport";
import { AccountOffers } from "@/components/account/AccountOffers";
import { AccountRewards } from "@/components/account/AccountRewards";
import { SellerMode } from "@/components/account/SellerMode";
import { AccountOrders } from "@/components/account/AccountOrders";
import { AccountNotifications } from "@/components/account/AccountNotifications";
import { WishlistManager } from "@/components/account/WishlistManager";
import { AccountReviews } from "@/components/account/AccountReviews";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { AuthScreen } from "@/components/auth/AuthScreen";
import type { AuthMode } from "@/components/auth/AuthForm";
import { DEMO_MODE } from "@/lib/demoMode";
import { PageBody, TITLE } from "@/components/layout/Page";
import { useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useFeature } from "@/hooks/useFeature";
import { useAccountSignals } from "@/hooks/useAccountSignals";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowLeft, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Link, useLocation, useRoute } from "wouter";
import { cameFrom, goBack } from "@/lib/inAppBack";

type Entry = {
  id: string;
  label: MessageKey;
  hint: MessageKey;
  /** Somewhere else on the site rather than a section here. */
  href?: string;
};

/**
 * Every section. One list, so the home and a section's address cannot
 * disagree about what exists.
 */
const ENTRIES: Entry[] = [
  { id: "orders", label: "account.sectionOrders", hint: "account.hint.orders" },
  { id: "subscriptions", label: "subscriptions.section", hint: "account.hint.subscriptions" },
  { id: "saved", label: "footer.savedItems", hint: "account.hint.saved", href: "/saved" },
  { id: "wishlists", label: "account.sectionWishlists", hint: "account.hint.wishlists" },
  { id: "offers", label: "offers.mine", hint: "account.hint.offers" },
  { id: "reviews", label: "account.sectionReviews", hint: "account.hint.reviews" },
  { id: "notifications", label: "notices.title", hint: "notices.tile" },
  { id: "help", label: "support.section", hint: "account.hint.help" },
  { id: "rewards", label: "account.sectionRewards", hint: "account.hint.rewards" },
  { id: "affiliate", label: "affiliate.section", hint: "account.hint.affiliate" },
  { id: "details", label: "account.sectionProfile", hint: "account.hint.details" },
  { id: "addresses", label: "address.book", hint: "account.hint.addresses" },
  { id: "preferences", label: "account.sectionPreferences", hint: "account.hint.preferences" },
  { id: "selling", label: "account.sectionSelling", hint: "account.hint.selling" },
];

/** The account's one column: the home's width, in the middle of the page. */
const COLUMN = "mx-auto max-w-2xl";

/** What each section draws. The profile needs the user, so it takes it. */
function SectionBody({ id, user }: { id: string; user: NonNullable<ReturnType<typeof useAuth>["user"]> }) {
  switch (id) {
    case "orders": return <AccountOrders />;
    case "subscriptions": return <AccountSubscriptions />;
    case "wishlists": return <WishlistManager />;
    case "offers": return <AccountOffers />;
    case "reviews": return <AccountReviews />;
    case "notifications": return <AccountNotifications />;
    case "help": return <AccountSupport />;
    case "rewards": return <AccountRewards />;
    case "affiliate": return <AccountAffiliate />;
    case "details": return <div className="space-y-3"><ProfileManager user={user} /><AccountIdentity user={user} /></div>;
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
  /* The round arrow says where it goes: the account home when that is the
     page behind (or there is none in this visit), "Back" otherwise. */
  const from = cameFrom();
  const backLabel = !from || from.split("?")[0] === "/account" ? t("account.backToAccount") : t("nav.back");

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

  /* What is waiting, said on the home's rows. */
  const badge = (id: string): string | null => {
    if (id === "orders" && signals.onTheWay) return t("header.onTheWay", { count: signals.onTheWay });
    if (id === "notifications" && signals.unreadNotices) return t("header.unreadCount", { count: signals.unreadNotices });
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
          <div className={`${COLUMN} space-y-3`} aria-hidden>
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
          <div className={COLUMN}>
            {/* The page is the account and this is one part of it, which is
                also what keeps the cards' own h3s one level below a heading. */}
            <h1 className="sr-only">{t("account.backToAccount")}</h1>
            <div className="flex items-center gap-3">
              {/* Back to the page the section was opened from — the bell,
                  the heart, the account home — on the owner's word, rather
                  than forward to the account home, which put the section
                  behind it and made the phone's Back return to it. Opened
                  from nowhere in this visit, it opens the account home. */}
              <Link
                href="/account"
                onClick={goBack}
                aria-label={backLabel}
                title={backLabel}
                className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-[#0a285a] shadow-[0_1px_3px_rgba(10,40,90,.12)] hover:bg-[#f0f2f5]"
              >
                <ArrowLeft className="size-5 rtl:-scale-x-100" aria-hidden />
              </Link>
              <h2 className={`${TITLE} min-w-0`}>{t(section.label)}</h2>
            </div>
            <p className="mt-2 text-[15px] leading-6 ink-muted">{t(section.hint)}</p>
            <div className="mt-6">
              <SectionBody id={section.id} user={user} />
            </div>
          </div>
        ) : (
          <AccountHome user={user} has={id => entries.some(entry => entry.id === id)} badge={badge} onSignOut={() => setSignOutOpen(true)} />
        )}
    </PageBody>
  );
}
