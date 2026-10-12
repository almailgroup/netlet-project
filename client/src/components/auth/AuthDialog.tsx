/**
 * Sign in / create account / reset.
 *
 * Credentials go to NetLet's own `auth.login` / `auth.register`, which set an
 * httpOnly session cookie. Nothing token-shaped is ever held in JavaScript
 * here, which is also why there are no social sign-in buttons: those need a
 * provider configured in the auth service and a redirect the server has to trust,
 * and
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
 * - **Reset actually sends an email.** Supabase composes it, so the link is
 *   real rather than decorative. The reply is identical for an address with no
 *   account, so this cannot be used to ask who is registered.
 *
 * The showcase panel carries what NetLet does, not invented numbers. A sign-in
 * wall claiming "12,000 happy sellers" on a marketplace that is still being
 * filled is the kind of thing a shopper checks once and never trusts again.
 *
 * **On a phone it is the whole screen**, not a card floating over the shop:
 * the keyboard takes half of a 390px screen, and a card with a margin round
 * it left the password box under the keyboard. From `sm` up it is a card.
 * "Forgot your password?" sits under the password box, where somebody whose
 * password was refused is already looking, and Caps Lock is said beside the
 * box while it is on — the commonest reason a right password is refused.
 */
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft, BellRing, Check, CircleAlert, Eye, EyeOff, LoaderCircle,
  LogIn, Lock, Mail, RotateCcw, ShoppingBag, Store, Truck, UserPlus, Wallet, X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { useOverlay } from "@/hooks/useOverlay";
