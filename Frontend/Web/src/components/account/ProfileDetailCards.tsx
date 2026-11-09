/**
 * What an open row of "Your profile" holds for the phone, the gender and the
 * birthday (`ProfileManager` draws the rows). Every one is optional and none
 * is shown to a store; the phone is the one that does something — checkout
 * starts with it as the number the driver calls. The nationality was here
 * too, and the owner took it off as not needed.
 *
 * The rules are `Shared/commerce/profileDetails.ts`, asked here as somebody
 * types and again by the server. The phone and the birthday are typed, so
 * they have a Save; a gender is one press, so the press is the save, and
 * pressing the chosen one again takes it away. A save that lands closes the
 * row (`onDone`), so the page goes back to being a list.
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

/** The one save the three rows share, so each answer lands in the page's copy of the details. */
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

export function GenderEditor({ details, onChoose, onDone }: {
  details: ProfileDetails | null;
  onChoose: (gender: Gender | null) => Promise<boolean>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const value = details?.gender ?? null;
  return (
    <div>
      <div role="group" aria-labelledby={labelId} className="grid grid-cols-2 gap-3">
        <span id={labelId} className="sr-only">{t("profile.genderTitle")}</span>
        {(["male", "female"] as const).map(gender => {
          const chosen = value === gender;
          return (
            <button
              key={gender}
              type="button"
              aria-pressed={chosen}
              onClick={() => { pressHaptic(); void onChoose(chosen ? null : gender).then(ok => { if (ok) onDone(); }); }}
              className={`pressable flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-4 text-start transition-colors ${chosen ? "border-[#0a285a] bg-[#f0f3f8]" : "border-[#d5dfeb] bg-white hover:bg-[#f0f2f5]"}`}
            >
              <span className="text-[15px] font-semibold text-[#0a285a]">{t(gender === "male" ? "profile.male" : "profile.female")}</span>
              <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${chosen ? "border-[#0a285a]" : "border-[#b6c2d3]"}`}>
                {chosen ? <span className="size-2.5 rounded-full bg-[#0a285a]" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className={noteLine}>{t("profile.genderNote")}</p>
      <RowButtons>
        <button type="button" onClick={onDone} className={secondary}>{t("common.cancel")}</button>
      </RowButtons>
    </div>
  );
}

export function BirthdayEditor({ details, saving, onSave, onDone }: {
  details: ProfileDetails | null;
  saving: boolean;
  onSave: (birthday: string | null) => Promise<boolean>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const stored = details?.birthday ?? null;
  const [value, setValue] = useState(stored ?? "");
  const [tried, setTried] = useState(false);
  const today = kuwaitDay(new Date());
  const problem = value ? birthdayProblem(value, today) : null;
  const changed = value !== (stored ?? "");

  return (
    <form
      noValidate
      onSubmit={event => {
        event.preventDefault();
        setTried(true);
        if (problem) return;
        if (!changed) { onDone(); return; }
        void onSave(value || null).then(ok => { if (ok) onDone(); });
      }}
    >
      <FloatingField
        label={t("profile.birthdayLabel")}
        type="date"
        min="1900-01-01"
        max={today}
        leftToRight
        value={value}
        onChange={event => setValue(event.target.value)}
        aria-invalid={tried && problem ? true : undefined}
      />
      {tried && problem ? <p role="alert" className={errorLine}>{t(problem as "profile.birthdayInvalid")}</p> : <p className={noteLine}>{t("profile.birthdayNote")}</p>}
      <RowButtons>
        <button type="submit" disabled={saving} className={primary}>
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("account.saveChanges")}
        </button>
        <button type="button" onClick={onDone} className={secondary}>{t("common.cancel")}</button>
        {stored ? (
          <button type="button" onClick={() => void onSave(null).then(ok => { if (ok) onDone(); })} className="inline-flex h-12 items-center rounded-full px-4 text-[15px] font-semibold text-[#8c2f22] hover:bg-[#fdeceb]">
            {t("profile.birthdayRemove")}
          </button>
        ) : null}
      </RowButtons>
    </form>
  );
}
