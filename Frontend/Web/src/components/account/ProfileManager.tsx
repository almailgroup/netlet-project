/**
 * "Your profile", compact on the owner's word ("make it very compact and
 * simple, it should list your details by default and you can edit them"): one
 * card listing what the account holds — the photo, the name, the sign-in
 * email, the phone, the gender, the birthday and the password — each as a row
 * with its value and an Edit (`DetailRow`). Pressing Edit opens that row's
 * own form in its place, and only one row is open at a time; Save or Cancel
 * closes it again. Deleting the account is its own card under the list.
 *
 * **Account security is this page now, on the owner's word** ("remove the
 * account security, instead put all its functions in the edit profile page"):
 * it was a page of its own holding the password and the delete. **The sign-in
 * email is shown and not changed here, on the owner's word**: changing it is
 * not offered on the page (`auth.changeEmail` stays on the server, unused by
 * it); an account made with a phone has no email, and its row offers to add one.
 *
 * Each row is its own decision with its own Save — or, for a choice made in
 * one press (a gender), saved as it is pressed — because one Save across all
 * of them would change a password somebody only opened the page to correct a
 * spelling in.
 *
 * The password asks for the current one, and the new one twice (on the
 * owner's word: "put a type password again for changing your password as a
 * confirmation"). A session left open on a shared machine should not be
 * enough to take an account over, and a slip on a box of dots should not
 * become the only way in. The server enforces the first; the second is the
 * form's (`passwordAgainProblem`).
 */
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { checkPassword, passwordAgainProblem } from "@shared/auth/passwordStrength";
import { PasswordChecklist } from "@/components/auth/AuthForm";
import { ResetByCode } from "@/components/auth/ResetByCode";
import { useAuth } from "@/hooks/useAuth";
import { isMessageKey } from "@shared/i18n/dictionary";
import { nameProblem, NAME_PART_MAX, splitName } from "@shared/commerce/profileDetails";
import { formatPhone } from "@shared/commerce/wishlist";
import { BirthdayEditor, GenderEditor, PhoneEditor, useDetailsSave } from "@/components/account/ProfileDetailCards";
import { DetailRow, FloatingField, NotAdded, PANEL, RowButtons, primary, secondary } from "@/components/account/profileParts";
import { DeleteAccount } from "@/components/account/DeleteAccount";
import { AddEmailFields } from "@/components/auth/PhoneSignIn";
import { shownPhone } from "@shared/auth/phone";
import { ProfilePhotoRow } from "@/components/account/ProfilePhoto";
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, Plus, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

type PublicUser = { id: number; email: string | null; phone?: string | null; name: string | null; role: string };
type Row = "name" | "email" | "phone" | "gender" | "birthday" | "password";

