import { useAuth } from "@/_core/hooks/useAuth";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ProfileManager } from "@/components/ProfileManager";
import { AccountFacts } from "@/components/AccountFacts";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import AuthDialog from "@/components/AuthDialog";
import { DEMO_MODE } from "@/lib/demoMode";
import { useState } from "react";
import { appPath } from "@/lib/basePath";
import { logoImage } from "@/lib/brandAssets";
import { useCustomer } from "@/contexts/CustomerContext";
import { trpc } from "@/lib/trpc";
import { defaultNotificationPreferences, kuwaitDeliveryZones, notificationKinds, notificationLabelKeys, type NotificationKind } from "@shared/customer";
import { useTranslation } from "@/lib/useTranslation";
import { Bell, ChevronRight, Heart, LogIn, LogOut, MapPin, PackageSearch, ShoppingBag, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";


function AccountCard({ icon, title, children, className = "" }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return <article className={`rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5 ${className}`}><div className="grid size-10 place-items-center rounded-xl bg-[#e7edf5] text-[#0a285a]">{icon}</div><h2 className="type-product mt-4 text-lg">{title}</h2>{children}</article>;
}

export default function Account() {
  usePageMeta(privatePageMeta("Your account"));
  const [authOpen, setAuthOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { isArabic, t } = useTranslation();
  const openAuth = () => DEMO_MODE
    ? toast(t("header.signInDisabled"), { description: t("header.signInDisabledNote") })
    : setAuthOpen(true);
  const { user, loading, isAuthenticated, logout } = useAuth();
  const { deliveryZone, deliveryZoneId, savedIds, setDeliveryZoneId } = useCustomer();
  const zoneName = (zone: { label: string; labelAr: string }) => (isArabic ? zone.labelAr : zone.label);
  const notifications = trpc.customer.notifications.list.useQuery(undefined, { enabled: isAuthenticated });
  const tracking = trpc.customer.tracking.list.useQuery(undefined, { enabled: isAuthenticated });
  const setNotification = trpc.customer.notifications.set.useMutation({
    onSuccess: () => notifications.refetch(),
    onError: () => toast.error(t("account.preferenceFailed")),
  });
  const storedPreferences = new Map((notifications.data ?? []).map(item => [item.kind as NotificationKind, item.enabled]));

  return (
    <main className="min-h-screen bg-background pb-8 text-[#0a285a]">
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
      {/* Signing out is cheap to undo but costs a password to undo, so it
          asks first — the same treatment anything with a real cost gets. */}
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
      <header className="border-b border-[#d5dfeb] bg-background/95 backdrop-blur-xl"><div className="container flex h-[76px] items-center justify-between gap-4"><a href={appPath("/")} className="flex items-center" aria-label={t("account.backHome")}><img src={logoImage} alt="NetLet" className="h-11 w-auto max-w-[140px] object-contain" /></a><a href={appPath("/")} className="glass type-control pressable flex items-center gap-1.5 rounded-full px-4 py-2">{t("header.continueShopping")} <ChevronRight className="size-4 rtl:-scale-x-100" /></a></div></header>

      <section className="container max-w-5xl py-10 sm:py-14"><p className="type-label text-[#f2683a] uppercase">{t("account.eyebrow")}</p>{loading ? <div className="mt-4 h-12 w-64 animate-pulse rounded-xl bg-[#dce5e9]" /> : <h1 className="type-display mt-3 text-4xl text-[#0a285a] sm:text-5xl">{isAuthenticated ? (user?.name ? t("account.welcomeBackName", { name: user.name }) : t("account.welcomeBack")) : t("account.yourWay")}</h1>}<p className="type-body mt-4 max-w-xl text-[#536b8c]">{t("account.note")}</p>

        {!loading && !isAuthenticated ? <section className="mt-9 rounded-[1.5rem] border border-[#d5dfeb] bg-white p-6 shadow-[0_12px_30px_rgba(10,40,90,.06)] sm:p-8"><div className="grid size-12 place-items-center rounded-2xl bg-[#e7edf5]"><UserRound className="size-6 text-[#0a285a]" /></div><h2 className="type-product mt-5 text-xl text-[#0a285a]">{t("account.signInOrCreate")}</h2><p className="type-body mt-2 max-w-lg text-[#536b8c]">{t("account.guestNote")}</p><div className="mt-6 flex flex-wrap gap-3"><button id="netlet-auth-login" onClick={() => openAuth()} className="glass glass-navy type-control pressable inline-flex items-center gap-2 rounded-full px-5 py-3"><LogIn className="size-4" /> {t("header.signIn")}</button><button id="netlet-auth-signup" onClick={() => openAuth()} className="glass type-control pressable inline-flex items-center gap-2 rounded-full px-5 py-3"><UserPlus className="size-4" /> {t("account.createAccount")}</button></div></section> : null}

        {!loading && isAuthenticated ? <div className="mt-9 space-y-5"><section className="grid gap-4 lg:grid-cols-3"><AccountCard icon={<Heart className="size-5" />} title={t("account.savedFinds")}><p className="type-body mt-1 text-sm text-[#536b8c]">{savedIds.length === 0 ? t("account.savedEmpty") : savedIds.length === 1 ? t("account.savedCountOne") : t("account.savedCount", { count: savedIds.length })}</p><a href={appPath("/saved")} className="mt-4 inline-flex text-xs font-extrabold text-[#f2683a] underline underline-offset-4">{t("account.browseSaved")}</a></AccountCard><AccountCard icon={<MapPin className="size-5" />} title={t("account.deliveryArea")}><p className="type-body mt-1 text-sm text-[#536b8c]">{deliveryZone ? t("account.zoneSelected", { name: zoneName(deliveryZone) }) : t("account.chooseZone")}</p><label className="type-label mt-4 block text-[#0a285a]">{t("delivery.governorate")}<select value={deliveryZoneId ?? ""} onChange={event => setDeliveryZoneId(event.target.value)} className="type-body mt-2 h-10 w-full rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] px-3 text-[#0a285a]"><option value="" disabled>{t("delivery.selectGovernorate")}</option>{kuwaitDeliveryZones.map(zone => <option key={zone.id} value={zone.id}>{zoneName(zone)}</option>)}</select></label><p className="mt-3 text-[10px] font-semibold leading-4 text-[#778ba6]">{t("account.pricingUnconfigured")}</p></AccountCard><AccountCard icon={<PackageSearch className="size-5" />} title={t("account.orderTracking")}><p className="type-body mt-1 text-sm text-[#536b8c]">{!tracking.data?.length ? t("account.trackingEmpty") : tracking.data.length === 1 ? t("account.trackingCountOne") : t("account.trackingCount", { count: tracking.data.length })}</p><p className="mt-4 text-[10px] font-semibold leading-4 text-[#778ba6]">{t("account.trackingNote")}</p></AccountCard></section>

          <section className="rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 sm:p-7"><div className="flex gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fff0ab] text-[#0a285a]"><Bell className="size-5" /></div><div><p className="type-product text-lg">{t("account.notifications")}</p><p className="type-body mt-1 text-sm text-[#536b8c]">{t("account.notificationsNote")}</p></div></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{notificationKinds.map(kind => { const enabled = storedPreferences.get(kind) ?? defaultNotificationPreferences[kind]; return <label key={kind} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] px-4 py-3 text-sm font-bold text-[#0a285a]"><span>{t(notificationLabelKeys[kind])}</span><input type="checkbox" checked={enabled} disabled={setNotification.isPending} onChange={event => setNotification.mutate({ kind, enabled: event.target.checked })} className="size-4 accent-[#f2683a]" /></label>; })}</div></section>

          {user ? <ProfileManager user={user} /> : null}

          {user ? <AccountFacts user={user} /> : null}

          <button onClick={() => setSignOutOpen(true)} className="glass type-control pressable inline-flex items-center gap-2 rounded-full px-5 py-3"><LogOut className="size-4" /> {t("header.signOut")}</button></div> : null}

        <div className="mt-10 flex items-center gap-2 rounded-2xl bg-[#e7edf5] px-5 py-4 text-sm text-[#536b8c]"><ShoppingBag className="size-5 shrink-0 text-[#f2683a]" /> {t("account.bagNote")}</div>
      </section>
    </main>
  );
}
