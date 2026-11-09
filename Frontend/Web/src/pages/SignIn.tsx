/**
 * `/signin` and `/signup` — signing in as a page of its own.
 *
 * The dialog is still what the header opens, because it signs somebody in
 * where they are. This is for everything that has to be a link: a page that
 * needs an account sending somebody here with `?next=`, a "create an account"
 * link in a message, a bookmark, and the browser's own Back, which leaves a
 * dialog behind but returns to a page. Password managers also recognise a
 * sign-in page more reliably than a form inside an overlay.
 *
 * **The header is bare, as checkout's is**: the logo home, the language, and a
 * way back to the shop. The search field and the departments are what a
 * shopper leaves a sign-in page for, half-way through typing a password, and
 * there is no footer for the same reason.
 *
 * `/login` and `/register` answer too, being what people type, and are
 * replaced by the two real addresses. Signed in already, the page goes
 * straight to `next` — or the account — rather than offering a form.
 *
 * **On a portal's own address it is that portal's sign-in** — "NetLet Admin"
 * or "NetLet for sellers", with no Create account — and it is where the shop
 * hands a sign-in on: arriving with a pass (`portalPass`), it spends the pass
 * rather than asking, and says so while it does.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useRoute, useSearch } from "wouter";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { BareHeader } from "@/components/layout/BareHeader";
import { PAGE_SPACE } from "@/components/layout/Page";
import type { AuthMode } from "@/components/auth/AuthForm";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { DEMO_MODE } from "@/lib/demoMode";
import { privatePageMeta } from "@shared/seo";
import { returnPath } from "@shared/auth/returnPath";
import { PORTAL_SIDE, shopHref } from "@/lib/portalHost";
import { dropPortalPass, peekPortalPass } from "@/lib/portalPass";
import { trpc } from "@/lib/trpc";
import { CircleAlert, ShieldX } from "lucide-react";

export default function SignIn() {
  const { t } = useTranslation();
  const { isAuthenticated, loading } = useAuth();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const [onSignup] = useRoute("/signup");
  const [onRegister] = useRoute("/register");
  const [onLogin] = useRoute("/login");
  const [resetting, setResetting] = useState(false);

  const query = search ? `?${search}` : "";
  /* On a portal's own address this page signs in to the portal: no Create
     account, and the portal's overview is where it comes back to. */
  const asked = new URLSearchParams(search).get("next");
  const next = PORTAL_SIDE && !asked ? "/admin" : returnPath(asked);
  const registering = !PORTAL_SIDE && (onSignup || onRegister);
  const mode: AuthMode = registering ? "register" : resetting ? "reset" : "signin";

  usePageMeta(privatePageMeta(t(registering ? "auth.createTitle" : PORTAL_SIDE ? `auth.portalTitle.${PORTAL_SIDE}` : "auth.signInTitle")));

  /* What people type, answered with the real address. */
  useEffect(() => {
    if (onRegister) navigate(`/signup${query}`, { replace: true });
    else if (onLogin) navigate(`/signin${query}`, { replace: true });
  }, [onRegister, onLogin, query, navigate]);

  /* A pass the shop handed on, spent once; refused, the form is the way in. */
  const utils = trpc.useUtils();
  const [pass] = useState(() => peekPortalPass());
  const [passRefused, setPassRefused] = useState(false);
  const handoff = trpc.auth.portalHandoff.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate(next, { replace: true });
    },
    onError: () => setPassRefused(true),
  });
  const spend = handoff.mutate;
  /* Once: a pass offered twice is refused the second time. */
  const offered = useRef(false);
  useEffect(() => {
    if (!pass || offered.current) return;
    offered.current = true;
    dropPortalPass();
    spend({ pass });
  }, [pass, spend]);
  const handingOff = Boolean(pass) && !passRefused;

  /* On the admin portal a device the owner has not authorised is told so
     first (`Shared/auth/adminDevice.ts`): the form is behind a press, for an
     administrator asking for this device. */
  /* The answer read as the app started (`routeData`) is used, not asked
     again: it is about this browser signed out, which is what this page is. */
  const deviceCheck = trpc.devices.access.useQuery(undefined, { enabled: PORTAL_SIDE === "admin" && !DEMO_MODE && !handingOff, staleTime: 60_000 });
  const [askToSignIn, setAskToSignIn] = useState(false);
  /* A check that could not be answered refuses too: the card's own button is
     the way to the form, so nobody is shut out, and nobody is let past by an error. */
  const refused = PORTAL_SIDE === "admin" && !askToSignIn && (deviceCheck.isError || (deviceCheck.data && !deviceCheck.data.signedIn && deviceCheck.data.rule && !deviceCheck.data.known));
  const checkingDevice = PORTAL_SIDE === "admin" && !DEMO_MODE && !handingOff && deviceCheck.isLoading;

  /* Nothing to sign into twice. */
  useEffect(() => {
    if (!loading && isAuthenticated && !handingOff) navigate(next, { replace: true });
  }, [loading, isAuthenticated, handingOff, next, navigate]);

  const changeMode = (to: AuthMode) => {
    setResetting(to === "reset");
    const path = to === "register" ? "/signup" : "/signin";
    if (!location.startsWith(path)) navigate(`${path}${query}`);
  };

  return (
    /* A calm wash behind the card — the pale sky of the navy into the pearl
       and a breath of the orange's peach — on the owner's word ("colors that
       ease the eyes"); a phone's form reaches the screen's edges on white. */
    <div className="flex min-h-screen flex-col bg-[#f3f2ed] bg-[linear-gradient(160deg,#e6eff9_0%,#f3f2ed_55%,#fbece3_100%)] text-[#0a285a] max-sm:bg-white max-sm:bg-none">
      <BareHeader skipLabel="auth.skipToForm" />

      {/* The card in the middle of what the header leaves on a wide screen;
          nothing under it — the footer's three links were somewhere else to
          go from a page somebody came to sign in on. */}
      <main id="main" tabIndex={-1} className={`container flex-1 outline-none ${PAGE_SPACE} lg:flex lg:flex-col lg:justify-center`}>
        {DEMO_MODE ? (
          <p role="note" className="mx-auto mb-6 max-w-[1080px] rounded-xl border border-[#e3e1d9] bg-white px-4 py-3 text-[14px] text-[#3d5170]">
            <strong className="text-[#0a285a]">{t("header.signInDisabled")}</strong> {t("header.signInDisabledNote")}
          </p>
        ) : null}
        {handingOff ? (
          <p role="status" className="mx-auto max-w-[400px] py-16 text-center text-[16px] font-semibold text-[#0a285a]">
            {t("auth.portalSigningIn")}
          </p>
        ) : (
          <>
            {passRefused ? (
              <p role="alert" className="mx-auto mb-6 flex max-w-[520px] items-start gap-2.5 rounded-xl border border-[#f0dcb0] bg-[#fdf6e7] px-4 py-3 text-[14px] leading-5 text-[#8c5a12]">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("auth.portalPassRefused")}
              </p>
            ) : null}
            {checkingDevice ? (
              <p role="status" className="mx-auto max-w-[400px] py-16 text-center text-[15px] ink-muted">{t("admin.loading")}</p>
            ) : refused ? (
              <DeviceRefusal onSignIn={() => setAskToSignIn(true)} />
            ) : (
              <AuthScreen
                mode={mode}
                onModeChange={changeMode}
                onDone={() => navigate(next, { replace: true })}
                heading="h1"
                autoFocus
                portal={PORTAL_SIDE}
              />
            )}
          </>
        )}
      </main>

    </div>
  );
}

