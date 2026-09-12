/**
 * Sign in / create account / reset.
 *
 * Credentials go to NetLet's own `auth.login` / `auth.register`, which set an
 * httpOnly session cookie. Nothing token-shaped is ever held in JavaScript
 * here, which is also why there are no social sign-in buttons: those need a
 * provider configured in Firebase and a redirect the server has to trust, and
 * a button that looks like Google sign-in and does nothing is worse than no
 * button.
 *
 * Three things earn their complexity:
 *
 * - **The password is showable.** Typing a long password blind into a box is
 *   how people end up choosing a short one.
 * - **The meter names what is missing.** A bar that goes red tells somebody
 *   they failed without telling them how to stop; `checkPassword` returns the
 *   unmet rules and they are listed.
 * - **Reset actually sends an email.** Firebase composes it, so the link is
 *   real rather than decorative. The reply is identical for an address with no
 *   account, so this cannot be used to ask who is registered.
 *
 * The showcase panel carries what NetLet does, not invented numbers. A sign-in
 * wall claiming "12,000 happy sellers" on a marketplace that is still being
 * filled is the kind of thing a shopper checks once and never trusts again.
 */
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft, BellRing, Check, Eye, EyeOff, LoaderCircle,
  LogIn, Lock, Mail, ShoppingBag, Store, UserPlus, X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/useTranslation";
import { useOverlay } from "@/lib/useOverlay";
import { logoImage } from "@/lib/brandAssets";
import { checkPassword, type PasswordRule } from "@shared/auth/passwordStrength";
import type { MessageKey } from "@shared/i18n/dictionary";

type Mode = "signin" | "register" | "reset";

const RULE_LABEL: Record<PasswordRule, MessageKey> = {
  length: "auth.ruleLength",
  case: "auth.ruleCase",
  number: "auth.ruleNumber",
  symbol: "auth.ruleSymbol",
  notCommon: "auth.ruleNotCommon",
};

const BAND_LABEL = {
  weak: "auth.strengthWeak",
  fair: "auth.strengthFair",
  good: "auth.strengthGood",
  strong: "auth.strengthStrong",
} as const;

const BAND_TONE = {
  weak: "#d0453a",
  fair: "#b8791f",
  good: "#2f7d4f",
  strong: "#1d6b40",
} as const;

