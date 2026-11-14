import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Route, Switch } from "wouter";
import { CircleAlert, Info } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { usePageTitle } from "../hooks.js";
import { api } from "../api.js";
import type { Answer } from "../api.js";
import { Field } from "./Field.js";
import { ShipmentList } from "./ShipmentList.js";
import { NewShipment } from "./NewShipment.js";
import { ShipmentPage } from "./ShipmentPage.js";
import { NotFound } from "../pages/NotFound.js";

type Session = { open: boolean; signedIn: boolean; store: "postgres" | "demo" | null; staff: boolean };

type Desk = {
  demo: boolean;
  /** A staff call: a 401 means the session ended, and the desk shows the sign-in again. */
  call: <T>(method: string, path: string, body?: unknown) => Promise<Answer<T>>;
  signOut: () => void;
};
const DeskContext = createContext<Desk | null>(null);

export function useDesk(): Desk {
  const desk = useContext(DeskContext);
  if (!desk) throw new Error("useDesk outside the staff desk");
  return desk;
}

/**
 * The staff desk at /staff: closed until the deployment sets a password and a
 * database, the sign-in until somebody signs in, and then the shipments.
 * Nothing here is linked from the customer's pages but the footer's "Staff
 * sign in", and search engines are told to leave it alone.
 */
export function Staff() {
  const { t } = useLanguage();
  usePageTitle(t("title.staff"));
  const [session, setSession] = useState<Session | null>(null);
  const [ended, setEnded] = useState(false);

  const load = useCallback(async () => {
    const answer = await api<Session>("GET", "/api/staff/session");
    setSession(answer.ok ? answer.body : { open: false, signedIn: false, store: null, staff: false });
  }, []);
  useEffect(() => {
    void load();
    /* Search engines are told to leave the desk alone. */
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    document.head.append(robots);
    return () => robots.remove();
  }, [load]);

  const call = useCallback(async <T,>(method: string, path: string, body?: unknown) => {
    const answer = await api<T>(method, path, body);
    if (!answer.ok && answer.status === 401) {
      setEnded(true);
      setSession(current => (current ? { ...current, signedIn: false } : current));
    }
    return answer;
  }, []);
  const signOut = useCallback(() => {
    void api("DELETE", "/api/staff/session").then(() => {
      setEnded(false);
      setSession(current => (current ? { ...current, signedIn: false } : current));
    });
  }, []);

  if (!session) return <div className="container"><div className="page-head" aria-busy="true" /></div>;
  if (!session.open) {
    return (
      <div className="container narrow">
        <div className="page-head">
          <h1 className="page-title">{t("staff.title")}</h1>
        </div>
        <p className="notice notice-attention" role="status">
          <Info size={18} aria-hidden="true" />
          {t(!session.staff ? "staff.closed" : "staff.noStore")}
        </p>
      </div>
    );
  }
  if (!session.signedIn) return <SignIn ended={ended} onSignedIn={() => { setEnded(false); void load(); }} />;

  return (
    <DeskContext.Provider value={{ demo: session.store === "demo", call, signOut }}>
      <div className="container">
        {session.store === "demo" ? (
          <p className="notice notice-attention demo-note">
            <Info size={18} aria-hidden="true" />
            {t("staff.demo")}
          </p>
        ) : null}
        <Switch>
          <Route path="/staff" component={ShipmentList} />
          <Route path="/staff/new" component={NewShipment} />
          <Route path="/staff/shipments/:id">{params => <ShipmentPage id={params.id} />}</Route>
          <Route component={NotFound} />
        </Switch>
      </div>
    </DeskContext.Provider>
  );
}

function SignIn({ ended, onSignedIn }: { ended: boolean; onSignedIn: () => void }) {
  const { t } = useLanguage();
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setProblem("staff.passwordNeeded");
      input.current?.focus();
      return;
    }
    setBusy(true);
    const answer = await api("POST", "/api/staff/session", { password });
    setBusy(false);
    if (answer.ok) return onSignedIn();
    setProblem(answer.error === "wrongPassword" ? "staff.wrongPassword" : answer.error === "tooMany" ? "staff.tooMany" : "error.generic");
    input.current?.select();
    input.current?.focus();
  };

  return (
    <div className="container narrow">
      <div className="page-head">
        <h1 className="page-title">{t("staff.signInTitle")}</h1>
        <p className="page-lead">{t("staff.signInLead")}</p>
      </div>
      <form className="card sign-in" onSubmit={submit} noValidate>
        {ended ? (
          <p className="notice notice-attention sign-in-note" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            {t("error.signedOut")}
          </p>
        ) : null}
        <Field id="staff-password" label={t("staff.password")} problem={problem ?? undefined}>
          {(describedBy, invalid) => (
            <div className="password-row">
              <input
                ref={input}
                id="staff-password"
                className="input ltr-input"
                type={shown ? "text" : "password"}
                value={password}
                onChange={event => {
                  setPassword(event.target.value);
                  if (problem === "staff.passwordNeeded") setProblem(null);
                }}
                autoComplete="current-password"
                autoFocus
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
              />
              <button type="button" className="button button-quiet button-small" onClick={() => setShown(value => !value)} aria-label={shown ? t("staff.hideName") : t("staff.showName")} aria-pressed={shown}>
                {shown ? t("staff.hide") : t("staff.show")}
              </button>
            </div>
          )}
        </Field>
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>{busy ? t("staff.signingIn") : t("staff.signIn")}</button>
        </div>
      </form>
    </div>
  );
}
