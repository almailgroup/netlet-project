/**
 * "Your profile", drawn to the owner's reference (Noon's "Your profile"): the
 * profile photo (`ProfilePhotoCard`), the name as a first and a last name
 * side by side, then the phone, the gender and the birthday
 * (`ProfileDetailCards`), then the password and deleting the account
 * (`DeleteAccount`).
 *
 * **Account security is this page now, on the owner's word** ("remove the
 * account security, instead put all its functions in the edit profile page"):
 * it was a page of its own, a row on the account's home, holding the password
 * and the delete. **The sign-in email card and the dates went from here, also
 * on the owner's word**: the email is said on the home's first card, and
 * changing it is not offered on the page (`auth.changeEmail` stays on the
 * server, unused by it).
 *
 * Each card is its own decision with its own Save — or, for a choice made in
 * one press (a gender), saved as it is pressed — because one Save
 * across all of them would change a password somebody only opened the page to
 * correct a spelling in.
 *
 * The password asks for the current one again. A session left open on a
 * shared machine should not be enough to take an account over, and the
 * password is exactly what somebody doing that would reach for. The server
 * enforces it; this only asks.
 */
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { checkPassword } from "@shared/auth/passwordStrength";
import { PasswordChecklist } from "@/components/auth/AuthForm";
import { ResetByCode } from "@/components/auth/ResetByCode";
import { useAuth } from "@/hooks/useAuth";
import { isMessageKey } from "@shared/i18n/dictionary";
import { nameProblem, NAME_PART_MAX, splitName } from "@shared/commerce/profileDetails";
import { ProfileDetailCards } from "@/components/account/ProfileDetailCards";
import { FloatingField, ProfileCard, primary, secondary } from "@/components/account/profileParts";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { ProfilePhotoCard } from "@/components/account/ProfilePhoto";
import { Check, Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

type PublicUser = { id: number; email: string; name: string | null; role: string };

export function ProfileManager({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const refresh = () => void utils.auth.me.invalidate();
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed"));
  const details = trpc.customer.details.get.useQuery();

  return (
    <div className="space-y-3">
      <ProfilePhotoCard user={user} />
      <NameForm user={user} parts={details.data ? { first: details.data.firstName, last: details.data.lastName } : null} onSaved={refresh} onFail={fail} />
      <ProfileDetailCards details={details.data ?? null} onFail={fail} />
      <PasswordForm onFail={fail} />
      <DeleteAccount />
    </div>
  );
}

/**
 * The first and last name, side by side. An account with no parts yet starts
 * from its display name split at the first space — a guess shown for the
 * shopper to correct ("Abdul Rahman" is one first name), never saved for them.
 */
function NameForm({ user, parts, onSaved, onFail }: {
  user: PublicUser;
  parts: { first: string | null; last: string | null } | null;
  onSaved: () => void;
  onFail: (error: { message: string }) => void;
}) {
  const { t } = useTranslation();
  const stored = parts?.first || parts?.last ? { first: parts.first ?? "", last: parts.last ?? "" } : splitName(user.name);
  const [first, setFirst] = useState(stored.first);
  const [last, setLast] = useState(stored.last);
  const [saved, setSaved] = useState(stored);
  const [tried, setTried] = useState(false);
  /* Seeded once, when the stored parts arrive; after that the boxes are the
     shopper's, so a refetch never puts a guessed split back over a name just
     saved. */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || parts === null) return;
    seeded.current = true;
    setFirst(stored.first);
    setLast(stored.last);
    setSaved(stored);
  }, [parts, stored]);

  const save = trpc.auth.updateNameParts.useMutation({
    onSuccess: () => { onSaved(); setTried(false); setSaved({ first: first.trim(), last: last.trim() }); toast.success(t("account.nameSaved")); },
    onError: onFail,
  });

  const problem = nameProblem(first, last);
  const changed = first.trim() !== saved.first.trim() || last.trim() !== saved.last.trim();

  return (
    <ProfileCard>
      <form
        noValidate
        onSubmit={event => {
          event.preventDefault();
          setTried(true);
          if (problem) return;
          save.mutate({ firstName: first.trim(), lastName: last.trim() });
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <FloatingField label={t("profile.firstName")} required dir="auto" autoComplete="given-name" maxLength={NAME_PART_MAX} value={first} onChange={event => setFirst(event.target.value)} aria-invalid={tried && !first.trim() ? true : undefined} />
          <FloatingField label={t("profile.lastName")} required dir="auto" autoComplete="family-name" maxLength={NAME_PART_MAX} value={last} onChange={event => setLast(event.target.value)} aria-invalid={tried && !last.trim() ? true : undefined} />
        </div>
        {tried && problem ? <p role="alert" className="text-[13px] font-semibold text-[#8c2f22]">{t(problem as "profile.nameRequired")}</p> : (
          <p className="text-[13px] leading-5 ink-muted">{t("profile.nameNote")}</p>
        )}
        <button type="submit" disabled={!changed || save.isPending} className={primary}>
          {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("account.saveChanges")}
        </button>
      </form>
    </ProfileCard>
  );
}

function PasswordForm({ onFail }: { onFail: (error: { message: string }) => void }) {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [reveal, setReveal] = useState(false);
  /* "Forgot your current password?" (on the owner's word): a 6-digit code to
     the account's own email, and the new password with it, on this card. */
  const [recovering, setRecovering] = useState<"idle" | "sent">("idle");
  const sendCode = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setRecovering("sent"),
    onError: onFail,
  });

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
  /* An account made with Apple has no password to type here; it is set by the
     same emailed code a forgotten one is. */
  const ways = trpc.auth.myProviders.useQuery(undefined, { staleTime: 60_000 });
  const appleOnly = ways.data?.password === false;

  return (
    <ProfileCard title={t("account.password")} note={t(appleOnly ? "account.passwordAppleNote" : "account.passwordNote")}>
      {recovering === "sent" && user ? (
        <div className="space-y-4">
          <p role="status" className="text-[14px] leading-6 text-[#3d5170]">
            {t("account.recoverSent", { email: "\u2068" + user.email + "\u2069" })}
          </p>
          <ResetByCode
            email={user.email}
            onSignedIn={() => {
              toast.success(t("account.passwordChanged"));
              setRecovering("idle"); setOpen(false); setCurrent(""); setNext("");
              void utils.auth.me.invalidate();
            }}
            onVerify={() => setRecovering("idle")}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => sendCode.mutate({ email: user.email, locale })} disabled={sendCode.isPending} className={secondary}>
              {sendCode.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("auth.resendCode")}
            </button>
            <button type="button" onClick={() => setRecovering("idle")} className={secondary}>{t("common.cancel")}</button>
          </div>
        </div>
      ) : open ? (
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
          {user ? (
            <button
              type="button"
              onClick={() => sendCode.mutate({ email: user.email, locale })}
              disabled={sendCode.isPending}
              className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[13px] font-bold text-[#0a285a] underline underline-offset-2 pointer-fine:min-h-8"
            >
              {sendCode.isPending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
              {t("account.forgotCurrent")}
            </button>
          ) : null}
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
      ) : appleOnly && user ? (
        <button type="button" onClick={() => sendCode.mutate({ email: user.email, locale })} disabled={sendCode.isPending} className={secondary}>
          {sendCode.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {t("account.setPassword")}
        </button>
      ) : (
        <button onClick={() => setOpen(true)} className={secondary}>
          {t("account.changePassword")}
        </button>
      )}
    </ProfileCard>
  );
}
