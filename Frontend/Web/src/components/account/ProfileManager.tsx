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
import { SettingPanel } from "@/components/ui/SettingPanel";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { checkPassword } from "@shared/auth/passwordStrength";
import { PasswordChecklist } from "@/components/auth/AuthForm";
import { isMessageKey } from "@shared/i18n/dictionary";
import { AtSign, Check, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { toast } from "sonner";

type PublicUser = { id: number; email: string; name: string | null; role: string };

/*
 * A box with its label inside the rim, drawn to the owner's reference (Noon's
 * "Your profile"): the label small and muted at the top, what is typed under
 * it, a navy rim while it has focus. The label never moves — the sign-in
 * form's rule against one that lifts as you type — it only sits inside.
 */
function FloatingField({ label, end, leftToRight = false, className = "", ...input }: {
  label: string;
  end?: ReactNode;
  /** An email or a password types left to right on either page. */
  leftToRight?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`relative flex min-h-16 items-center gap-2 rounded-2xl border border-[#d5dfeb] bg-white px-4 py-2 transition focus-within:border-[#0a285a] focus-within:ring-2 focus-within:ring-[#0a285a]/15 ${className}`}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[12px] font-medium ink-muted">{label}</label>
        <input id={id} {...input} dir={leftToRight ? "ltr" : input.dir} className="type-body mt-0.5 block w-full bg-transparent text-[16px] font-medium text-[#0a285a] outline-none placeholder:text-[#8a9ab3]" />
      </div>
      {end}
    </div>
  );
}

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
      <div className="space-y-3">
        <FloatingField
          label={t("account.displayName")}
          dir="auto"
          autoComplete="name"
          value={name}
          placeholder={t("account.noName")}
          onChange={event => setName(event.target.value)}
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
      <div className="flex min-h-16 flex-col justify-center rounded-2xl border border-[#e6e9ef] bg-[#f8f9fb] px-4 py-2">
        <span className="block text-[12px] font-medium ink-muted">{t("auth.email")}</span>
        <span className="mt-0.5 block break-words text-[16px] font-medium text-[#0a285a]"><bdi dir="ltr">{user.email}</bdi></span>
      </div>
      {open ? (
        <div className="mt-3 space-y-2.5">
          <FloatingField
            label={t("account.newEmail")}
            leftToRight
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
          <FloatingField
            label={t("account.currentPassword")}
            leftToRight
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
          <p className="text-[12px] leading-4 ink-muted">{t("account.currentPasswordWhy")}</p>
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
  const rulesId = useId();

  return (
    <SettingPanel
      icon={<KeyRound className="size-5" />}
      title={t("account.password")}
      note={t("account.passwordNote")}
    >
      {open ? (
        <div className="space-y-2.5">
          <FloatingField
            label={t("account.currentPassword")}
            leftToRight
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={event => setCurrent(event.target.value)}
          />
          <FloatingField
            label={t("account.newPassword")}
            leftToRight
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            value={next}
            aria-describedby={rulesId}
            onChange={event => setNext(event.target.value)}
            end={
              <button
                type="button"
                onClick={() => setReveal(shown => !shown)}
                aria-pressed={reveal}
                aria-label={t(reveal ? "auth.hidePassword" : "auth.showPassword")}
                className="pressable tap-target grid size-9 shrink-0 place-items-center rounded-lg text-[#536b8c] hover:text-[#0a285a]"
              >
                {reveal ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
              </button>
            }
          />
          <PasswordChecklist id={rulesId} verdict={verdict} typed={next.length > 0} />
          <p className="text-[12px] leading-4 ink-muted">{t("account.currentPasswordWhy")}</p>
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
