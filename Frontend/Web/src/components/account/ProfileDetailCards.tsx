/**
 * What an open row of "Your profile" holds for the phone, and for the gender
 * and the birthday, which are one row (`ProfileManager` draws the rows).
 * Every one is optional and none is shown to a store; the phone is the one
 * that does something — checkout starts with it as the number the driver calls. The nationality was here
 * too, and the owner took it off as not needed.
 *
 * The rules are `Shared/commerce/profileDetails.ts`, asked here as somebody
 * types and again by the server. Each open row has a Save, and a save that
 * lands closes the row (`onDone`), so the page goes back to being a list.
 */
import { FloatingField, RowButtons, primary, secondary } from "@/components/account/profileParts";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import {
  birthdayProblem,
  type Gender,
  type ProfileDetails,
  profilePhone,
} from "@shared/commerce/profileDetails";
import { formatPhone } from "@shared/commerce/wishlist";
import { kuwaitDay } from "@shared/kuwaitDay";
import { Check, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

type Patch = { phone?: string | null; gender?: Gender | null; birthday?: string | null };

/** The one save the rows share, so each answer lands in the page's copy of the details. */
export function useDetailsSave(onFail: (error: { message: string }) => void) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const save = trpc.customer.details.save.useMutation({
    onSuccess: answer => {
      utils.customer.details.get.setData(undefined, answer);
      toast.success(t("profile.saved"));
    },
    onError: onFail,
  });
  return {
    pending: save.isPending,
    send: (patch: Patch) => save.mutateAsync(patch).then(() => true, () => false),
  };
}

const errorLine = "mt-2 text-[13px] font-semibold text-[#8c2f22]";
const noteLine = "mt-2 text-[13px] leading-5 ink-muted";

export function PhoneEditor({ details, saving, onSave, onDone }: {
  details: ProfileDetails | null;
  saving: boolean;
  onSave: (phone: string | null) => Promise<boolean>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const stored = details?.phone ?? null;
  const shown = stored ? formatPhone(stored) : "";
  const [value, setValue] = useState(shown);
  const [tried, setTried] = useState(false);

  const typed = value.trim();
  const answer = typed ? profilePhone(typed) : null;
  const problem = answer && "problem" in answer ? answer.problem : null;
  const changed = typed !== shown;

  return (
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        setTried(true);
        if (problem) return;
        if (!changed) { onDone(); return; }
        void onSave(typed || null).then(ok => { if (ok) onDone(); });
      }}
    >
      <FloatingField
        label={t("profile.phoneLabel")}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        leftToRight
        placeholder={t("wish.phonePlaceholder")}
        value={value}
        onChange={event => setValue(event.target.value)}
        aria-invalid={tried && problem ? true : undefined}
        start={<span className="shrink-0 text-[16px] font-medium text-[#536b8c]" dir="ltr">+965</span>}
      />
      {tried && problem ? <p role="alert" className={errorLine}>{t(problem as "wishlist.phoneInvalid")}</p> : <p className={noteLine}>{t("profile.phoneNote")}</p>}
      <RowButtons>
        <button type="submit" disabled={saving} className={primary}>
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("account.saveChanges")}
        </button>
        <button type="button" onClick={onDone} className={secondary}>{t("common.cancel")}</button>
      </RowButtons>
    </form>
  );
}

/**
 * The gender and the birthday as one row, on the owner's word ("for the
 * gender and birthday, make it into one option that the user can expand to
 * edit them"): both are optional, both are about the shopper rather than how
 * to reach them, and two rows of "Not added" under the password read as a form
 * left unfinished. Opened, the two are chosen together and one Save sends
 * what changed of them — a gender pressed is a choice here, not a save, and
 * pressing it again takes it away.
 */
export function AboutEditor({ details, saving, onSave, onDone }: {
  details: ProfileDetails | null;
  saving: boolean;
  onSave: (patch: { gender?: Gender | null; birthday?: string | null }) => Promise<boolean>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const storedGender = details?.gender ?? null;
  const storedBirthday = details?.birthday ?? null;
  const [gender, setGender] = useState<Gender | null>(storedGender);
  const [birthday, setBirthday] = useState(storedBirthday ?? "");
  const [tried, setTried] = useState(false);
  const today = kuwaitDay(new Date());
  const problem = birthday ? birthdayProblem(birthday, today) : null;

  const patch: { gender?: Gender | null; birthday?: string | null } = {};
  if (gender !== storedGender) patch.gender = gender;
  if (birthday !== (storedBirthday ?? "")) patch.birthday = birthday || null;

  return (
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        setTried(true);
        if (problem) return;
        if (Object.keys(patch).length === 0) { onDone(); return; }
        void onSave(patch).then(ok => { if (ok) onDone(); });
      }}
    >
      <div role="group" aria-labelledby={labelId}>
        <p id={labelId} className="mb-2 text-[13px] font-medium ink-muted">{t("profile.genderTitle")}</p>
        <div className="grid grid-cols-2 gap-3">
          {(["male", "female"] as const).map(option => {
            const chosen = gender === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={chosen}
                onClick={() => { pressHaptic(); setGender(chosen ? null : option); }}
                className={`pressable flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-4 text-start transition-colors ${chosen ? "border-[#0a285a] bg-[#f0f3f8]" : "border-[#d5dfeb] bg-white hover:bg-[#f0f2f5]"}`}
              >
                <span className="text-[15px] font-semibold text-[#0a285a]">{t(option === "male" ? "profile.male" : "profile.female")}</span>
                <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${chosen ? "border-[#0a285a]" : "border-[#b6c2d3]"}`}>
                  {chosen ? <span className="size-2.5 rounded-full bg-[#0a285a]" /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <p className={noteLine}>{t("profile.genderNote")}</p>
      </div>
      <div className="mt-4">
        <FloatingField
          label={t("profile.birthdayLabel")}
          type="date"
          min="1900-01-01"
          max={today}
          leftToRight
          value={birthday}
          onChange={event => setBirthday(event.target.value)}
          aria-invalid={tried && problem ? true : undefined}
        />
        {tried && problem ? <p role="alert" className={errorLine}>{t(problem as "profile.birthdayInvalid")}</p> : <p className={noteLine}>{t("profile.birthdayNote")}</p>}
      </div>
      <RowButtons>
        <button type="submit" disabled={saving} className={primary}>
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("account.saveChanges")}
        </button>
        <button type="button" onClick={onDone} className={secondary}>{t("common.cancel")}</button>
        {birthday ? (
          <button type="button" onClick={() => setBirthday("")} className="inline-flex h-12 items-center rounded-full px-4 text-[15px] font-semibold text-[#8c2f22] hover:bg-[#fdeceb]">
            {t("profile.birthdayRemove")}
          </button>
        ) : null}
      </RowButtons>
    </form>
  );
}
