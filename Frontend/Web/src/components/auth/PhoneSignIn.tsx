/**
 * "Continue with phone number" — the quickest way into NetLet, on the owner's
 * word: a Kuwaiti mobile, a six-digit code by text, and the account exists.
 *
 * Four steps, one at a time, in the sign-in form's own place:
 *
 * 1. **The number**, after a fixed `+965` (`kuwaitMobile`: eight digits from
 *    4, 5, 6 or 9 — the only numbers NetLet texts), typed left to right on
 *    either page and opening the number keypad. Google's "I'm not a robot"
 *    box sits under it while the shop has one, since every text costs.
 * 2. **The code**, the sign-up's own six boxes (`CodeBoxes`), sent by itself
 *    on the sixth digit, with "Send a new code" after thirty seconds.
 * 3. **Add your email**, only for an account the code just made: optional,
 *    with "Skip for now", because an email is where receipts and a forgotten
 *    password go — and an address is only ever added by a code sent to it, so
 *    a typo cannot hand the account to whoever holds the address.
 * 4. **The email's code**, the same six boxes.
 *
 * `AddEmailFields` is steps 3 and 4 alone, which "Your profile" draws for an
 * account that skipped them.
 */
import { CircleAlert, LoaderCircle, Smartphone } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { clearReferral, storedReferral } from "@/lib/referral";
import { PORTAL_SIDE } from "@/lib/portalHost";
import type { PortalSide } from "@shared/portal";
import { isCodeShaped, normaliseCode, RESEND_WAIT_SECONDS } from "@shared/auth/emailCode";
import { kuwaitMobile, phoneProblem, shownPhone } from "@shared/auth/phone";
import type { MessageKey } from "@shared/i18n/dictionary";
import { HumanCheck } from "./HumanCheck";
import {
  alertClass, BackToSignIn, CodeBoxes, inputClass, Issue, labelClass, linkClass, MailTile, primaryClass, titleClass,
} from "./AuthForm";

type Signed = { name: string | null; portal: { side: PortalSide; url: string } | null };

