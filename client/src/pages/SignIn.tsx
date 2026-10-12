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
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { AuthScreen } from "@/components/auth/AuthScreen";
import type { AuthMode } from "@/components/auth/AuthForm";
import { useCustomer } from "@/contexts/CustomerContext";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { logoImage } from "@/lib/brandAssets";
import { DEMO_MODE } from "@/lib/demoMode";
import { privatePageMeta } from "@shared/seo";
import { returnPath } from "@shared/auth/returnPath";

export default function SignIn() {
  const { t, isArabic } = useTranslation();
  const { toggleLocale } = useCustomer();
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
    <div className="flex min-h-screen flex-col bg-[#f3f2ed] text-[#0a285a]">
      <a
        href="#main"
        className="glass glass-navy sr-only rounded-full px-4 py-2 text-xs font-extrabold focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-50"
      >
        {t("auth.skipToForm")}
      </a>
      <header className="border-b border-[#e3e1d9] bg-white">
        <div className="container flex h-[68px] items-center gap-2 sm:h-[76px]">
          <Link href="/" className="me-auto flex shrink-0 items-center" aria-label={t("header.home")}>
            <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-10 w-auto max-w-[120px] object-contain sm:h-12 sm:max-w-[156px]" />
          </Link>
          <button onClick={toggleLocale} title={t("header.changeLanguage")} className={plain}>
            <span lang={isArabic ? "en" : "ar"}>{t("header.language")}</span>
          </button>
          <Link href="/" className={`${plain} hidden sm:flex`}>
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            {t("header.continueShopping")}
          </Link>
        </div>
      </header>

      <main id="main" className="container flex-1 py-6 sm:py-12 lg:py-16">
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

const plain = "pressable flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-extrabold text-[#0a285a] transition-colors hover:bg-[#0a285a]/[.06]";
