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
 * shopper leaves a sign-in page for, half-way through typing a password.
 *
 * `/login` and `/register` answer too, being what people type, and are
 * replaced by the two real addresses. Signed in already, the page goes
 * straight to `next` — or the account — rather than offering a form.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
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
  const next = returnPath(new URLSearchParams(search).get("next"));
  const registering = onSignup || onRegister;
  const mode: AuthMode = registering ? "register" : resetting ? "reset" : "signin";

  usePageMeta(privatePageMeta(t(registering ? "auth.createTitle" : "auth.signInTitle")));

  /* What people type, answered with the real address. */
  useEffect(() => {
    if (onRegister) navigate(`/signup${query}`, { replace: true });
    else if (onLogin) navigate(`/signin${query}`, { replace: true });
  }, [onRegister, onLogin, query, navigate]);

  /* Nothing to sign into twice. */
  useEffect(() => {
    if (!loading && isAuthenticated) navigate(next, { replace: true });
  }, [loading, isAuthenticated, next, navigate]);

  const changeMode = (to: AuthMode) => {
    setResetting(to === "reset");
    const path = to === "register" ? "/signup" : "/signin";
    if (!location.startsWith(path)) navigate(`${path}${query}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-[#0a285a]">
      <BareHeader skipLabel="auth.skipToForm" />

      <main id="main" tabIndex={-1} className={`container flex-1 outline-none ${PAGE_SPACE}`}>
        {DEMO_MODE ? (
          <p role="note" className="mx-auto mb-6 max-w-[1080px] rounded-xl border border-[#e3e1d9] bg-white px-4 py-3 text-[14px] text-[#3d5170]">
            <strong className="text-[#0a285a]">{t("header.signInDisabled")}</strong> {t("header.signInDisabledNote")}
          </p>
        ) : null}
        <AuthScreen
          mode={mode}
          onModeChange={changeMode}
          onDone={() => navigate(next, { replace: true })}
          heading="h1"
          autoFocus
        />
      </main>

      <footer className="border-t border-[#e3e1d9] bg-white">
        <nav aria-label={t("footer.service")} className="container flex flex-wrap items-center gap-x-6 gap-y-2 py-5 text-[13px] font-semibold">
          <Link href="/help" className="rounded text-[#3d5170] hover:text-[#0a285a]">{t("footer.contact")}</Link>
          <Link href="/returns" className="rounded text-[#3d5170] hover:text-[#0a285a]">{t("footer.returns")}</Link>
          <Link href="/sell" className="rounded text-[#3d5170] hover:text-[#0a285a]">{t("footer.sellWithUs")}</Link>
        </nav>
      </footer>
    </div>
  );
}