export function PhoneSignIn({ Heading, headingId, remember, onSignedIn, onBack }: {
  Heading: "h1" | "h2";
  headingId: string;
  remember: boolean;
  /** Signed in, and the email step done or skipped. */
  onSignedIn: (user: Signed, said?: string) => void;
  onBack: () => void;
}) {
  const { t, tError } = useTranslation();
  const ownId = useId();
  const id = (part: string) => `${ownId}-${part}`;
  const [step, setStep] = useState<"number" | "code" | "email">("number");
  const [typed, setTyped] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [signed, setSigned] = useState<Signed | null>(null);
  const numberRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const captchaKey = trpc.auth.signupOptions.useQuery(undefined, { staleTime: Infinity }).data?.captchaSiteKey ?? null;
  const start = trpc.auth.phoneStart.useMutation({
    onSuccess: answer => {
      setPhone(answer.phone);
      setStep("code");
      setRefusal(null);
    },
    onError: error => {
      setRefusal(error.message);
      numberRef.current?.focus();
    },
    onSettled: () => setCaptchaReset(count => count + 1),
  });

  useEffect(() => {
    window.setTimeout(() => (step === "number" ? numberRef.current : headingRef.current)?.focus(), 30);
  }, [step]);

  const problem = phoneProblem(typed);
  const showProblem = submitted && problem;
  const captchaMissing = submitted && captchaKey && !captcha;

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (problem) { numberRef.current?.focus(); return; }
    if (captchaKey && !captcha) return;
    setRefusal(null);
    start.mutate({ phone: kuwaitMobile(typed)!, captcha: captcha ?? undefined });
  };

  if (step === "code" && phone) {
    return (
      <PhoneCode
        phone={phone}
        Heading={Heading}
        headingId={headingId}
        headingRef={headingRef}
        remember={remember}
        onDone={user => {
          if (user.created) clearReferral();
          if (user.needsEmail) {
            setSigned(user);
            setStep("email");
          } else {
            onSignedIn(user);
          }
        }}
        onDifferent={() => { setStep("number"); setSubmitted(false); }}
      />
    );
  }

  if (step === "email" && signed) {
    return (
      <div>
        <AddEmailFields
          Heading={Heading}
          headingId={headingId}
          headingRef={headingRef}
          onAdded={() => onSignedIn(signed, t("auth.addEmailDone"))}
          onSkip={() => onSignedIn(signed)}
        />
      </div>
    );
  }

  return (
    <div>
      <BackToSignIn onClick={onBack} label="auth.useEmailInstead" />
      <span className="grid size-12 place-items-center rounded-2xl bg-[#eef2f8] text-[#0a285a]">
        <Smartphone className="size-6" aria-hidden />
      </span>
      <Heading id={headingId} ref={headingRef} tabIndex={-1} className={`mt-5 ${titleClass}`}>{t("auth.phoneTitle")}</Heading>
      <p id={id("hint")} className="mt-2 text-[15px] leading-6 text-[#3d5170]">{t("auth.phoneHint")}</p>

      <form onSubmit={send} noValidate className="mt-6 space-y-5">
        <div>
          <label htmlFor={id("number")} className={labelClass}>{t("auth.phoneLabel")}</label>
          {/* The number reads left to right on either page, after +965. */}
          <div className="mt-1.5 flex [direction:ltr]">
            <span className="grid h-12 shrink-0 place-items-center rounded-s-xl border border-e-0 border-[#c9d4e2] bg-[#f3f5f9] px-3.5 text-[16px] font-semibold text-[#0a285a]" aria-hidden>
              +965
            </span>
            <input
              id={id("number")}
              ref={numberRef}
              name="phone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={typed}
              onChange={event => { setTyped(event.target.value); if (refusal) setRefusal(null); }}
              autoComplete="tel-national"
              placeholder="5XXX XXXX"
              maxLength={20}
              aria-invalid={showProblem ? true : undefined}
              aria-describedby={[id("hint"), showProblem && id("issue")].filter(Boolean).join(" ")}
              className={`${inputClass} rounded-s-none`}
            />
          </div>
          {showProblem ? <Issue id={id("issue")}>{t(problem)}</Issue> : null}
        </div>

        {captchaKey ? (
          <HumanCheck
            siteKey={captchaKey}
            onToken={setCaptcha}
            resetKey={captchaReset}
            issue={captchaMissing ? t("auth.captchaRequired") : null}
            issueId={id("captcha")}
          />
        ) : null}

        {refusal ? (
          <div role="alert" className={alertClass}>
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{tError(refusal)}</p>
          </div>
        ) : null}

        <button type="submit" disabled={start.isPending} className={primaryClass}>
          {start.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t(start.isPending ? "auth.sendingPhoneCode" : "auth.sendPhoneCode")}
        </button>
      </form>
    </div>
  );
}

type Verified = Signed & { created: boolean; needsEmail: boolean };