/**
 * What a browser the owner has not authorised meets on the admin portal:
 * that it is not one, and, for an administrator, the way to ask.
 */
function DeviceRefusal({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="device-refused" className="mx-auto w-full max-w-md rounded-3xl border border-[#e1e7ef] bg-white px-6 py-8 shadow-[0_18px_50px_-30px_rgba(10,40,90,.45)] sm:px-8">
      <span className="grid size-12 place-items-center rounded-full bg-[#fdecec] text-[#b42318]" aria-hidden>
        <ShieldX className="size-6" />
      </span>
      <h1 id="device-refused" className="mt-4 text-[22px] leading-8 font-extrabold text-[#0a285a]">{t("devices.refusedTitle")}</h1>
      <p className="mt-2 text-[15px] leading-6 text-[#3d5170]">{t("devices.refusedBody")}</p>
      <button type="button" onClick={onSignIn} className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#0a285a] px-5 text-[15px] font-semibold text-white hover:bg-[#0d3372]">
        {t("devices.refusedSignIn")}
      </button>
      <a href={shopHref("/")} className="mt-3 flex min-h-11 w-full items-center justify-center text-[14px] font-semibold text-[#0a285a] underline underline-offset-4">
        {t("admin.backToStore")}
      </a>
    </section>
  );
}