/** Good enough to catch a typo; the server is what actually decides. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function AuthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, tError, locale } = useTranslation();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [reveal, setReveal] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const emailRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    setError("");
    setTouched({ email: false, password: false });
    // Focus the first field so the dialog is usable without reaching for the
    // mouse, and so screen readers land inside it rather than behind it.
    window.setTimeout(() => emailRef.current?.focus(), 40);
  }, [open, mode]);

  useOverlay(open, onClose);

  const settle = async (displayName: string | null) => {
    await utils.auth.me.invalidate();
    toast.success(displayName ? t("auth.welcomeName", { name: displayName }) : t("auth.signedIn"));
    setPassword("");
    setReveal(false);
    onClose();
  };

  const login = trpc.auth.login.useMutation({
    onSuccess: user => void settle(user.name),
    onError: err => setError(err.message),
  });
  const register = trpc.auth.register.useMutation({
    onSuccess: user => void settle(user.name),
    onError: err => setError(err.message),
  });
  const reset = trpc.auth.requestPasswordReset.useMutation({
    // The same message whatever the address, so nothing here says who is
    // registered. The server is equally uniform.
    onSuccess: () => { toast.success(t("auth.resetSent")); setMode("signin"); },
    onError: () => { toast.success(t("auth.resetSent")); setMode("signin"); },
  });

  const pending = login.isPending || register.isPending || reset.isPending;
  const isRegister = mode === "register";
  const isReset = mode === "reset";

  const verdict = useMemo(() => checkPassword(password), [password]);
  const emailLooksRight = EMAIL_SHAPE.test(email.trim());
  const emailProblem = touched.email && email.trim() !== "" && !emailLooksRight;

  const canSubmit = isReset
    ? emailLooksRight
    : emailLooksRight && (isRegister ? verdict.acceptable : password.length > 0);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    // Firebase localises the reset email from the locale we send.
    if (isReset) reset.mutate({ email: email.trim(), locale });
    else if (isRegister) register.mutate({ email: email.trim(), password, name: name.trim() || undefined });
    else login.mutate({ email: email.trim(), password });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-[#061b3b]/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="grid w-full max-w-[860px] overflow-hidden rounded-3xl bg-[#fffdf9] shadow-[0_28px_70px_rgba(10,40,90,.3)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]"
      >
        <ShowcasePanel />

        <div className="relative p-6 sm:p-8">
          <button
            onClick={onClose}
            aria-label={t("auth.close")}
            className="glass pressable tap-target absolute top-5 grid size-9 place-items-center rounded-full end-5"
          >
            <X className="size-4" />
          </button>

          <img src={logoImage} alt="" aria-hidden className="h-8 w-auto lg:hidden" />

          <h2 id={titleId} className="display-face mt-4 text-[28px] leading-tight text-[#0a285a] lg:mt-0">
            {t(isReset ? "auth.resetTitle" : isRegister ? "auth.createTitle" : "auth.signInTitle")}
          </h2>
          <p className="type-label mt-1 text-[#536b8c]">
            {t(isReset ? "auth.resetNote" : isRegister ? "auth.createNote" : "auth.signInNote")}
          </p>

          {!isReset && (
            <ModeTabs mode={mode} onChange={next => { setMode(next); setError(""); }} />
          )}

          <form onSubmit={submit} className="mt-5 space-y-3.5" noValidate>
            {isRegister && (
              <Field label={`${t("auth.name")} ${t("auth.optional")}`} value={name}>
                {id => (
                  <input
                    id={id}
                    value={name}
                    onChange={event => setName(event.target.value)}
                    autoComplete="name"
                    dir="auto"
                    className={inputClass}
                  />
                )}
              </Field>
            )}

            <Field
              label={t("auth.email")}
              value={email}
              problem={emailProblem ? t("auth.emailInvalid") : undefined}
              valid={touched.email && emailLooksRight}
            >
              {id => (
                <input
                  id={id}
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  dir="ltr"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  onBlur={() => setTouched(was => ({ ...was, email: true }))}
                  autoComplete="email"
                  aria-invalid={emailProblem || undefined}
                  className={inputClass}
                />
              )}
            </Field>

            {!isReset && (
              <>
                <Field label={t("auth.password")} value={password}>
                  {id => (
                    <>
                      <input
                        id={id}
                        type={reveal ? "text" : "password"}
                        dir="ltr"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        onBlur={() => setTouched(was => ({ ...was, password: true }))}
                        autoComplete={isRegister ? "new-password" : "current-password"}
                        // Room for the eye, so a long password never runs under it.
                        className={`${inputClass} pe-12`}
                      />
                      <button
                        type="button"
                        onClick={() => setReveal(shown => !shown)}
                        aria-pressed={reveal}
                        aria-label={t(reveal ? "auth.hidePassword" : "auth.showPassword")}
                        title={t(reveal ? "auth.hidePassword" : "auth.showPassword")}
                        className="pressable tap-target absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-[#536b8c] transition hover:bg-[#eef1f6] hover:text-[#0a285a] end-2"
                      >
                        {reveal ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                      </button>
                    </>
                  )}
                </Field>

                {isRegister && password.length > 0 && <StrengthMeter verdict={verdict} />}
              </>
            )}

            {/* aria-live so the failure is announced, not just drawn. */}
            {error && (
              <p role="alert" aria-live="polite" className="type-label rounded-xl bg-[#fdeceb] px-3 py-2 text-[#8c2f22]">
                {tError(error)}
              </p>
            )}

            <button
              type="submit"
              disabled={pending || !canSubmit}
              className="glass glass-navy pressable flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-extrabold transition disabled:opacity-50"
            >
              {pending
                ? <LoaderCircle className="size-4 animate-spin" />
                : isReset ? <Mail className="size-4" />
                : isRegister ? <UserPlus className="size-4" />
                : <LogIn className="size-4" />}
              {t(isReset ? "auth.resetSend" : isRegister ? "account.createAccount" : "header.signIn")}
            </button>
          </form>

          <div className="mt-4 space-y-3">
            {isReset ? (
              <button
                onClick={() => { setMode("signin"); setError(""); }}
                className="type-label inline-flex items-center gap-1.5 font-extrabold text-[#536b8c] hover:text-[#0a285a]"
              >
                <ArrowLeft className="size-3.5 rtl:-scale-x-100" />{t("auth.resetBack")}
              </button>
            ) : !isRegister ? (
              <button
                onClick={() => { setMode("reset"); setError(""); }}
                className="type-label font-extrabold text-[#536b8c] underline underline-offset-4 hover:text-[#0a285a]"
              >
                {t("auth.forgot")}
              </button>
            ) : null}

            <p className="type-label flex items-start gap-2 text-[11px] leading-4 ink-muted">
              <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
              {t("auth.secureNote")}
            </p>
            {isRegister && (
              <p className="type-label text-[11px] leading-4 text-[#9ea4b5]">{t("auth.terms")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "type-body h-12 w-full rounded-xl border border-[#d5dfeb] bg-white px-3.5 pt-4 text-[14px] text-[#0a285a] outline-none transition focus:border-[#f2683a] focus:ring-2 focus:ring-[#f2683a]/25";

/**
 * A label that sits inside the box and lifts when there is something to lift
 * for, so the field keeps its name once it is filled — a placeholder alone
 * leaves a filled form with no labels at all.
 */
function Field({ label, value, problem, valid, children }: {
  label: string;
  value: string;
  problem?: string;
  valid?: boolean;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  const lifted = value.length > 0;
  return (
    <div>
      <div className="relative">
        <label
          htmlFor={id}
          /* One `top` and one transform per state: Tailwind resolves conflicting
             utilities by stylesheet order, not by their order in this string,
             so a lifted label carrying both `top-1/2` and `top-2` lands
             wherever the build happens to put them. */
          className={`pointer-events-none absolute px-3.5 ink-muted transition-all duration-150 ${
            lifted
              ? "top-2 translate-y-0 text-[10px] font-extrabold tracking-[.06em] text-[#536b8c] uppercase"
              : "top-1/2 -translate-y-1/2 text-[13px]"
          }`}
        >
          {label}
        </label>
        {children(id)}
        {valid && !problem && (
          <Check className="absolute top-1/2 size-4 -translate-y-1/2 text-[#2f7d4f] end-3" aria-hidden />
        )}
      </div>
      {problem && (
        <p role="alert" className="type-label mt-1 text-[11px] font-bold text-[#8c2f22]">{problem}</p>
      )}
    </div>
  );
}

/** Sign in / Create account, as a real tablist rather than two links. */
function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const { t } = useTranslation();
  const tabs: { id: Mode; label: MessageKey }[] = [
    { id: "signin", label: "auth.tabSignIn" },
    { id: "register", label: "auth.tabRegister" },
  ];
  return (
    <div role="tablist" className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-[#eef1f6] p-1">
      {tabs.map(tab => {
        const active = mode === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`rounded-xl px-3 py-2.5 text-[13px] font-extrabold transition ${
              active ? "bg-white text-[#0a285a] shadow-[0_1px_3px_rgba(10,40,90,.12)]" : "text-[#536b8c] hover:text-[#0a285a]"
            }`}
          >
            {t(tab.label)}
          </button>
        );
      })}
    </div>
  );
}

/** The bar, and — the useful half — what is still missing. */
function StrengthMeter({ verdict }: { verdict: ReturnType<typeof checkPassword> }) {
  const { t } = useTranslation();
  const tone = BAND_TONE[verdict.band];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="type-label text-[10px] font-extrabold tracking-[.08em] ink-muted uppercase">
          {t("auth.strength")}
        </span>
        <span className="type-label text-[11px] font-extrabold" style={{ color: tone }}>
          {t(BAND_LABEL[verdict.band])}
        </span>
      </div>
      <div
        className="mt-1.5 flex gap-1"
        role="meter"
        aria-valuenow={verdict.score}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-label={t("auth.strength")}
      >
        {[0, 1, 2, 3].map(segment => (
          <span
            key={segment}
            className="h-1.5 flex-1 rounded-full transition-colors"
            style={{ background: segment < verdict.score ? tone : "#e2e7ef" }}
          />
        ))}
      </div>
      {verdict.unmet.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {verdict.unmet.map(rule => (
            <li key={rule} className="type-label text-[11px] leading-4 ink-muted">• {t(RULE_LABEL[rule])}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What NetLet actually is, beside the form.
 *
 * Three things the account does, rather than testimonials or seller counts:
 * everything here is checkable against the site itself, which is the only
 * kind of claim worth putting next to a password box. Hidden below `lg`,
 * where the form should have the whole screen.
 */
function ShowcasePanel() {
  const { t } = useTranslation();
  const points = [
    { icon: ShoppingBag, title: "auth.panelPointOne", note: "auth.panelPointOneNote" },
    { icon: BellRing, title: "auth.panelPointTwo", note: "auth.panelPointTwoNote" },
    { icon: Store, title: "auth.panelPointThree", note: "auth.panelPointThreeNote" },
  ] as const;

  return (
    <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0a285a] p-8 text-white lg:flex">
      {/* Shades toward the text, so it flips with the script. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_0%_0%,rgba(242,104,58,.38),transparent_60%)] rtl:-scale-x-100"
      />
      <div className="relative">
        <img src={logoImage} alt="" aria-hidden className="h-9 w-auto brightness-0 invert" />
        <p className="display-face mt-6 text-[30px] leading-[1.15]">{t("auth.panelTitle")}</p>
      </div>

      <ul className="relative mt-8 space-y-5">
        {points.map(point => (
          <li key={point.title} className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/12">
              <point.icon className="size-[18px]" aria-hidden />
            </span>
            <span>
              <span className="block text-[13px] font-extrabold">{t(point.title)}</span>
              <span className="block text-[12px] leading-5 text-white/70">{t(point.note)}</span>
            </span>
          </li>
        ))}
      </ul>

    </div>
  );
}