/** The texted code: six boxes, sent by itself on the sixth digit. */
function PhoneCode({ phone, Heading, headingId, headingRef, remember, onDone, onDifferent }: {
  phone: string;
  Heading: "h1" | "h2";
  headingId: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  remember: boolean;
  onDone: (user: Verified) => void;
  onDifferent: () => void;
}) {
  const { t, tError } = useTranslation();
  const ownId = useId();
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_WAIT_SECONDS);
  const [resent, setResent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lastTried = useRef<string | null>(null);

  const verify = trpc.auth.phoneVerify.useMutation({
    onSuccess: user => onDone(user),
    onError: error => {
      setRefusal(error.message);
      input.current?.focus();
      input.current?.select();
    },
  });
  const resend = trpc.auth.phoneStart.useMutation({
    onSuccess: () => { setWait(RESEND_WAIT_SECONDS); setResent(true); setRefusal(null); },
    onError: error => setRefusal(error.message),
  });

  useEffect(() => {
    window.setTimeout(() => input.current?.focus(), 60);
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const submitCode = (value: string) => {
    lastTried.current = value;
    setRefusal(null);
    verify.mutate({ phone, code: value, remember, referral: storedReferral(), portal: !PORTAL_SIDE });
  };
  const change = (raw: string) => {
    const next = normaliseCode(raw);
    setCode(next);
    if (refusal === "auth.phoneCodeWrong" || refusal === "auth.codeShape") setRefusal(null);
    if (isCodeShaped(next) && next !== lastTried.current && !verify.isPending) submitCode(next);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!isCodeShaped(code)) { input.current?.focus(); return; }
    submitCode(code);
  };

  const issue: MessageKey | null = submitted && !code ? "auth.codeRequired" : submitted && !isCodeShaped(code) ? "auth.codeShape" : null;
  const marker = "⁣";
  const [before, after = ""] = t("auth.phoneCodeSent", { phone: marker }).split(marker);

  return (
    <div>
      <span className="grid size-12 place-items-center rounded-2xl bg-[#eef2f8] text-[#0a285a]">
        <Smartphone className="size-6" aria-hidden />
      </span>
      <Heading id={headingId} ref={headingRef} tabIndex={-1} className={`mt-5 ${titleClass}`}>{t("auth.phoneCodeTitle")}</Heading>
      <p id={`${ownId}-body`} className="mt-2 text-[15px] leading-6 text-[#3d5170]">
        {before}<bdi dir="ltr" className="font-bold text-[#0a285a]">{shownPhone(phone)}</bdi>{after}
      </p>

      <form onSubmit={submit} noValidate className="mt-6">
        <label htmlFor={`${ownId}-code`} className="sr-only">{t("auth.codeLabel")}</label>
        <CodeBoxes
          id={`${ownId}-code`}
          inputRef={input}
          value={code}
          onChange={change}
          invalid={Boolean(issue) || refusal === "auth.phoneCodeWrong"}
          describedBy={[`${ownId}-body`, issue && `${ownId}-issue`].filter(Boolean).join(" ")}
        />
        {issue ? <Issue id={`${ownId}-issue`}>{t(issue)}</Issue> : null}
        {refusal && refusal !== "auth.codeShape" ? (
          <div role="alert" className={`mt-4 ${alertClass}`}>
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{tError(refusal)}</p>
          </div>
        ) : null}
        {resent && !refusal ? (
          <p role="status" className="mt-4 rounded-xl bg-[#e9f4ee] px-4 py-3 text-[14px] leading-5 text-[#1f5e3a]">
            {t("auth.phoneCodeResent", { phone: shownPhone(phone) })}
          </p>
        ) : null}
        <button type="submit" disabled={verify.isPending} className={`mt-5 ${primaryClass}`}>
          {verify.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t(verify.isPending ? "auth.verifying" : "auth.continue")}
        </button>
      </form>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[#ebe9e1] pt-5 text-[14px]">
        <button
          type="button"
          onClick={() => resend.mutate({ phone })}
          disabled={wait > 0 || resend.isPending}
          className={`min-h-11 ${linkClass}`}
        >
          {resend.isPending ? t("auth.sending") : wait > 0 ? t("auth.resendCodeIn", { seconds: wait }) : t("auth.resendCode")}
        </button>
        <button type="button" onClick={onDifferent} className={`min-h-11 ${linkClass}`}>{t("auth.useDifferentNumber")}</button>
      </div>
    </div>
  );
}

/**
 * Adding an email to an account made with a phone: the address, then the
 * code emailed to it. Optional — `onSkip` is drawn only where skipping is the
 * other choice (straight after signing up).
 */
export function AddEmailFields({ Heading, headingId, headingRef, onAdded, onSkip, compact = false }: {
  Heading?: "h1" | "h2" | "h3";
  headingId?: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  onAdded: () => void;
  onSkip?: () => void;
  /** Drawn inside a card of "Your profile": no title or tile of its own. */
  compact?: boolean;
}) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const ownId = useId();
  const id = (part: string) => `${ownId}-${part}`;
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const lastTried = useRef<string | null>(null);

  const start = trpc.auth.addEmailStart.useMutation({
    onSuccess: answer => {
      setSentTo(answer.email);
      setWait(RESEND_WAIT_SECONDS);
      setRefusal(null);
      setCode("");
      window.setTimeout(() => codeRef.current?.focus(), 60);
    },
    onError: error => { setRefusal(error.message); emailRef.current?.focus(); },
  });
  const verify = trpc.auth.addEmailVerify.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      await utils.auth.myProviders.invalidate();
      toast.success(t("auth.addEmailDone"));
      onAdded();
    },
    onError: error => { setRefusal(error.message); codeRef.current?.focus(); codeRef.current?.select(); },
  });

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const emailIssue: MessageKey | null = submitted && !sentTo
    ? (!email.trim() ? "auth.emailRequired" : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) ? "auth.emailInvalid" : null)
    : null;

  const sendEmail = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { emailRef.current?.focus(); return; }
    setRefusal(null);
    start.mutate({ email: email.trim() });
  };
  const change = (raw: string) => {
    const next = normaliseCode(raw);
    setCode(next);
    if (refusal === "auth.codeWrong") setRefusal(null);
    if (sentTo && isCodeShaped(next) && next !== lastTried.current && !verify.isPending) {
      lastTried.current = next;
      verify.mutate({ email: sentTo, code: next });
    }
  };
  const marker = "⁣";
  const [before, after = ""] = t("auth.addEmailCodeSent", { email: marker }).split(marker);
  const Title = Heading ?? "h2";

  return (
    <div>
      {compact ? null : (
        <>
          <MailTile />
          <Title id={headingId} ref={headingRef} tabIndex={-1} className={`mt-5 ${titleClass}`}>{t("auth.addEmailTitle")}</Title>
          <p className="mt-2 text-[15px] leading-6 text-[#3d5170]">{t("auth.addEmailBody")}</p>
        </>
      )}

      {sentTo ? (
        <form
          onSubmit={event => { event.preventDefault(); if (isCodeShaped(code)) { lastTried.current = code; verify.mutate({ email: sentTo, code }); } else codeRef.current?.focus(); }}
          noValidate
          className={compact ? "" : "mt-6"}
        >
          <p id={id("sent")} className="text-[14px] leading-6 text-[#3d5170]">
            {before}<bdi dir="ltr" className="font-bold text-[#0a285a]">{sentTo}</bdi>{after}
          </p>
          <label htmlFor={id("code")} className="sr-only">{t("auth.codeLabel")}</label>
          <CodeBoxes id={id("code")} inputRef={codeRef} value={code} onChange={change} invalid={refusal === "auth.codeWrong"} describedBy={id("sent")} />
          {refusal ? (
            <div role="alert" className={`mt-4 ${alertClass}`}>
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>{tError(refusal)}</p>
            </div>
          ) : null}
          <button type="submit" disabled={verify.isPending} className={`mt-5 ${primaryClass}`}>
            {verify.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t(verify.isPending ? "auth.verifying" : "auth.continue")}
          </button>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px]">
            <button type="button" onClick={() => start.mutate({ email: sentTo })} disabled={wait > 0 || start.isPending} className={`min-h-11 ${linkClass}`}>
              {start.isPending ? t("auth.sending") : wait > 0 ? t("auth.resendCodeIn", { seconds: wait }) : t("auth.resendCode")}
            </button>
            <button type="button" onClick={() => { setSentTo(null); setSubmitted(false); window.setTimeout(() => emailRef.current?.focus(), 30); }} className={`min-h-11 ${linkClass}`}>
              {t("auth.differentEmail")}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={sendEmail} noValidate className={compact ? "space-y-4" : "mt-6 space-y-5"}>
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
              onChange={event => { setEmail(event.target.value); if (refusal) setRefusal(null); }}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@example.com"
              maxLength={320}
              aria-invalid={emailIssue ? true : undefined}
              aria-describedby={emailIssue ? id("email-issue") : undefined}
              className={`${inputClass} mt-1.5`}
            />
            {emailIssue ? <Issue id={id("email-issue")}>{t(emailIssue)}</Issue> : null}
          </div>
          {refusal ? (
            <div role="alert" className={alertClass}>
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>{tError(refusal)}</p>
            </div>
          ) : null}
          <button type="submit" disabled={start.isPending} className={primaryClass}>
            {start.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t(start.isPending ? "auth.sending" : "auth.addEmailSend")}
          </button>
          {onSkip ? (
            <button type="button" onClick={onSkip} className={`mx-auto flex min-h-11 items-center ${linkClass}`}>{t("auth.addEmailSkip")}</button>
          ) : null}
        </form>
      )}
    </div>
  );
}
