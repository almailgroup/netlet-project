import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Eye } from "lucide-react";
import { useLanguage } from "../../i18n.js";
import { usePageTitle, useNoIndex } from "../../hooks.js";
import { Field, focusFirstProblem } from "../../components/ui/Field.js";
import { PreviewTag } from "../../preview.js";
import { LIMITS, kuwaitPhone } from "../../../shared/shipment.js";
import type { Key } from "../../../shared/i18n.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
type Problems = Partial<Record<"name" | "phone" | "email" | "password", Key>>;

/**
 * Signing in and creating an account, as they will look: the boxes, their
 * rules under each, the password shown on request, and a line above saying
 * nothing typed is sent. A correct form opens the sample account page.
 *
 * Where it connects later: an accounts API behind the same two forms, and a
 * session the account page reads instead of its sample data.
 */
export function SignIn() {
  return <AuthForm mode="signIn" />;
}

export function SignUp() {
  return <AuthForm mode="signUp" />;
}

function AuthForm({ mode }: { mode: "signIn" | "signUp" }) {
  const { t } = useLanguage();
  const [, navigate] = useLocation();
  usePageTitle(t(mode === "signIn" ? "title.signIn" : "title.signUp"));
  useNoIndex();
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [problems, setProblems] = useState<Problems>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: Problems = {};
    if (mode === "signUp") {
      if (!name.trim()) found.name = "auth.nameNeeded";
      else if (name.trim().length > LIMITS.name) found.name = "form.tooLong";
      if (!kuwaitPhone(phone)) found.phone = "form.phoneShape";
    }
    if (!EMAIL.test(email.trim())) found.email = "auth.emailNeeded";
    if (password.length < MIN_PASSWORD) found.password = "auth.passwordShort";
    setProblems(found);
    if (Object.keys(found).length) {
      requestAnimationFrame(() => focusFirstProblem(form.current));
      return;
    }
    navigate("/account");
  };

  return (
    <div className="container">
      <div className="auth-card card">
        <div className="preview-head">
          <h1 className="page-title">{t(mode === "signIn" ? "auth.signInTitle" : "auth.signUpTitle")}</h1>
          <PreviewTag />
        </div>
        <p className="page-lead">{t(mode === "signIn" ? "auth.signInLead" : "auth.signUpLead")}</p>
        <p className="notice notice-preview auth-notice">
          <Eye size={18} aria-hidden="true" />
          <span>{t("auth.preview")}</span>
        </p>
        <form ref={form} className="form-grid" onSubmit={submit} noValidate>
          {mode === "signUp" ? (
            <>
              <Field id="auth-name" label={t("auth.name")} problem={problems.name}>
                {(describedBy, invalid) => <input id="auth-name" className="input" dir="auto" autoComplete="name" maxLength={LIMITS.name} value={name} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setName(event.target.value)} />}
              </Field>
              <Field id="auth-phone" label={t("auth.phone")} problem={problems.phone}>
                {(describedBy, invalid) => <input id="auth-phone" className="input ltr-input" type="tel" inputMode="tel" autoComplete="tel-national" value={phone} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setPhone(event.target.value)} />}
              </Field>
            </>
          ) : null}
          <Field id="auth-email" label={t("auth.email")} problem={problems.email}>
            {(describedBy, invalid) => <input id="auth-email" className="input ltr-input" type="email" autoComplete="email" value={email} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setEmail(event.target.value)} />}
          </Field>
          <Field id="auth-password" label={t("auth.password")} problem={problems.password}>
            {(describedBy, invalid) => (
              <div className="password-row">
                <input id="auth-password" className="input ltr-input" type={shown ? "text" : "password"} autoComplete={mode === "signIn" ? "current-password" : "new-password"} value={password} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={event => setPassword(event.target.value)} />
                <button type="button" className="button button-secondary" aria-pressed={shown} onClick={() => setShown(value => !value)}>
                  {t(shown ? "auth.hidePassword" : "auth.showPassword")}
                </button>
              </div>
            )}
          </Field>
          <button type="submit" className="button button-primary button-block">{t(mode === "signIn" ? "auth.signIn" : "auth.create")}</button>
        </form>
        <p className="auth-switch">
          {t(mode === "signIn" ? "auth.newHere" : "auth.haveAccount")}{" "}
          <Link href={mode === "signIn" ? "/signup" : "/signin"}>{t(mode === "signIn" ? "auth.createLink" : "auth.signInLink")}</Link>
        </p>
      </div>
    </div>
  );
}