import { footerLogoImage, logoImage } from "@/lib/brandAssets";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { checkPassword, type PasswordRule } from "@shared/auth/passwordStrength";
import type { MessageKey } from "@shared/i18n/dictionary";
import { clearReferral, storedReferral } from "@/lib/referral";
import { DiscButton } from "@/components/ui/DiscButton";

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
  const [capsLock, setCapsLock] = useState(false);
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
    /* Forgotten once it has been used, so an invitation cannot ride along on a
       second account made from the same browser. */
    onSuccess: user => { clearReferral(); void settle(user.name); },
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

  /* Read once: the dialog is open for a minute, and a code that arrives in
     that minute belongs to the next visit rather than this one. */
  const invited = useMemo(() => storedReferral(), []);

  const verdict = useMemo(() => checkPassword(password), [password]);
  const emailLooksRight = EMAIL_SHAPE.test(email.trim());
  const emailProblem = touched.email && email.trim() !== "" && !emailLooksRight;

  const canSubmit = isReset
    ? emailLooksRight
    : emailLooksRight && (isRegister ? verdict.acceptable : password.length > 0);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    /* The locale is sent and currently unused: Supabase composes the reset mail
       from a dashboard template rather than from the request. It is here for
       when those templates are translated, which is a dashboard change. */
    if (isReset) reset.mutate({ email: email.trim(), locale });
    else if (isRegister) register.mutate({ email: email.trim(), password, name: name.trim() || undefined, referral: storedReferral() });
    else login.mutate({ email: email.trim(), password });
  };

  if (!open) return null;

  /* What the button says while it works, so a slow service reads as working rather than stuck. */
  const busyLabel: MessageKey = isReset ? "auth.sending" : isRegister ? "auth.creating" : "auth.signingIn";
  /* Caps Lock, read from the key events the box already gets; nothing is asked of the browser. */
  const readCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState?.("CapsLock") ?? false);

  return (
    <div
      className="fixed inset-0 z-[80] grid overflow-y-auto bg-[#061b3b]/55 sm:place-items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="grid min-h-[100dvh] w-full overflow-hidden bg-white sm:min-h-0 sm:max-w-[880px] sm:rounded-3xl sm:shadow-[0_28px_70px_rgba(10,40,90,.3)] lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]"
      >
        <ShowcasePanel />

        <div className="relative flex flex-col px-5 pb-8 pt-5 sm:px-10 sm:pb-10 sm:pt-9">
          <div className="flex items-center justify-between gap-3 lg:justify-end">
            <img src={logoImage} alt="" aria-hidden loading="eager" decoding="async" className="h-10 w-auto lg:hidden" />
            <DiscButton
              onClick={onClose}
              aria-label={t("auth.close")}
              discClassName="size-9"
            >
              <X className="size-4" />
            </DiscButton>
          </div>

          <div className="mx-auto mt-6 w-full max-w-[380px] lg:mt-2">
            <h2 id={titleId} className="text-[26px] font-extrabold leading-tight text-[#0a285a]">
              {t(isReset ? "auth.resetTitle" : isRegister ? "auth.createTitle" : "auth.signInTitle")}
            </h2>
            <p className="mt-1.5 text-[14px] leading-6 text-[#536b8c]">
              {t(isReset ? "auth.resetNote" : isRegister ? "auth.createNote" : "auth.signInNote")}
            </p>

            {/* Somebody who followed a friend's link is told what it gets them,
                on the pane where they are deciding whether to register at all
                (3.1.14). Absent when there is no invitation, rather than a line
                explaining a scheme they are not in. */}
            {isRegister && invited ? (
              <p className="mt-3 rounded-xl bg-[#f3f2ed] px-4 py-3 text-xs leading-5 text-[#536b8c]">
                {t("auth.referralInvited")}
              </p>
            ) : null}

            {!isReset && (
              <ModeTabs mode={mode} onChange={next => { setMode(next); setError(""); }} />
            )}

            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
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
                    /* Room for the tick. The box types left to right on either
                       page, so its own "end" is the right; on the Arabic page
                       the tick sits at the page's end, the left. */
                    className={`${inputClass} pe-10 rtl:pe-3.5 rtl:ps-10`}
                  />
                )}
              </Field>

              {!isReset && (
                <div>
                  <Field label={t("auth.password")} value={password}>
                    {id => (
                      <>
                        <input
                          id={id}
                          type={reveal ? "text" : "password"}
                          dir="ltr"
                          value={password}
                          onChange={event => setPassword(event.target.value)}
                          onKeyDown={readCapsLock}
                          onKeyUp={readCapsLock}
                          onBlur={() => { setTouched(was => ({ ...was, password: true })); setCapsLock(false); }}
                          autoComplete={isRegister ? "new-password" : "current-password"}
                          aria-describedby={capsLock ? `${titleId}-caps` : undefined}
                          // Room for the eye, so a long password never runs under it — on the
                          // Arabic page that is the left, for the reason the email box gives.
                          className={`${inputClass} pe-12 rtl:pe-3.5 rtl:ps-12`}
                        />
                        <button
                          type="button"
                          onClick={() => setReveal(shown => !shown)}
                          aria-pressed={reveal}
                          aria-label={t(reveal ? "auth.hidePassword" : "auth.showPassword")}
                          title={t(reveal ? "auth.hidePassword" : "auth.showPassword")}
                          className="pressable tap-target absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-[#536b8c] transition hover:bg-[#0a285a]/[.06] hover:text-[#0a285a] end-2"
                        >
                          {reveal ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                        </button>
                      </>
                    )}
                  </Field>
                  <div className="mt-1.5 flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span id={`${titleId}-caps`} aria-live="polite" className="text-[12px] font-semibold text-[#8c5a12]">
                      {capsLock ? t("auth.capsLock") : ""}
                    </span>
                    {!isRegister ? (
                      <button
                        type="button"
                        onClick={() => { setMode("reset"); setError(""); }}
                        className="ms-auto rounded text-[13px] font-semibold text-[#0a285a] underline decoration-[#0a285a]/30 underline-offset-4 hover:decoration-[#0a285a]"
                      >
                        {t("auth.forgot")}
                      </button>
                    ) : null}
                  </div>

                  {isRegister && password.length > 0 && <div className="mt-2"><StrengthMeter verdict={verdict} /></div>}
                </div>
              )}

              {/* aria-live so the failure is announced, not just drawn. */}
              {error && (
                <p role="alert" aria-live="polite" className="flex items-start gap-2 rounded-xl border border-[#f2c4b9] bg-[#fdeceb] px-3.5 py-3 text-[13px] leading-5 text-[#8c2f22]">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{tError(error)}</span>
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
                  : <LogIn className="size-4 rtl:-scale-x-100" />}
                {t(pending ? busyLabel : isReset ? "auth.resetSend" : isRegister ? "account.createAccount" : "header.signIn")}
              </button>
            </form>

            <div className="mt-5 space-y-3">
              {isReset ? (
                <button
                  onClick={() => { setMode("signin"); setError(""); }}
                  className="inline-flex items-center gap-1.5 rounded text-[13px] font-semibold text-[#0a285a] hover:underline"
                >
                  <ArrowLeft className="size-3.5 rtl:-scale-x-100" />{t("auth.resetBack")}
                </button>
              ) : null}

              <p className="flex items-start gap-2 border-t border-[#eef1f5] pt-4 text-[12px] leading-5 ink-muted">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("auth.secureNote")}
              </p>
              {isRegister && (
                <p className="text-[12px] leading-5 ink-muted">{t("auth.terms")}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Navy on focus, as every field in the shop and the portal is: the orange ring
   this had was the one field on the site that took the brand colour as ink. */
const inputClass =
  "type-body h-[52px] w-full rounded-xl border border-[#cfd9e6] bg-white px-3.5 pt-4 text-[15px] text-[#0a285a] outline-none transition focus:border-[#0a285a] focus:ring-2 focus:ring-[#0a285a]/15";

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
              ? "top-2 translate-y-0 text-[11px] font-semibold text-[#536b8c]"
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
    <div role="tablist" className="mt-6 grid grid-cols-2 gap-1 rounded-2xl bg-[#eef1f6] p-1">
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
        <span className="type-label text-[12px] font-semibold ink-muted">
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
 * kind of claim worth putting next to a password box. Under them, the three
 * facts every order carries — delivery to every governorate, cash on delivery,
 * the return window from the constant the API refuses on. Hidden below `lg`,
 * where the form should have the whole screen.
 *
 * The content sits together in the middle rather than split to the two ends
 * of the panel, which left a navy gap the height of the form between a
 * heading and the list it heads. The logo is the light version, chevron
 * still orange; it was the dark one inverted, which turned the chevron white.
 */
function ShowcasePanel() {
  const { t } = useTranslation();
  const points = [
    { icon: ShoppingBag, title: "auth.panelPointOne", note: "auth.panelPointOneNote" },
    { icon: BellRing, title: "auth.panelPointTwo", note: "auth.panelPointTwoNote" },
    { icon: Store, title: "auth.panelPointThree", note: "auth.panelPointThreeNote" },
  ] as const;
  const facts = [
    { icon: Truck, label: t("checkout.builtForKuwait") },
    { icon: Wallet, label: t("home.payOnDelivery") },
    { icon: RotateCcw, label: t("home.returnsWithin", { days: RETURN_WINDOW_DAYS }) },
  ];

  return (
    <div className="relative hidden flex-col justify-center gap-9 overflow-hidden bg-[#0a285a] px-10 py-12 text-white lg:flex">
      <div>
        <img src={footerLogoImage} alt="" aria-hidden loading="eager" decoding="async" className="h-11 w-auto object-contain" />
        <p className="mt-6 text-[28px] font-extrabold leading-[1.15]">{t("auth.panelTitle")}</p>
      </div>

      <ul className="space-y-5">
        {points.map(point => (
          <li key={point.title} className="flex gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10">
              <point.icon className="size-[18px] ink-accent-on-dark" aria-hidden />
            </span>
            <span>
              <span className="block text-[14px] font-bold">{t(point.title)}</span>
              <span className="mt-0.5 block text-[13px] leading-5 text-white/75">{t(point.note)}</span>
            </span>
          </li>
        ))}
      </ul>

      <ul className="flex flex-wrap gap-2 border-t border-white/12 pt-6">
        {facts.map(fact => (
          <li key={fact.label} className="flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-[12px] font-semibold text-white/90">
            <fact.icon className="size-3.5 shrink-0" aria-hidden />
            {fact.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