export function ProfileManager({ user }: { user: PublicUser }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const formatDate = useDateFormat();
  const refresh = () => void utils.auth.me.invalidate();
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed"));
  const details = trpc.customer.details.get.useQuery();
  const detailsSave = useDetailsSave(fail);
  /* An account made with Apple, Google or a phone has no password to type;
     its row offers to set one by the emailed code a forgotten one gets. */
  const ways = trpc.auth.myProviders.useQuery(undefined, { staleTime: 60_000, enabled: Boolean(user.email) });
  const noPassword = ways.data?.password === false;
  const [editing, setEditing] = useState<Row | null>(null);
  const close = () => setEditing(null);
  const rowOf = (row: Row, label: string, action = t("profile.edit")) => ({
    label,
    actionLabel: action,
    actionName: t("profile.editField", { field: label }),
    open: editing === row,
    onOpen: () => setEditing(row),
  });

  const parts = details.data ? { first: details.data.firstName, last: details.data.lastName } : null;
  const fullName = parts?.first || parts?.last ? [parts.first, parts.last].filter(Boolean).join(" ") : user.name?.trim() || null;
  const phone = details.data?.phone ?? null;
  const gender = details.data?.gender ?? null;
  const birthday = details.data?.birthday ?? null;

  return (
    <div className="space-y-3">
      <section aria-label={t("profile.detailsLabel")} className={`${PANEL} divide-y divide-dashed divide-[#e3e6ec]`}>
        <ProfilePhotoRow user={user} />
        <DetailRow {...rowOf("name", t("profile.nameTitle"))} value={fullName ? <bdi dir="auto">{fullName}</bdi> : <NotAdded>{t("profile.notAdded")}</NotAdded>}>
          <NameEditor user={user} parts={parts} onSaved={() => { refresh(); close(); }} onCancel={close} onFail={fail} />
        </DetailRow>
        {user.email ? (
          <DetailRow {...rowOf("email", t("account.emailCard"))} readOnly value={<bdi dir="ltr">{user.email}</bdi>} />
        ) : (
          <DetailRow
            {...rowOf("email", t("account.emailCard"), t("profile.add"))}
            actionIcon={<Plus className="size-4" aria-hidden />}
            value={<NotAdded>{t("profile.notAdded")}</NotAdded>}
          >
            <AddEmail phone={user.phone ?? null} onAdded={() => { refresh(); close(); }} onCancel={close} />
          </DetailRow>
        )}
        <DetailRow {...rowOf("phone", t("profile.phoneTitle"))} value={phone ? <bdi dir="ltr">+965 {formatPhone(phone)}</bdi> : <NotAdded>{t("profile.notAdded")}</NotAdded>}>
          <PhoneEditor details={details.data ?? null} saving={detailsSave.pending} onSave={next => detailsSave.send({ phone: next })} onDone={close} />
        </DetailRow>
        <DetailRow {...rowOf("gender", t("profile.genderTitle"))} value={gender ? t(gender === "male" ? "profile.male" : "profile.female") : <NotAdded>{t("profile.notAdded")}</NotAdded>}>
          <GenderEditor details={details.data ?? null} onChoose={next => detailsSave.send({ gender: next })} onDone={close} />
        </DetailRow>
        <DetailRow {...rowOf("birthday", t("profile.birthdayTitle"))} value={birthday ? formatDate(birthday) : <NotAdded>{t("profile.notAdded")}</NotAdded>}>
          <BirthdayEditor details={details.data ?? null} saving={detailsSave.pending} onSave={next => detailsSave.send({ birthday: next })} onDone={close} />
        </DetailRow>
        {user.email ? (
          <DetailRow
            {...rowOf("password", t("account.password"), t(noPassword ? "account.setPassword" : "profile.change"))}
            actionIcon={<KeyRound className="size-4" aria-hidden />}
            value={noPassword ? <NotAdded>{t("profile.noPassword")}</NotAdded> : (
              <><span aria-hidden className="tracking-[.2em]">••••••••</span><span className="sr-only">{t("profile.passwordIsSet")}</span></>
            )}
          >
            <PasswordForm
              noPassword={noPassword}
              note={t(!noPassword ? "account.passwordNote" : ways.data?.apple ? "account.passwordAppleNote" : ways.data?.google ? "account.passwordGoogleNote" : "account.passwordPhoneNote")}
              onDone={close}
              onFail={fail}
            />
          </DetailRow>
        ) : null}
      </section>
      <DeleteAccount />
    </div>
  );
}

/**
 * The first and last name, side by side. An account with no parts yet starts
 * from its display name split at the first space — a guess shown for the
 * shopper to correct ("Abdul Rahman" is one first name), never saved for them.
 */
