/**
 * Signing in with a one-time code, second half: the six digits emailed to the
 * account, in the sign-up's own six boxes (`CodeBoxes`), sent by themselves on
 * the sixth digit.
 *
 * **It never says whether the address has an account.** The sentence says a
 * code is on its way *if* it does, and a wrong code, an expired one and an
 * address with no account are one refusal, so the step cannot be used to ask
 * who is registered (`auth.codeStart`). "Send a new code" waits a minute,
 * Supabase's own interval between mails to one address; "Use my password
 * instead" goes back to the form with the password box open.
 */
import { CircleAlert, Check, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { CODE_LENGTH, isCodeShaped, normaliseCode, RESEND_WAIT_SECONDS } from "@shared/auth/emailCode";
import { PORTAL_SIDE } from "@/lib/portalHost";
import type { PortalSide } from "@shared/portal";
import { alertClass, CodeBoxes, Issue, linkClass, MailTile, NotArrived, primaryClass, titleClass } from "./AuthForm";

type SignedIn = { name: string | null; portal: { side: PortalSide; url: string } | null };

export function SignInCode({ email, remember, Heading, headingId, onSignedIn, onUsePassword, onDifferent }: {
  email: string;
  remember: boolean;
  Heading: "h1" | "h2";
  headingId: string;
  onSignedIn: (user: SignedIn) => void;
  onUsePassword: () => void;
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

  const signIn = trpc.auth.codeSignIn.useMutation({
    onSuccess: user => onSignedIn(user),
    onError: error => {
      setRefusal(error.message);
      input.current?.focus();
      input.current?.select();
    },
  });
  /* Sent or not, the answer is the same: only the throttle is said. */
  const resend = trpc.auth.codeStart.useMutation({
    onSuccess: () => { setWait(RESEND_WAIT_SECONDS); setResent(true); setRefusal(null); },
    onError: error => {
      if (error.message === "auth.tooManyAttempts") setRefusal(error.message);
      else { setWait(RESEND_WAIT_SECONDS); setResent(true); }
    },
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
    /* On the shop, somebody who belongs on a portal is handed on to it. */
    signIn.mutate({ email, code: value, remember, portal: !PORTAL_SIDE });
  };

  const change = (raw: string) => {
    const next = normaliseCode(raw);
    setCode(next);
    if (refusal === "auth.codeWrong" || refusal === "auth.codeShape") setRefusal(null);
    if (isCodeShaped(next) && next !== lastTried.current && !signIn.isPending) send(next);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!isCodeShaped(code)) { input.current?.focus(); return; }
    send(code);
  };

  const issue = submitted && !code ? "auth.codeRequired" : submitted && code.length < CODE_LENGTH ? "auth.codeShape" : null;
  const invalid = Boolean(issue) || refusal === "auth.codeWrong";
  const marker = "⁣";
  const [before, after = ""] = t("auth.signInCodeBody", { email: marker }).split(marker);
  const [resentBefore, resentAfter = ""] = t("auth.signInCodeResent", { email: marker }).split(marker);

  return (
    <div>
      <MailTile />
      <Heading id={headingId} className={`mt-5 ${titleClass}`}>
        {t("auth.verifyTitle")}
      </Heading>
      <p id={`${ownId}-body`} className="mt-2 text-[15px] leading-6 text-[#3d5170]">
        {before}<bdi dir="ltr" className="font-bold text-[#0a285a]">{email}</bdi>{after}
      </p>

      <form onSubmit={submit} noValidate className="mt-6">
        <label htmlFor={`${ownId}-code`} className="sr-only">{t("auth.codeLabel")}</label>
        <CodeBoxes
          id={`${ownId}-code`}
          inputRef={input}
          value={code}
          onChange={change}
          invalid={invalid}
          describedBy={[`${ownId}-body`, issue && `${ownId}-issue`].filter(Boolean).join(" ")}
        />
        {issue ? <Issue id={`${ownId}-issue`}>{t(issue)}</Issue> : null}

        {refusal && refusal !== "auth.codeShape" ? (
          <div role="alert" className={`mt-4 ${alertClass}`}>
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p>{tError(refusal)}</p>
              {refusal === "auth.codeUsePassword" ? (
                <button type="button" onClick={onUsePassword} className="mt-1 rounded font-bold underline underline-offset-4">
                  {t("auth.usePasswordInstead")}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {resent && !refusal ? (
          <p role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-[#e9f4ee] px-4 py-3 text-[14px] leading-5 text-[#1f5e3a]">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{resentBefore}<bdi dir="ltr">{email}</bdi>{resentAfter}</span>
          </p>
        ) : null}

        <button type="submit" disabled={signIn.isPending} className={`mt-5 ${primaryClass}`}>
          {signIn.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t(signIn.isPending ? "auth.signingIn" : "header.signIn")}
        </button>
        <button type="button" onClick={onUsePassword} className={`mt-3 flex min-h-11 w-full items-center justify-center text-[14px] ${linkClass}`}>
          {t("auth.usePasswordInstead")}
        </button>
      </form>

      <NotArrived
        resendLabel={resend.isPending ? t("auth.sending") : wait > 0 ? t("auth.resendCodeIn", { seconds: wait }) : t("auth.resendCode")}
        resendDisabled={wait > 0 || resend.isPending}
        onResend={() => resend.mutate({ email })}
        onDifferent={onDifferent}
      />
    </div>
  );
}
