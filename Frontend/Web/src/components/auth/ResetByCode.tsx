/**
 * A new password from the six-digit code in the reset mail — on the owner's
 * word ("password recovery using a verification code sent to the registered
 * email"). The sign-in form's reset ends here, and so does "Your profile"'s
 * "Forgot your current password?": the code and the new password on one
 * screen, so nobody has to leave for the inbox's browser and come back.
 *
 * The link in the same mail still works (`NewPassword`); this is the way the
 * form asks for. The new password is held to the floor every new password is,
 * with the same checklist; saving signs in (`auth.resetWithCode`), and a
 * sign-up whose code never came back is sent to its code step from here too.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleAlert, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { CodeBoxes, PasswordChecklist } from "@/components/auth/AuthForm";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { isCodeShaped, normaliseCode } from "@shared/auth/emailCode";
import { checkPassword } from "@shared/auth/passwordStrength";
import type { MessageKey } from "@shared/i18n/dictionary";

const labelClass = "block text-[14px] font-semibold text-[#0a285a]";
const inputClass = "h-12 w-full rounded-xl border border-[#c9d4e2] bg-white px-4 text-[16px] text-[#0a285a] outline-none transition placeholder:text-[#8a97ab] focus:border-[#0a285a] focus:ring-4 focus:ring-[#0a285a]/10 aria-[invalid=true]:border-[#b3261e]";

export function ResetByCode({ email, remember = true, onSignedIn, onVerify, autoFocus = true }: {
  email: string;
  remember?: boolean;
  onSignedIn: (displayName: string | null) => void;
  /** A sign-up whose code never came back: the sign-up's own code step takes it from here. */
  onVerify: (email: string, password: string) => void;
  autoFocus?: boolean;
}) {
  const { t, tError } = useTranslation();
  const ownId = useId();
  const id = (part: string) => `${ownId}-${part}`;
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const verdict = useMemo(() => checkPassword(password), [password]);

  const finish = trpc.auth.resetWithCode.useMutation({
    onSuccess: answer => (answer.status === "signedIn" ? onSignedIn(answer.user.name) : onVerify(answer.email, password)),
    onError: error => {
      setRefusal(error.message);
      if (error.message === "auth.codeWrong" || error.message === "auth.codeShape") {
        codeInput.current?.focus();
        codeInput.current?.select();
      } else {
        passwordInput.current?.focus();
      }
    },
  });

  useEffect(() => {
    if (autoFocus) window.setTimeout(() => codeInput.current?.focus(), 30);
  }, [autoFocus]);

  const codeIssue: MessageKey | null = !code ? "auth.codeRequired" : !isCodeShaped(code) ? "auth.codeShape" : null;
  const passwordIssue: MessageKey | null = !password ? "auth.passwordRequired" : !verdict.acceptable ? "auth.passwordNeedsRules" : null;
  const showCode = submitted && codeIssue;
  const showPassword = submitted && passwordIssue;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setRefusal(null);
    setSubmitted(true);
    if (codeIssue) { codeInput.current?.focus(); return; }
    if (passwordIssue) { passwordInput.current?.focus(); return; }
    finish.mutate({ email, code, password, remember });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {/* So a password manager files the new password under the right account. */}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <div>
        <label htmlFor={id("code")} className={labelClass}>{t("auth.codeLabel")}</label>
        <CodeBoxes
          id={id("code")}
          inputRef={codeInput}
          value={code}
          onChange={raw => {
            const next = normaliseCode(raw);
            setCode(next);
            if (refusal === "auth.codeWrong" || refusal === "auth.codeShape") setRefusal(null);
            /* A whole code moves on to the password, the way a phone's own fields do. */
            if (isCodeShaped(next) && !password) window.setTimeout(() => passwordInput.current?.focus(), 0);
          }}
          invalid={Boolean(showCode) || refusal === "auth.codeWrong"}
          describedBy={showCode ? id("code-issue") : undefined}
        />
        {showCode ? <p id={id("code-issue")} className="mt-2 text-[13px] font-semibold text-[#b3261e]">{t(codeIssue!)}</p> : null}
      </div>

      <div>
        <label htmlFor={id("password")} className={labelClass}>{t("account.newPassword")}</label>
        <div className="relative mt-1.5">
          <input
            id={id("password")}
            ref={passwordInput}
            name="new-password"
            type={reveal ? "text" : "password"}
            dir="ltr"
            value={password}
            onChange={event => { setPassword(event.target.value); if (refusal && refusal !== "auth.codeWrong") setRefusal(null); }}
            autoComplete="new-password"
            maxLength={200}
            aria-invalid={showPassword ? true : undefined}
            aria-describedby={[showPassword && id("password-issue"), id("rules")].filter(Boolean).join(" ")}
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
        {showPassword ? <p id={id("password-issue")} className="mt-2 text-[13px] font-semibold text-[#b3261e]">{t(passwordIssue!)}</p> : null}
        <PasswordChecklist id={id("rules")} verdict={verdict} typed={password.length > 0} />
      </div>

      {refusal ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-[#f2c4b9] bg-[#fdeceb] px-4 py-3 text-[14px] leading-5 text-[#8c2f22]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{tError(refusal)}</p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={finish.isPending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0a285a] px-5 text-[15px] font-bold text-white transition hover:bg-[#0d3372] disabled:cursor-wait disabled:opacity-80"
      >
        {finish.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        {t(finish.isPending ? "auth.signingIn" : "auth.newPasswordSave")}
      </button>
    </form>
  );
}