function NameEditor({ user, parts, onSaved, onCancel, onFail }: {
  user: PublicUser;
  parts: { first: string | null; last: string | null } | null;
  onSaved: () => void;
  onCancel: () => void;
  onFail: (error: { message: string }) => void;
}) {
  const { t } = useTranslation();
  const stored = parts?.first || parts?.last ? { first: parts.first ?? "", last: parts.last ?? "" } : splitName(user.name);
  const [first, setFirst] = useState(stored.first);
  const [last, setLast] = useState(stored.last);
  const [tried, setTried] = useState(false);

  const save = trpc.auth.updateNameParts.useMutation({
    onSuccess: () => { toast.success(t("account.nameSaved")); onSaved(); },
    onError: onFail,
  });

  const problem = nameProblem(first, last);
  const changed = first.trim() !== stored.first.trim() || last.trim() !== stored.last.trim();

  return (
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        setTried(true);
        if (problem) return;
        if (!changed) { onCancel(); return; }
        save.mutate({ firstName: first.trim(), lastName: last.trim() });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <FloatingField label={t("profile.firstName")} required dir="auto" autoComplete="given-name" maxLength={NAME_PART_MAX} value={first} onChange={event => setFirst(event.target.value)} aria-invalid={tried && !first.trim() ? true : undefined} />
        <FloatingField label={t("profile.lastName")} required dir="auto" autoComplete="family-name" maxLength={NAME_PART_MAX} value={last} onChange={event => setLast(event.target.value)} aria-invalid={tried && !last.trim() ? true : undefined} />
      </div>
      {tried && problem ? <p role="alert" className="mt-2 text-[13px] font-semibold text-[#8c2f22]">{t(problem as "profile.nameRequired")}</p> : (
        <p className="mt-2 text-[13px] leading-5 ink-muted">{t("profile.nameNote")}</p>
      )}
      <RowButtons>
        <button type="submit" disabled={save.isPending} className={primary}>
          {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("account.saveChanges")}
        </button>
        <button type="button" onClick={onCancel} className={secondary}>{t("common.cancel")}</button>
      </RowButtons>
    </form>
  );
}

/** The email row's form, for an account that signs in with its phone and has none yet. */
function AddEmail({ phone, onAdded, onCancel }: { phone: string | null; onAdded: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mb-3 text-[13px] leading-5 ink-muted">
        {t("account.emailCardNote")}
        {phone ? <> {t("account.signsInWithPhone", { phone: "\u2068" + shownPhone(phone) + "\u2069" })}</> : null}
      </p>
      <AddEmailFields compact onAdded={onAdded} />
      <RowButtons>
        <button type="button" onClick={onCancel} className={secondary}>{t("common.cancel")}</button>
      </RowButtons>
    </div>
  );
}

