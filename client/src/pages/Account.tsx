/**
 * The shopper's own account.
 *
 * Ordered by what somebody came to do. Identity first — "is this my account?"
 * is the question already asked by the time the page loads — then the details
 * they change, then preferences, then what the account has collected, and
 * signing out last in a zone of its own.
 *
 * It used to open on saved items and delivery, with the profile third and the
 * account's own facts in a bare card at the foot, which put the reason for
 * visiting below the things you visit the shop for.
 */
import { useAuth } from "@/hooks/useAuth";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProfileManager } from "@/components/account/ProfileManager";
import { AccountIdentity } from "@/components/account/AccountIdentity";
import { AccountPreferences } from "@/components/account/AccountPreferences";
import { AccountActivity } from "@/components/account/AccountActivity";
import { AccountOrders } from "@/components/account/AccountOrders";
import { WishlistManager } from "@/components/account/WishlistManager";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import AuthDialog from "@/components/auth/AuthDialog";
import { DEMO_MODE } from "@/lib/demoMode";
import { useState } from "react";
import { appPath } from "@/lib/basePath";
import { logoImage } from "@/lib/brandAssets";
import { useTranslation } from "@/hooks/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ChevronRight, LogIn, LogOut, ShoppingBag, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";

/** The sections, in page order. The nav and the page read from one list. */
const SECTIONS = [
  { id: "orders", label: "account.sectionOrders" },
  { id: "wishlists", label: "account.sectionWishlists" },
  { id: "details", label: "account.sectionProfile" },
  { id: "preferences", label: "account.sectionPreferences" },
  { id: "activity", label: "account.sectionActivity" },
  { id: "signout", label: "account.sectionSignOut" },
] satisfies { id: string; label: MessageKey }[];

export default function Account() {
  usePageMeta(privatePageMeta("Your account"));
  const [authOpen, setAuthOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { t } = useTranslation();
  const openAuth = () => DEMO_MODE
    ? toast(t("header.signInDisabled"), { description: t("header.signInDisabledNote") })
    : setAuthOpen(true);
  const { user, loading, isAuthenticated, logout } = useAuth();

  return (
    <main className="min-h-screen bg-background pb-12 text-[#0a285a]">
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
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
          } finally {
            setSigningOut(false);
          }
        }}
      />

      <header className="border-b border-[#d5dfeb] bg-background/95 backdrop-blur-xl">
        <div className="container flex h-[76px] items-center justify-between gap-4">
          <a href={appPath("/")} className="flex items-center" aria-label={t("account.backHome")}>
            <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-11 w-auto max-w-[140px] object-contain" />
          </a>
          <a href={appPath("/")} className="glass type-control pressable flex items-center gap-1.5 rounded-full px-4 py-2">
            {t("header.continueShopping")} <ChevronRight className="size-4 rtl:-scale-x-100" />
          </a>
        </div>
      </header>

      <div className="container max-w-5xl py-8 sm:py-12">
        <p className="type-label ink-accent uppercase">{t("account.eyebrow")}</p>
        {loading ? (
          <div className="mt-3 h-10 w-64 animate-pulse rounded-xl bg-[#dce5e9]" />
        ) : (
          <h1 className="type-display mt-2 text-3xl text-[#0a285a] sm:text-4xl">
            {isAuthenticated
              ? (user?.name ? t("account.welcomeBackName", { name: user.name }) : t("account.welcomeBack"))
              : t("account.yourWay")}
          </h1>
        )}

        {!loading && !isAuthenticated ? <GuestPanel onOpen={openAuth} /> : null}

        {!loading && isAuthenticated && user ? (
          <div className="mt-8 lg:grid lg:grid-cols-[196px_minmax(0,1fr)] lg:items-start lg:gap-8">
            <SectionNav />

            <div className="space-y-10">
              <AccountIdentity user={user} />

              {/* First of the sections, ahead of the settings. Somebody opening
                  their account on a shop is usually asking where a parcel is or
                  whether they can still send something back — not changing a
                  display name. The nav and the page read from one list, so the
                  order here is the order there. */}
              <Section id="orders" title={t("account.sectionOrders")}>
                <AccountOrders />
              </Section>

              {/* Second, ahead of the settings: a wishlist is something other
                  people act on, so it is closer to "where is my parcel" than
                  to "change my display name". */}
              <Section id="wishlists" title={t("account.sectionWishlists")}>
                <WishlistManager />
              </Section>

              <Section id="details" title={t("account.sectionProfile")}>
                <ProfileManager user={user} />
              </Section>

              <Section id="preferences" title={t("account.sectionPreferences")}>
                <AccountPreferences />
              </Section>

              <Section id="activity" title={t("account.sectionActivity")}>
                <AccountActivity />
              </Section>

              <Section id="signout" title={t("account.sectionSignOut")}>
                <div className="rounded-[1.35rem] border border-[#f2b69e] bg-[#fdeceb] p-5 sm:p-6">
                  <p className="max-w-prose text-sm leading-6 text-[#8c2f22]">{t("account.signOutZone")}</p>
                  <button
                    onClick={() => setSignOutOpen(true)}
                    className="pressable mt-4 inline-flex items-center gap-2 rounded-full bg-[#8c2f22] px-5 py-3 text-xs font-extrabold text-white transition hover:bg-[#7a2a1e]"
                  >
                    <LogOut className="size-4" /> {t("header.signOut")}
                  </button>
                </div>
              </Section>

              <p className="flex items-center gap-2 rounded-2xl bg-[#e7edf5] px-5 py-4 text-sm ink-muted">
                <ShoppingBag className="size-5 shrink-0 ink-accent" aria-hidden /> {t("account.bagNote")}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

/**
 * Anchors down the side, on wide screens only.
 *
 * On a phone the page is short enough to scroll and a nav would be one more
 * thing between somebody and the first setting.
 */
function SectionNav() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("account.jumpTo")} className="sticky top-6 hidden lg:block">
      <p className="text-[10px] font-extrabold tracking-[.12em] ink-muted uppercase">{t("account.jumpTo")}</p>
      <ul className="mt-3 space-y-1">
        {SECTIONS.map(section => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="block rounded-xl px-3 py-2 text-[13px] font-bold text-[#536b8c] transition hover:bg-white hover:text-[#0a285a]"
            >
              {t(section.label)}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    /* scroll-mt keeps the heading clear of the sticky header when an anchor
       lands on it. */
    <section id={id} className="scroll-mt-6">
      <h2 className="text-[11px] font-extrabold tracking-[.12em] ink-muted uppercase">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function GuestPanel({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="mt-8 rounded-[1.5rem] border border-[#d5dfeb] bg-white p-6 shadow-[0_12px_30px_rgba(10,40,90,.06)] sm:p-8">
      <div className="grid size-12 place-items-center rounded-2xl bg-[#e7edf5]">
        <UserRound className="size-6 text-[#0a285a]" />
      </div>
      <h2 className="type-product mt-5 text-xl text-[#0a285a]">{t("account.signInOrCreate")}</h2>
      <p className="type-body mt-2 max-w-lg ink-muted">{t("account.guestNote")}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button id="netlet-auth-login" onClick={onOpen} className="glass glass-navy type-control pressable inline-flex items-center gap-2 rounded-full px-5 py-3">
          <LogIn className="size-4" /> {t("header.signIn")}
        </button>
        <button id="netlet-auth-signup" onClick={onOpen} className="glass type-control pressable inline-flex items-center gap-2 rounded-full px-5 py-3">
          <UserPlus className="size-4" /> {t("account.createAccount")}
        </button>
      </div>
    </section>
  );
}
