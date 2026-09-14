/**
 * The shopper's own record: their name, and the two things they sign in with.
 *
 * Each is its own small form with its own Save, because they are three
 * different decisions and one Save across all of them would change a password
 * somebody only opened the panel to correct a spelling in.
 *
 * Each is also its own `SettingPanel`, a sibling of the next rather than a row
 * inside a card of its own — the page already names the section above them, so
 * a wrapper card would have repeated that heading and nested three cards in a
 * fourth for nothing.
 *
 * Email and password both ask for the current password again. A session left
 * open on a shared machine should not be enough to take an account over, and
 * moving the login address or the password is exactly what somebody doing that
 * would reach for. The server enforces it; this only asks.
 */
import { SettingPanel } from "@/components/SettingPanel";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { checkPassword } from "@shared/auth/passwordStrength";
import { isMessageKey } from "@shared/i18n/dictionary";
import { AtSign, Check, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

type PublicUser = { id: number; email: string; name: string | null; role: string };

const field =
  "type-body h-11 w-full rounded-xl border border-[#d5dfeb] bg-white px-3.5 text-[14px] text-[#0a285a] outline-none transition focus:border-[#f2683a] focus:ring-2 focus:ring-[#f2683a]/25";

const primary =
  "glass glass-navy pressable inline-flex h-11 items-center gap-2 rounded-xl px-4 text-xs font-extrabold disabled:opacity-50";

const secondary =
  "glass pressable inline-flex h-11 items-center rounded-xl border border-[#d5dfeb] px-4 text-xs font-extrabold text-[#0a285a]";

const link = "text-[12px] font-extrabold ink-accent underline underline-offset-4";

export function ProfileManager({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const refresh = () => void utils.auth.me.invalidate();
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed"));

  return (
    <div className="space-y-4">
      <NameForm user={user} onSaved={refresh} onFail={fail} />
      <EmailForm user={user} onSaved={refresh} onFail={fail} />
      <PasswordForm onFail={fail} />
    </div>
  );
}

function NameForm({ user, onSaved, onFail }: {
  user: PublicUser;
  onSaved: () => void;
  onFail: (error: { message: string }) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState(user.name ?? "");
  useEffect(() => { setName(user.name ?? ""); }, [user.name]);

  const save = trpc.auth.updateName.useMutation({
    onSuccess: () => { onSaved(); toast.success(t("account.nameSaved")); },
    onError: onFail,
  });

  const changed = name.trim() !== (user.name ?? "").trim();

  return (
    <SettingPanel
      icon={<UserRound className="size-5" />}
      title={t("account.displayName")}
      note={t("account.displayNameNote")}
    >
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          dir="auto"
          value={name}
          placeholder={t("account.noName")}
          onChange={event => setName(event.target.value)}
          aria-label={t("account.displayName")}
          className={`${field} min-w-0 flex-1`}
        />
        <button onClick={() => save.mutate({ name })} disabled={!changed || save.isPending} className={primary}>
          {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("account.saveChanges")}
        </button>
      </div>
    </SettingPanel>
  );
}

function EmailForm({ user, onSaved, onFail }: {
  user: PublicUser;
  onSaved: () => void;
  onFail: (error: { message: string }) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const save = trpc.auth.changeEmail.useMutation({
    onSuccess: () => {
      onSaved();
      toast.success(t("account.emailChanged"));
      setOpen(false); setEmail(""); setPassword("");
    },
    onError: onFail,
  });

  return (
    <SettingPanel
      icon={<AtSign className="size-5" />}
      title={t("account.signInEmail")}
      note={t("account.signInEmailNote")}
    >
      <p className="break-words text-sm font-bold text-[#0a285a]">
        <bdi dir="ltr">{user.email}</bdi>
      </p>
      {open ? (
        <div className="mt-3 space-y-2">
          <input
            dir="ltr"
            type="email"
            value={email}
            placeholder={t("account.newEmail")}
            aria-label={t("account.newEmail")}
            onChange={event => setEmail(event.target.value)}
            className={field}
          />
          <input
            dir="ltr"
            type="password"
            autoComplete="current-password"
            value={password}
            placeholder={t("account.currentPassword")}
            aria-label={t("account.currentPassword")}
            onChange={event => setPassword(event.target.value)}
            className={field}
          />
          <p className="text-[11px] leading-4 ink-muted">{t("account.currentPasswordWhy")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => save.mutate({ email: email.trim(), currentPassword: password })}
              disabled={save.isPending || email.trim() === "" || password === ""}
              className={primary}
            >
              {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
              {t("account.saveChanges")}
            </button>
            <button onClick={() => { setOpen(false); setEmail(""); setPassword(""); }} className={secondary}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className={`mt-2 ${link}`}>
          {t("account.changeEmail")}
        </button>
      )}
    </SettingPanel>
  );
}

function PasswordForm({ onFail }: { onFail: (error: { message: string }) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [reveal, setReveal] = useState(false);

  const save = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success(t("account.passwordChanged"));
      setOpen(false); setCurrent(""); setNext(""); setReveal(false);
    },
    onError: onFail,
  });

  // The same rules the sign-up meter applies, so the floor cannot differ
  // between creating a password and replacing one.
  const verdict = checkPassword(next);

  return (
    <SettingPanel
      icon={<KeyRound className="size-5" />}
      title={t("account.password")}
      note={t("account.passwordNote")}
    >
      {open ? (
        <div className="space-y-2">
          <input
            dir="ltr"
            type="password"
            autoComplete="current-password"
            value={current}
            placeholder={t("account.currentPassword")}
            aria-label={t("account.currentPassword")}
            onChange={event => setCurrent(event.target.value)}
            className={field}
          />
          <div className="relative">
            <input
              dir="ltr"
              type={reveal ? "text" : "password"}
              autoComplete="new-password"
              value={next}
              placeholder={t("account.newPassword")}
              aria-label={t("account.newPassword")}
              onChange={event => setNext(event.target.value)}
              className={`${field} pe-12`}
            />
            <button
              type="button"
              onClick={() => setReveal(shown => !shown)}
              aria-pressed={reveal}
              aria-label={t(reveal ? "auth.hidePassword" : "auth.showPassword")}
              className="pressable tap-target absolute top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-[#536b8c] hover:text-[#0a285a] end-2"
            >
              {reveal ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
            </button>
          </div>
          {next.length > 0 && verdict.unmet.length > 0 && (
            <ul className="space-y-0.5">
              {verdict.unmet.map(rule => (
                <li key={rule} className="text-[11px] leading-4 ink-muted">
                  • {t(`auth.rule${rule[0].toUpperCase()}${rule.slice(1)}` as "auth.ruleLength")}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] leading-4 ink-muted">{t("account.currentPasswordWhy")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => save.mutate({ currentPassword: current, newPassword: next })}
              disabled={save.isPending || current === "" || !verdict.acceptable}
              className={primary}
            >
              {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {t("account.changePassword")}
            </button>
            <button onClick={() => { setOpen(false); setCurrent(""); setNext(""); }} className={secondary}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className={link}>
          {t("account.changePassword")}
        </button>
      )}
    </SettingPanel>
  );
}