function PasswordForm({ noPassword, note, onDone, onFail }: {
  /** An account that signs in with Apple, Google or a phone: a password is set by the emailed code. */
  noPassword: boolean;
  note: string;
  onDone: () => void;
  onFail: (error: { message: string }) => void;
}) {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const ownId = useId();
  const id = (part: string) => `${ownId}-${part}`;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [reveal, setReveal] = useState(false);
  const [tried, setTried] = useState(false);
  /* "Forgot your current password?" (on the owner's word): a 6-digit code to
     the account's own email, and the new password with it, in this row. */
  const [recovering, setRecovering] = useState<"idle" | "sent">("idle");
  const sendCode = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setRecovering("sent"),
    onError: onFail,
  });
  const askForCode = () => sendCode.mutate({ email: user?.email ?? "", locale });

  const save = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success(t("account.passwordChanged"));
      onDone();
    },
    onError: onFail,
  });

  // The same rules the sign-up meter applies, so the floor cannot differ
  // between creating a password and replacing one.
  const verdict = checkPassword(next);
  const currentIssue = current === "" ? "account.currentPasswordRequired" as const : null;
  const nextIssue = !next ? "auth.passwordRequired" as const : !verdict.acceptable ? "auth.passwordNeedsRules" as const : null;
  const againIssue = nextIssue ? null : passwordAgainProblem(next, again);
  const focus = (part: string) => document.getElementById(id(part))?.focus();
  const errorLine = "mt-1.5 text-[13px] font-semibold text-[#8c2f22]";

  if (recovering === "sent" && user) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-[14px] leading-6 text-[#3d5170]">
          {t("account.recoverSent", { email: "\u2068" + (user.email ?? "") + "\u2069" })}
        </p>
        <ResetByCode
          email={user.email ?? ""}
          onSignedIn={() => {
            toast.success(t("account.passwordChanged"));
            setRecovering("idle");
            void utils.auth.me.invalidate();
            void utils.auth.myProviders.invalidate();
            onDone();
          }}
          onVerify={() => setRecovering("idle")}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={askForCode} disabled={sendCode.isPending} className={secondary}>
            {sendCode.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t("auth.resendCode")}
          </button>
          <button type="button" onClick={() => { setRecovering("idle"); onDone(); }} className={secondary}>{t("common.cancel")}</button>
        </div>
      </div>
    );
  }

  if (noPassword) {
    return (
      <div>
        <p className="text-[13px] leading-5 ink-muted">{note}</p>
        <RowButtons>
          <button type="button" onClick={askForCode} disabled={sendCode.isPending} className={primary}>
            {sendCode.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t("auth.sendSignInCode")}
          </button>
          <button type="button" onClick={onDone} className={secondary}>{t("common.cancel")}</button>
        </RowButtons>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-2.5"
      onSubmit={event => {
        event.preventDefault();
        setTried(true);
        if (currentIssue) { focus("current"); return; }
        if (nextIssue) { focus("next"); return; }
        if (againIssue) { focus("again"); return; }
        save.mutate({ currentPassword: current, newPassword: next });
      }}
    >
      {/* So a password manager files the new password under the right account. */}
      {user?.email ? <input type="email" name="email" autoComplete="username" value={user.email} readOnly hidden /> : null}
      <div>
        <FloatingField
          id={id("current")}
          label={t("account.currentPassword")}
          leftToRight
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={event => setCurrent(event.target.value)}
          aria-invalid={tried && currentIssue ? true : undefined}
          aria-describedby={tried && currentIssue ? id("current-issue") : undefined}
        />
        {tried && currentIssue ? <p id={id("current-issue")} className={errorLine}>{t(currentIssue)}</p> : null}
      </div>
      <div>
        <FloatingField
          id={id("next")}
          label={t("account.newPassword")}
          leftToRight
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          value={next}
          aria-invalid={tried && nextIssue ? true : undefined}
          aria-describedby={[tried && nextIssue ? id("next-issue") : "", id("rules")].filter(Boolean).join(" ")}
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
        {tried && nextIssue ? <p id={id("next-issue")} className={errorLine}>{t(nextIssue)}</p> : null}
        <PasswordChecklist id={id("rules")} verdict={verdict} typed={next.length > 0} />
      </div>
      <div>
        <FloatingField
          id={id("again")}
          label={t("auth.passwordAgainLabel")}
          leftToRight
          type={reveal ? "text" : "password"}
          autoComplete="new-password"
          value={again}
          onChange={event => setAgain(event.target.value)}
          aria-invalid={tried && againIssue ? true : undefined}
          aria-describedby={tried && againIssue ? id("again-issue") : undefined}
        />
        {tried && againIssue ? <p id={id("again-issue")} className={errorLine}>{t(againIssue)}</p> : null}
      </div>
      <p className="text-[12px] leading-4 ink-muted">{note} {t("account.currentPasswordWhy")}</p>
      {user ? (
        <button
          type="button"
          onClick={askForCode}
          disabled={sendCode.isPending}
          className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[13px] font-bold text-[#0a285a] underline underline-offset-2 pointer-fine:min-h-8"
        >
          {sendCode.isPending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
          {t("account.forgotCurrent")}
        </button>
      ) : null}
      <RowButtons>
        <button type="submit" disabled={save.isPending} className={primary}>
          {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          {t("account.changePassword")}
        </button>
        <button type="button" onClick={onDone} className={secondary}>{t("common.cancel")}</button>
      </RowButtons>
    </form>
  );
}
