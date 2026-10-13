/**
 * Sign in, create an account, reset a password — the form, wherever it is drawn.
 *
 * One form for three places: the dialog the header opens where the shopper is,
 * the `/signin` and `/signup` pages a link can point at, and `/account` while
 * signed out. Three copies is how a rule gets fixed in one and not the others.
 *
 * Credentials go to NetLet's own `auth.login` / `auth.register`, which set an
 * httpOnly session cookie, so nothing token-shaped is ever held in JavaScript.
 * There is no social sign-in: it needs a provider configured and a redirect the
 * server trusts, and a Google button that does nothing is worse than none.
 *
 * What the form does for the person filling it in, each for a reason:
 *
 * - **Labels sit above the boxes and stay there.** A label inside the box that
 *   lifts as you type is a template's flourish; a filled form should still say
 *   what each box is.
 * - **It says what is wrong under the box that is wrong**, once Submit has
 *   been pressed, and stops saying it the moment the box is put right. Submit
 *   moves focus to the first one, and is never greyed out with no reason
 *   beside it.
 * - **A mistyped email domain is offered back** ("Did you mean …@gmail.com?",
 *   `shared/auth/emailTypo.ts`) once typing pauses: an account made at
 *   `gmial.com` has no way back in once its password is forgotten.
 * - **Nothing appears because a box lost focus.** It did, and a line arriving
 *   above a button as the pointer went down on it moved the button before the
 *   pointer came up, so the press landed on nothing — on a phone, after Caps
 *   Lock had been said, "Create an account" took two taps.
 * - **The password can be shown, Caps Lock is said while it is on**, and on
 *   sign-up the two rules that block are a checklist from the start rather
 *   than a list of failures afterwards. The rest only make it stronger, and say
 *   so: composition rules that refuse a long passphrase make passwords worse.
 * - **A refusal offers the next step.** A wrong password offers the reset; a
 *   taken address offers signing in with it.
 * - **"Keep me signed in"** is on by default; off, the session ends with the
 *   browser, for a shared device.
 * - **Reset ends on a page that says what happened**, naming the address, with
 *   a way to send it again and a way to correct the address. The reply is the
 *   same whether or not the address has an account, so it cannot be used to
 *   ask who is registered.
 * - **An account is made from an address somebody has shown they read.**
 *   Create account is two steps: the details and Google's "I'm not a robot"
 *   box, then a six-digit code sent to the address. Nothing is made until the
 *   code comes back, and the form keeps everything typed in the first step,
 *   so "use a different email" loses nothing else. A sign-in with the right
 *   password on an account whose code never came back goes to the same step
 *   rather than being told the password is wrong.
 */
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft, Check, CircleAlert, Eye, EyeOff, LoaderCircle, Lock, MailCheck,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { checkPassword, type PasswordRule } from "@shared/auth/passwordStrength";
import { suggestEmail } from "@shared/auth/emailTypo";
import { CODE_LENGTH, isCodeShaped, normaliseCode, RESEND_WAIT_SECONDS as CODE_RESEND_SECONDS } from "@shared/auth/emailCode";
import type { MessageKey } from "@shared/i18n/dictionary";
import { clearReferral, storedReferral } from "@/lib/referral";
import { HumanCheck } from "./HumanCheck";

export type AuthMode = "signin" | "register" | "reset";

/** Good enough to catch a typo; the server is what actually decides. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** How long typing has to pause before an email domain is second-guessed. */
const SUGGEST_AFTER_MS = 700;

/** How long "Send again" waits, so a reset cannot be posted in a loop from one page. */
const RESEND_WAIT_SECONDS = 30;

const BAND_LABEL = {
  weak: "auth.strengthWeak",
  fair: "auth.strengthFair",
  good: "auth.strengthGood",
  strong: "auth.strengthStrong",
} as const;

/* The bar's colours. The band's word beside it is navy: these are fills, and
   the amber and red are not inks at 12px. */
const BAND_FILL = {
  weak: "#d0453a",
  fair: "#d08a1e",
  good: "#2f7d4f",
  strong: "#1d6b40",
} as const;

/** The two rules that block, then the three that only strengthen. */
const REQUIRED: { rule: PasswordRule; label: MessageKey }[] = [
  { rule: "length", label: "auth.ruleLength" },
  { rule: "notCommon", label: "auth.ruleNotCommon" },
];
const STRONGER: { rule: PasswordRule; label: MessageKey }[] = [
  { rule: "case", label: "auth.ruleCase" },
  { rule: "number", label: "auth.ruleNumber" },
  { rule: "symbol", label: "auth.ruleSymbol" },
];

/** A refusal and, where there is one, what to do about it. */
type Refusal = { message: string; next?: "reset" | "signin" };

/** Everything the code step needs to make the account, held by the form. */
type AwaitingCode = {
  email: string;
  password: string;
  name?: string;
  referral?: string;
  remember: boolean;
  /** Registering, or signing in to an account whose code never came back. */
  from: "register" | "signin";
};

export function AuthForm({
  mode,
  onModeChange,
  onDone,
  heading: Heading = "h2",
  titleId,
  autoFocus = false,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  /** After a sign-in or a registration has landed. */
  onDone?: () => void;
  /** The dialog's title is an `h2` under the page's; a page of its own makes it the `h1`. */
  heading?: "h1" | "h2";
  titleId?: string;
  /** Focus the first box on arrival. A dialog or a page of its own does; a section of a page does not. */
  autoFocus?: boolean;
}) {
  const { t, tError, locale } = useTranslation();
  const utils = trpc.useUtils();
  const ownId = useId();
  const id = (part: string) => `${ownId}-${part}`;
  const headingId = titleId ?? id("title");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  /** The address a reset link went to, which turns the reset form into its confirmation. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  /** Set once a code has gone out, which turns the form into the code step. */
  const [awaiting, setAwaiting] = useState<AwaitingCode | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef<HTMLHeadingElement>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  /* Whether the next mode change was asked for here, which is when focus has to
     move: the control pressed has gone by the next frame. */
  const movedByUs = useRef(false);

  const isRegister = mode === "register";
  const isReset = mode === "reset";

  /* A fresh start for each mode; the email carries over, because it is the same person. */
  useEffect(() => {
    setPassword("");
    setReveal(false);
    setCapsLock(false);
    setSubmitted(false);
    setRefusal(null);
    setSentTo(null);
    setAwaiting(null);
    if (!movedByUs.current && !autoFocus) return;
    movedByUs.current = false;
    const first = mode === "register" ? nameRef.current : email && mode === "signin" ? passwordRef.current : emailRef.current;
    window.setTimeout(() => first?.focus(), 30);
    // The email is read for where to land, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, autoFocus]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const go = (next: AuthMode) => {
    movedByUs.current = true;
    onModeChange(next);
  };

  const settle = async (displayName: string | null) => {
    await utils.auth.me.invalidate();
    toast.success(displayName ? t("auth.welcomeName", { name: displayName.split(/\s+/)[0] }) : t("auth.signedIn"));
    setPassword("");
    onDone?.();
  };

  const resendCode = trpc.auth.resendCode.useMutation();
  const login = trpc.auth.login.useMutation({
    onSuccess: user => void settle(user.name),
    onError: (error, input) => {
      /* The right password, and a code that never came back: a fresh code, and
         the step that takes it. The one it was first sent may be long expired. */
      if (error.message === "auth.emailNotConfirmed") {
        setAwaiting({ email: input.email, password: input.password, remember: input.remember !== false, from: "signin" });
        resendCode.mutate({ email: input.email });
        return;
      }
      setRefusal({ message: error.message, next: error.message === "auth.invalidCredentials" ? "reset" : undefined });
      if (error.message === "auth.invalidCredentials") { passwordRef.current?.focus(); passwordRef.current?.select(); }
    },
  });
  /* Google's box, when the server has it configured. Asked only on Create
     account, so nobody else fetches anything of Google's. */
  const signupOptions = trpc.auth.signupOptions.useQuery(undefined, { enabled: isRegister, staleTime: Infinity });
  const captchaKey = signupOptions.data?.captchaSiteKey ?? null;
  const register = trpc.auth.register.useMutation({
    onSuccess: (answer, input) => {
      if (answer.status === "verify") {
        setAwaiting({ email: answer.email, password: input.password, name: input.name, referral: input.referral, remember: true, from: "register" });
        return;
      }
      /* A project that confirms addresses itself made the account on the spot.
         Forgotten once used, so an invitation cannot ride along on a second
         account made from the same browser. */
      clearReferral();
      void settle(answer.user.name);
    },
    onError: error => setRefusal({ message: error.message, next: error.message === "auth.emailTaken" ? "signin" : undefined }),
    /* A tick is good once, sent or refused — forgotten here too, because the
       box may already have gone (the code step replaced it) and cannot say so. */
    onSettled: () => { setCaptcha(null); setCaptchaReset(count => count + 1); },
  });
  const reset = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: (_answer, input) => { setSentTo(input.email); setWait(RESEND_WAIT_SECONDS); },
    onError: (error, input) => {
      /* The throttle counts every request whoever the address belongs to, so
         saying so tells nobody anything; any other failure reads as sent,
         because the reply must not vary by address. */
      if (error.message === "auth.tooManyAttempts") setRefusal({ message: error.message });
      else { setSentTo(input.email); setWait(RESEND_WAIT_SECONDS); }
    },
  });
  const pending = login.isPending || register.isPending || reset.isPending;

  /* The heading, so what happened is the first thing read; the button pressed has gone. */
  useEffect(() => {
    if (sentTo) window.setTimeout(() => sentRef.current?.focus(), 30);
  }, [sentTo]);

  /* Read once: a code that arrives while the form is open belongs to the next visit. */
  const invited = useMemo(() => storedReferral(), []);
  const verdict = useMemo(() => checkPassword(password), [password]);
  /* Offered once typing pauses, and withdrawn as soon as it no longer applies. */
  useEffect(() => {
    const likely = isReset ? null : suggestEmail(email);
    if (!likely) { setSuggestion(null); return; }
    const timer = window.setTimeout(() => setSuggestion(likely), SUGGEST_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [email, isReset]);

  const trimmed = email.trim();
  const emailIssue: MessageKey | null = !trimmed ? "auth.emailRequired" : !EMAIL_SHAPE.test(trimmed) ? "auth.emailInvalid" : null;
  const passwordIssue: MessageKey | null = isReset
    ? null
    : !password
      ? "auth.passwordRequired"
      : isRegister && !verdict.acceptable ? "auth.passwordNeedsRules" : null;
  const captchaIssue: MessageKey | null = isRegister && captchaKey && !captcha ? "auth.captchaRequired" : null;
  /* Said once Submit has been pressed, and only for as long as it is true. */
  const showEmailIssue = submitted && emailIssue;
  const showPasswordIssue = submitted && passwordIssue;
  const showCaptchaIssue = submitted && captchaIssue;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setRefusal(null);
    setSubmitted(true);
    setSuggestion(isReset ? null : suggestEmail(email));
    if (emailIssue) { emailRef.current?.focus(); return; }
    if (passwordIssue) { passwordRef.current?.focus(); return; }
    /* Google's box is an iframe and cannot take focus from here; it is brought
       into view, with the sentence under it saying what it wants. */
    if (captchaIssue) { captchaRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    /* The locale is sent and unused for now: Supabase composes the reset mail
       from a dashboard template. It is here for when those are translated. */
    if (isReset) reset.mutate({ email: trimmed, locale });
    else if (isRegister) register.mutate({ email: trimmed, password, name: name.trim() || undefined, referral: storedReferral(), captcha: captcha ?? undefined });
    else login.mutate({ email: trimmed, password, remember });
  };

  /* Caps Lock, read from any key pressed in the form, and kept when the box
     loses focus: it is still on, and taking the line away would move what is
     under it while somebody presses it. */
  const readCapsLock = (event: React.KeyboardEvent) => {
    if (event.getModifierState) setCapsLock(event.getModifierState("CapsLock"));
  };

  if (awaiting) {
    return (
      <CodeStep
        awaiting={awaiting}
        Heading={Heading}
        headingId={headingId}
        resending={resendCode.isPending}
        onDone={user => {
          if (awaiting.from === "register") clearReferral();
          setAwaiting(null);
          void settle(user.name);
        }}
        onDifferent={() => {
          setAwaiting(null);
          window.setTimeout(() => emailRef.current?.focus(), 30);
        }}
      />
    );
  }

  if (isReset && sentTo) {
    return (
      <ResetSent
        email={sentTo}
        Heading={Heading}
        headingId={headingId}
        wait={wait}
        sending={reset.isPending}
        headingRef={sentRef}
        onResend={() => reset.mutate({ email: sentTo, locale })}
        onDifferent={() => { setSentTo(null); window.setTimeout(() => emailRef.current?.focus(), 30); }}
        onBack={() => go("signin")}
      />
    );
  }

  const describe = (...ids: (string | false | null | undefined)[]) => ids.filter(Boolean).join(" ") || undefined;
  const busyLabel: MessageKey = isReset ? "auth.sending" : isRegister ? "auth.sendingCode" : "auth.signingIn";

  return (
    <div>
      {isReset ? (
        <button
          type="button"
          onClick={() => go("signin")}
          className="-ms-1 mb-5 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[14px] font-semibold text-[#0a285a]"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
          {t("auth.resetBack")}
        </button>
      ) : null}

      {isRegister ? <Steps step={1} /> : null}

      <Heading id={headingId} className="text-[26px] font-extrabold leading-tight text-[#0a285a] sm:text-[28px]">
        {t(isReset ? "auth.resetTitle" : isRegister ? "auth.createTitle" : "auth.signInTitle")}
      </Heading>
      <p className="mt-2 text-[15px] leading-6 text-[#536b8c]">
        {t(isReset ? "auth.resetNote" : isRegister ? "auth.createNote" : "auth.signInNote")}
      </p>

      {/* Somebody who followed a friend's link is told what it gets them, on
          the form where they are deciding whether to register at all (3.1.14). */}
      {isRegister && invited ? (
        <p className="mt-4 rounded-xl bg-[#f3f2ed] px-4 py-3 text-[13px] leading-5 text-[#3d5170]">
          {t("auth.referralInvited")}
        </p>
      ) : null}

      <form onSubmit={submit} onKeyDown={readCapsLock} onKeyUp={readCapsLock} noValidate className="mt-7 space-y-5">
        {isRegister ? (
          <div>
            <label htmlFor={id("name")} className={labelClass}>
              {t("auth.name")} <span className="font-normal text-[#536b8c]">{t("auth.optional")}</span>
            </label>
            <input
              id={id("name")}
              ref={nameRef}
              name="name"
              value={name}
              onChange={event => setName(event.target.value)}
              autoComplete="name"
              dir="auto"
              maxLength={255}
              aria-describedby={id("name-hint")}
              className={`${inputClass} mt-2`}
            />
            <p id={id("name-hint")} className={hintClass}>{t("auth.nameHint")}</p>
          </div>
        ) : null}

        <div>
          <label htmlFor={id("email")} className={labelClass}>{t("auth.email")}</label>
          <input
            id={id("email")}
            ref={emailRef}
            name="email"
            type="email"
            inputMode="email"
            dir="ltr"
            value={email}
            onChange={event => { setEmail(event.target.value); if (refusal?.next === "signin") setRefusal(null); }}
            autoComplete={mode === "signin" ? "username" : "email"}
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@example.com"
            maxLength={320}
            aria-invalid={showEmailIssue ? true : undefined}
            aria-describedby={describe(showEmailIssue && id("email-issue"), suggestion && id("email-suggest"))}
            className={`${inputClass} mt-2`}
          />
          {showEmailIssue ? <Issue id={id("email-issue")}>{t(emailIssue)}</Issue> : null}
          {suggestion && !showEmailIssue ? (
            <EmailSuggestion
              id={id("email-suggest")}
              suggestion={suggestion}
              onTake={() => { setEmail(suggestion); emailRef.current?.focus(); }}
            />
          ) : null}
        </div>

        {!isReset ? (
          <div>
            <label htmlFor={id("password")} className={labelClass}>{t("auth.password")}</label>
            <div className="relative mt-2">
              <input
                id={id("password")}
                ref={passwordRef}
                name="password"
                type={reveal ? "text" : "password"}
                dir="ltr"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete={isRegister ? "new-password" : "current-password"}
                maxLength={200}
                aria-invalid={showPasswordIssue ? true : undefined}
                aria-describedby={describe(
                  showPasswordIssue && id("password-issue"),
                  capsLock && id("caps"),
                  isRegister && id("rules"),
                )}
                /* Room for the eye. The box types left to right on either page,
                   so its own end is the right; on the Arabic page the eye sits
                   at the page's end, the left, and the room goes there. */
                className={`${inputClass} pe-12 rtl:pe-4 rtl:ps-12`}
              />
              <button
                type="button"
                onClick={() => setReveal(shown => !shown)}
                aria-pressed={reveal}
                aria-label={t(reveal ? "auth.hidePassword" : "auth.showPassword")}
                title={t(reveal ? "auth.hidePassword" : "auth.showPassword")}
                className="absolute end-1.5 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-[#536b8c] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]"
              >
                {reveal ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
              </button>
            </div>
            {capsLock ? (
              <p id={id("caps")} className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#8c5a12]">
                <CircleAlert className="size-4 shrink-0" aria-hidden />{t("auth.capsLock")}
              </p>
            ) : null}
            {showPasswordIssue ? <Issue id={id("password-issue")}>{t(passwordIssue)}</Issue> : null}
            {isRegister ? <PasswordChecklist id={id("rules")} verdict={verdict} typed={password.length > 0} /> : null}
          </div>
        ) : null}

        {mode === "signin" ? (
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg">
              <input
                type="checkbox"
                checked={remember}
                onChange={event => setRemember(event.target.checked)}
                aria-describedby={id("remember-note")}
                className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-[#0a285a]"
              />
              <span>
                <span className="block text-[14px] font-semibold text-[#0a285a]">{t("auth.remember")}</span>
                <span id={id("remember-note")} className="block text-[12px] leading-5 text-[#536b8c]">{t("auth.rememberNote")}</span>
              </span>
            </label>
            <button
              type="button"
              onClick={() => go("reset")}
              className="rounded text-[14px] font-semibold text-[#0a285a] underline decoration-[#0a285a]/30 underline-offset-4 hover:decoration-[#0a285a]"
            >
              {t("auth.forgot")}
            </button>
          </div>
        ) : null}

        {refusal ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-[#f2c4b9] bg-[#fdeceb] px-4 py-3 text-[14px] leading-5 text-[#8c2f22]">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p>{tError(refusal.message)}</p>
              {refusal.next ? (
                <button
                  type="button"
                  onClick={() => go(refusal.next!)}
                  className="mt-1 rounded font-bold underline underline-offset-4"
                >
                  {t(refusal.next === "reset" ? "auth.resetInstead" : "auth.signInInstead")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {isRegister && captchaKey ? (
          <div ref={captchaRef}>
            <HumanCheck
              siteKey={captchaKey}
              onToken={setCaptcha}
              resetKey={captchaReset}
              issue={showCaptchaIssue ? t(captchaIssue) : null}
              issueId={id("captcha-issue")}
            />
          </div>
        ) : null}

        {isRegister ? <p className="text-[13px] leading-5 text-[#536b8c]">{t("auth.terms")}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0a285a] px-5 text-[15px] font-bold text-white transition hover:bg-[#0d3372] disabled:cursor-wait disabled:opacity-80"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t(pending ? busyLabel : isReset ? "auth.resetSend" : isRegister ? "auth.continue" : "header.signIn")}
        </button>
        {isRegister ? (
          <p className="flex items-start gap-2 text-[13px] leading-5 text-[#536b8c]">
            <MailCheck className="mt-0.5 size-4 shrink-0 text-[#0a285a]" aria-hidden />
            {t("auth.codeWillBeSent")}
          </p>
        ) : null}
      </form>

      {!isReset ? (
        <div className="mt-7">
          <div className="flex items-center gap-3 text-[13px] text-[#536b8c]">
            <span className="h-px flex-1 bg-[#e3e7ee]" aria-hidden />
            <span>{t(isRegister ? "auth.haveAccount" : "auth.newHere")}</span>
            <span className="h-px flex-1 bg-[#e3e7ee]" aria-hidden />
          </div>
          <button
            type="button"
            onClick={() => go(isRegister ? "signin" : "register")}
            className="mt-4 flex h-12 w-full items-center justify-center rounded-xl border border-[#c9d4e2] bg-white px-5 text-[15px] font-bold text-[#0a285a] hover:border-[#0a285a] hover:bg-[#f0f2f5]"
          >
            {t(isRegister ? "header.signIn" : "auth.createCta")}
          </button>
        </div>
      ) : null}

      <p className="mt-7 flex items-start gap-2 text-[12px] leading-5 text-[#536b8c]">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t("auth.secureNote")}
      </p>
    </div>
  );
}

/* Navy on focus, as every field in the shop is, and red while it holds a problem. */
const inputClass =
  "block h-12 w-full rounded-xl border border-[#c9d4e2] bg-white px-4 text-[16px] text-[#0a285a] outline-none transition placeholder:text-[#8494aa] hover:border-[#9fb0c6] focus:border-[#0a285a] focus:ring-4 focus:ring-[#0a285a]/10 aria-[invalid=true]:border-[#b3261e] aria-[invalid=true]:focus:ring-[#b3261e]/15";
const labelClass = "block text-[14px] font-semibold text-[#0a285a]";
const hintClass = "mt-1.5 text-[13px] leading-5 text-[#536b8c]";

function Issue({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold leading-5 text-[#a3261c]">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/**
 * The likely address, offered as one press. The whole line is the button, so
 * it is one target to hit; the address inside it keeps its own direction on
 * the Arabic page.
 */
function EmailSuggestion({ id, suggestion, onTake }: { id: string; suggestion: string; onTake: () => void }) {
  const { t } = useTranslation();
  const marker = "⁣";
  const [before, after = ""] = t("auth.didYouMean", { email: marker }).split(marker);
  return (
    <p id={id} className="mt-2 text-[13px] leading-5 text-[#3d5170]">
      <button type="button" onClick={onTake} className="rounded text-start">
        {before}
        <bdi dir="ltr" className="font-bold text-[#0a285a] underline underline-offset-4">{suggestion}</bdi>
        {after}
      </button>
    </p>
  );
}

/**
 * What the password needs, from the start rather than after a refusal.
 *
 * The two that block are ticks; the three that only strengthen are a row of
 * their own under a label saying so, so nobody thinks a symbol is required.
 * The bar arrives with the first character, because an empty box is not a
 * weak password, it is an unanswered question. The account page's new
 * password draws the same list, so the two say the same thing.
 */
export function PasswordChecklist({ id, verdict, typed }: { id: string; verdict: ReturnType<typeof checkPassword>; typed: boolean }) {
  const { t } = useTranslation();
  const met = (rule: PasswordRule) => typed && !verdict.unmet.includes(rule);
  return (
    <div className="mt-3 rounded-xl bg-[#f6f7f9] px-4 py-3.5">
      {typed ? (
        <div className="mb-3 flex items-center gap-3">
          <div
            className="flex flex-1 gap-1"
            role="meter"
            aria-valuenow={verdict.score}
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuetext={t(BAND_LABEL[verdict.band])}
            aria-label={t("auth.strength")}
          >
            {[0, 1, 2, 3].map(segment => (
              <span
                key={segment}
                className="h-1.5 flex-1 rounded-full transition-colors"
                style={{ background: segment < Math.max(verdict.score, 1) ? BAND_FILL[verdict.band] : "#dde3eb" }}
              />
            ))}
          </div>
          <span className="text-[12px] font-bold text-[#0a285a]">{t(BAND_LABEL[verdict.band])}</span>
        </div>
      ) : null}
      {/* What the box is described by: the two that block, not the advice. */}
      <div id={id}>
      <p className="sr-only">{t("auth.requirements")}</p>
      <ul className="space-y-1.5">
        {REQUIRED.map(item => {
          const done = met(item.rule);
          const failed = typed && item.rule === "notCommon" && !done;
          return (
            <li key={item.rule} className={`flex items-center gap-2 text-[13px] leading-5 ${done ? "text-[#1f5e3a]" : failed ? "text-[#a3261c]" : "text-[#536b8c]"}`}>
              <span className={`grid size-4 shrink-0 place-items-center rounded-full ${done ? "bg-[#2f7d4f] text-white" : failed ? "bg-[#a3261c] text-white" : "border border-[#b6c2d2]"}`} aria-hidden>
                {done ? <Check className="size-3" strokeWidth={3} /> : failed ? <span className="text-[10px] font-bold leading-none">!</span> : null}
              </span>
              <span>
                {t(item.label)}
                <span className="sr-only"> — {t(done ? "auth.ruleMet" : "auth.ruleNotMet")}</span>
              </span>
            </li>
          );
        })}
      </ul>
      </div>
      <p className="mt-3 text-[12px] font-semibold text-[#536b8c]">{t("auth.strongerWith")}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {STRONGER.map(item => {
          const done = met(item.rule);
          return (
            <li
              key={item.rule}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${done ? "border-[#2f7d4f]/30 bg-[#e9f4ee] text-[#1f5e3a]" : "border-[#d5dce6] bg-white text-[#536b8c]"}`}
            >
              {done ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
              {t(item.label)}
              <span className="sr-only"> — {t(done ? "auth.ruleMet" : "auth.ruleNotMet")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Where a reset ends: what happened, to which address, and the two things
 * somebody waiting for a mail does next — send it again, or fix the address.
 * "Send again" waits half a minute, which is about how long a mail takes.
 */
function ResetSent({ email, Heading, headingId, wait, sending, headingRef, onResend, onDifferent, onBack }: {
  email: string;
  Heading: "h1" | "h2";
  headingId: string;
  wait: number;
  sending: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onResend: () => void;
  onDifferent: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const marker = "⁣";
  const [before, after = ""] = t("auth.resetSentBody", { email: marker }).split(marker);
  return (
    <div>
      <span className="grid size-14 place-items-center rounded-2xl bg-[#e9f4ee] text-[#1f5e3a]">
        <MailCheck className="size-7" aria-hidden />
      </span>
      <Heading ref={headingRef} id={headingId} tabIndex={-1} className="mt-6 text-[26px] font-extrabold leading-tight text-[#0a285a] outline-none sm:text-[28px]">
        {t("auth.resetSentTitle")}
      </Heading>
      <p className="mt-3 text-[15px] leading-6 text-[#3d5170]">
        {before}<bdi dir="ltr" className="font-bold text-[#0a285a]">{email}</bdi>{after}
      </p>
      <p className="mt-3 text-[14px] leading-6 text-[#536b8c]">{t("auth.resetSentTip")}</p>

      <button
        type="button"
        onClick={onBack}
        className="mt-8 flex h-12 w-full items-center justify-center rounded-xl bg-[#0a285a] px-5 text-[15px] font-bold text-white hover:bg-[#0d3372]"
      >
        {t("auth.resetBack")}
      </button>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[14px]">
        <button
          type="button"
          onClick={onResend}
          disabled={wait > 0 || sending}
          className="rounded font-semibold text-[#0a285a] underline decoration-[#0a285a]/30 underline-offset-4 hover:decoration-[#0a285a] disabled:cursor-default disabled:text-[#536b8c] disabled:no-underline"
        >
          {sending ? t("auth.sending") : wait > 0 ? t("auth.resendIn", { seconds: wait }) : t("auth.resend")}
        </button>
        <button
          type="button"
          onClick={onDifferent}
          className="rounded font-semibold text-[#0a285a] underline decoration-[#0a285a]/30 underline-offset-4 hover:decoration-[#0a285a]"
        >
          {t("auth.differentEmail")}
        </button>
      </div>
    </div>
  );
}

/**
 * Where Create account is: the details, then the code. Two steps said as two,
 * because the second is an email somebody has to go and open, and a form that
 * says so up front is not a surprise half-way through.
 */
function Steps({ step }: { step: 1 | 2 }) {
  const { t } = useTranslation();
  return (
    <div className="mb-5">
      <p className="text-[13px] font-semibold text-[#536b8c]">
        {t("auth.stepOf", { step, total: 2 })}
        <span aria-hidden> · </span>
        <span className="text-[#0a285a]">{t(step === 1 ? "auth.stepDetails" : "auth.stepConfirm")}</span>
      </p>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        <span className="h-1 flex-1 rounded-full bg-[#f2683a]" />
        <span className={`h-1 flex-1 rounded-full ${step === 2 ? "bg-[#f2683a]" : "bg-[#e3e7ee]"}`} />
      </div>
    </div>
  );
}

/**
 * The code step: six boxes, one field.
 *
 * **It is one input drawn as six boxes**, not six inputs. Six inputs is six
 * stops for a keyboard and a screen reader, a paste that lands one digit in the
 * first box, and a phone's "from Messages/Mail" suggestion that fills nothing;
 * one field with `autocomplete="one-time-code"` takes all of those whole. The
 * boxes are a picture of its value, and the field lies over them, transparent,
 * so a press anywhere on them is a press in it.
 *
 * Six digits submit on their own — the last one typed is the moment the
 * shopper is done — once per code, so a refused one is not sent again until it
 * changes. "Send a new code" waits a minute, which is Supabase's own interval
 * between mails to one address.
 */
function CodeStep({ awaiting, Heading, headingId, resending, onDone, onDifferent }: {
  awaiting: AwaitingCode;
  Heading: "h1" | "h2";
  headingId: string;
  resending: boolean;
  onDone: (user: { name: string | null }) => void;
  onDifferent: () => void;
}) {
  const { t, tError } = useTranslation();
  const ownId = useId();
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [wait, setWait] = useState(CODE_RESEND_SECONDS);
  const [resentTo, setResentTo] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const lastTried = useRef<string | null>(null);

  const verify = trpc.auth.verifyEmail.useMutation({
    onSuccess: user => onDone(user),
    onError: error => {
      setRefusal(error.message);
      input.current?.focus();
      input.current?.select();
    },
  });
  const resend = trpc.auth.resendCode.useMutation({
    onSuccess: () => { setWait(CODE_RESEND_SECONDS); setResentTo(awaiting.email); setRefusal(null); },
    onError: error => setRefusal(error.message),
  });

  useEffect(() => {
    window.setTimeout(() => input.current?.focus(), 30);
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const send = (value: string) => {
    lastTried.current = value;
    setRefusal(null);
    verify.mutate({
      email: awaiting.email,
      password: awaiting.password,
      code: value,
      name: awaiting.name,
      referral: awaiting.referral,
      remember: awaiting.remember,
    });
  };

  const change = (raw: string) => {
    const next = normaliseCode(raw);
    setCode(next);
    if (refusal === "auth.codeWrong" || refusal === "auth.codeShape") setRefusal(null);
    if (isCodeShaped(next) && next !== lastTried.current && !verify.isPending) send(next);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!isCodeShaped(code)) { input.current?.focus(); return; }
    send(code);
  };

  const issue = submitted && !code ? "auth.codeRequired" : submitted && !isCodeShaped(code) ? "auth.codeShape" : null;
  const invalid = Boolean(issue) || refusal === "auth.codeWrong";
  const active = Math.min(code.length, CODE_LENGTH - 1);
  const marker = "\u2063";
  const [before, after = ""] = t(awaiting.from === "register" ? "auth.verifyBody" : "auth.verifyBodySignIn", { email: marker }).split(marker);

  return (
    <div>
      {awaiting.from === "register" ? <Steps step={2} /> : null}
      <span className="grid size-14 place-items-center rounded-2xl bg-[#fdeee8] text-[#a44a2b]">
        <MailCheck className="size-7" aria-hidden />
      </span>
      <Heading id={headingId} className="mt-6 text-[26px] font-extrabold leading-tight text-[#0a285a] sm:text-[28px]">
        {t("auth.verifyTitle")}
      </Heading>
      <p id={`${ownId}-body`} className="mt-3 text-[15px] leading-6 text-[#3d5170]">
        {before}<bdi dir="ltr" className="font-bold text-[#0a285a]">{awaiting.email}</bdi>{after}
      </p>

      <form onSubmit={submit} noValidate className="mt-7">
        <label htmlFor={`${ownId}-code`} className={labelClass}>{t("auth.codeLabel")}</label>
        {/* Read left to right on either page: it is a number, not a sentence. */}
        <div className="relative mt-2 [direction:ltr]">
          <div className="grid grid-cols-6 gap-2" aria-hidden>
            {Array.from({ length: CODE_LENGTH }, (_, index) => {
              const here = focused && index === active;
              return (
                <span
                  key={index}
                  className={`grid h-14 place-items-center rounded-xl border bg-white text-[24px] font-bold tabular-nums text-[#0a285a] transition ${
                    here
                      ? "border-[#0a285a] ring-4 ring-[#0a285a]/10"
                      : invalid
                        ? "border-[#b3261e]"
                        : code[index] ? "border-[#9fb0c6]" : "border-[#c9d4e2]"
                  }`}
                >
                  {code[index] ?? (here ? <span className="h-6 w-px animate-pulse bg-[#0a285a]" /> : "")}
                </span>
              );
            })}
          </div>
          <input
            id={`${ownId}-code`}
            ref={input}
            name="code"
            dir="ltr"
            value={code}
            onChange={event => change(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={32}
            spellCheck={false}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={[`${ownId}-body`, issue && `${ownId}-issue`].filter(Boolean).join(" ")}
            className="absolute inset-0 h-full w-full cursor-text rounded-xl bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent selection:text-transparent"
          />
        </div>
        {issue ? <Issue id={`${ownId}-issue`}>{t(issue)}</Issue> : null}

        {refusal && refusal !== "auth.codeShape" ? (
          <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#f2c4b9] bg-[#fdeceb] px-4 py-3 text-[14px] leading-5 text-[#8c2f22]">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{tError(refusal)}</p>
          </div>
        ) : null}
        {resentTo && !refusal ? (
          <p role="status" className="mt-5 flex items-start gap-2 rounded-xl bg-[#e9f4ee] px-4 py-3 text-[14px] leading-5 text-[#1f5e3a]">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("auth.codeResent", { email: resentTo })}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={verify.isPending}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0a285a] px-5 text-[15px] font-bold text-white transition hover:bg-[#0d3372] disabled:cursor-wait disabled:opacity-80"
        >
          {verify.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t(verify.isPending ? "auth.verifying" : awaiting.from === "register" ? "auth.verifyCreate" : "auth.verifySignIn")}
        </button>
      </form>

      <p className="mt-5 text-[14px] leading-6 text-[#536b8c]">{t("auth.codeTip")}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[14px]">
        <button
          type="button"
          onClick={() => resend.mutate({ email: awaiting.email })}
          disabled={wait > 0 || resend.isPending || resending}
          className="rounded font-semibold text-[#0a285a] underline decoration-[#0a285a]/30 underline-offset-4 hover:decoration-[#0a285a] disabled:cursor-default disabled:text-[#536b8c] disabled:no-underline"
        >
          {resend.isPending || resending ? t("auth.sending") : wait > 0 ? t("auth.resendCodeIn", { seconds: wait }) : t("auth.resendCode")}
        </button>
        <button
          type="button"
          onClick={onDifferent}
          className="rounded font-semibold text-[#0a285a] underline decoration-[#0a285a]/30 underline-offset-4 hover:decoration-[#0a285a]"
        >
          {t("auth.differentEmail")}
        </button>
      </div>
    </div>
  );
}
