/**
 * The phone, the gender, the birthday and the nationality on "Your profile",
 * drawn to the owner's reference (Noon's "Your profile"). Every one is
 * optional and none is shown to a store; the phone is the one that does
 * something — checkout starts with it as the number the driver calls.
 *
 * The rules are `Shared/commerce/profileDetails.ts`, asked here as somebody
 * types and again by the server. The phone and the birthday are typed, so
 * they have a Save; a gender and a country are one press each, so the press is
 * the save, and pressing the chosen one again takes it away.
 *
 * Countries are named by the browser in the page's language
 * (`Intl.DisplayNames`), so the list needs no words of its own: the common
 * ones are chips, and "View all" is every country, searchable.
 */
import { FloatingField, ProfileCard, primary } from "@/components/account/profileParts";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import {
  birthdayProblem,
  COMMON_NATIONALITIES,
  COUNTRY_CODES,
  type Gender,
  type ProfileDetails,
  profilePhone,
} from "@shared/commerce/profileDetails";
import { formatPhone } from "@shared/commerce/wishlist";
import { kuwaitDay } from "@shared/kuwaitDay";
import { foldText } from "@shared/commerce/search";
import { Check, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Patch = { phone?: string | null; gender?: Gender | null; birthday?: string | null; nationality?: string | null };

export function ProfileDetailCards({ details, onFail }: { details: ProfileDetails | null; onFail: (error: { message: string }) => void }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const save = trpc.customer.details.save.useMutation({
    onSuccess: answer => {
      utils.customer.details.get.setData(undefined, answer);
      toast.success(t("profile.saved"));
    },
    onError: onFail,
  });
  const send = (patch: Patch) => save.mutateAsync(patch).then(() => true, () => false);

  return (
    <>
      <PhoneCard stored={details?.phone ?? null} saving={save.isPending} onSave={phone => send({ phone })} />
      <GenderCard value={details?.gender ?? null} onChoose={gender => void send({ gender })} />
      <BirthdayCard stored={details?.birthday ?? null} saving={save.isPending} onSave={birthday => send({ birthday })} />
      <NationalityCard value={details?.nationality ?? null} onChoose={nationality => void send({ nationality })} />
    </>
  );
}

function PhoneCard({ stored, saving, onSave }: { stored: string | null; saving: boolean; onSave: (phone: string | null) => Promise<boolean> }) {
  const { t } = useTranslation();
  const shown = stored ? formatPhone(stored) : "";
  const [value, setValue] = useState(shown);
  const [tried, setTried] = useState(false);
  useEffect(() => { setValue(shown); }, [shown]);

  const typed = value.trim();
  const answer = typed ? profilePhone(typed) : null;
  const problem = answer && "problem" in answer ? answer.problem : null;
  const changed = typed !== shown;

  return (
    <ProfileCard title={t("profile.phoneTitle")} note={t("profile.phoneNote")}>
      <form
        noValidate
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          setTried(true);
          if (problem) return;
          void onSave(typed || null).then(ok => { if (ok) setTried(false); });
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
        {tried && problem ? <p role="alert" className="text-[13px] font-semibold text-[#8c2f22]">{t(problem as "wishlist.phoneInvalid")}</p> : null}
        <button type="submit" disabled={!changed || saving} className={primary}>
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {t("account.saveChanges")}
        </button>
      </form>
    </ProfileCard>
  );
}

function GenderCard({ value, onChoose }: { value: Gender | null; onChoose: (gender: Gender | null) => void }) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <ProfileCard title={t("profile.genderTitle")} note={t("profile.genderNote")}>
      <div role="group" aria-labelledby={labelId} className="grid grid-cols-2 gap-3">
        <span id={labelId} className="sr-only">{t("profile.genderTitle")}</span>
        {(["male", "female"] as const).map(gender => {
          const chosen = value === gender;
          return (
            <button
              key={gender}
              type="button"
              aria-pressed={chosen}
              onClick={() => { pressHaptic(); onChoose(chosen ? null : gender); }}
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
    </ProfileCard>
  );
}

function BirthdayCard({ stored, saving, onSave }: { stored: string | null; saving: boolean; onSave: (birthday: string | null) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(stored ?? "");
  const [tried, setTried] = useState(false);
  useEffect(() => { setValue(stored ?? ""); }, [stored]);
  const today = kuwaitDay(new Date());
  const problem = value ? birthdayProblem(value, today) : null;
  const changed = value !== (stored ?? "");

  return (
    <ProfileCard title={t("profile.birthdayTitle")} note={t("profile.birthdayNote")}>
      <form
        noValidate
        className="space-y-3"
        onSubmit={event => {
          event.preventDefault();
          setTried(true);
          if (problem) return;
          void onSave(value || null).then(ok => { if (ok) setTried(false); });
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
        {tried && problem ? <p role="alert" className="text-[13px] font-semibold text-[#8c2f22]">{t(problem as "profile.birthdayInvalid")}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!changed || saving} className={primary}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t("account.saveChanges")}
          </button>
          {stored ? (
            <button type="button" onClick={() => void onSave(null)} className="pressable inline-flex h-11 items-center rounded-xl px-3 text-[13px] font-bold text-[#8c2f22] hover:bg-[#fdeceb]">
              {t("profile.birthdayRemove")}
            </button>
          ) : null}
        </div>
      </form>
    </ProfileCard>
  );
}

/** Every country, named in the page's language, in that language's order. */
function useCountries() {
  const { locale } = useTranslation();
  return useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: "region" });
    return COUNTRY_CODES
      .map(code => ({ code, name: names.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale]);
}

function NationalityCard({ value, onChoose }: { value: string | null; onChoose: (nationality: string | null) => void }) {
  const { t } = useTranslation();
  const countries = useCountries();
  const nameOf = (code: string) => countries.find(country => country.code === code)?.name ?? code;
  const [listOpen, setListOpen] = useState(false);
  const chips: string[] = [...COMMON_NATIONALITIES];
  if (value && !chips.includes(value)) chips.unshift(value);

  const choose = (code: string) => {
    pressHaptic();
    onChoose(value === code ? null : code);
  };

  return (
    <ProfileCard title={t("profile.nationalityTitle")} note={t("profile.nationalityNote")}>
      <div className="flex flex-wrap gap-2">
        {chips.map(code => {
          const chosen = value === code;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={chosen}
              onClick={() => choose(code)}
              className={`pressable inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold transition-colors ${chosen ? "border-[#0a285a] bg-[#0a285a] text-white hover:bg-[#0d3372]" : "border-[#d5dfeb] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"}`}
            >
              {chosen ? <Check className="size-4" aria-hidden /> : null}
              {nameOf(code)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setListOpen(true)}
          className="pressable inline-flex min-h-11 items-center rounded-full px-3 text-[14px] font-bold ink-accent underline underline-offset-4"
        >
          {t("profile.viewAll")}
        </button>
      </div>
      {listOpen ? <CountryList countries={countries} value={value} onChoose={code => { setListOpen(false); if (code !== value) onChoose(code); }} onClose={() => setListOpen(false)} /> : null}
    </ProfileCard>
  );
}

/** Every country, searchable: a sheet on a phone, a card on a wide screen. */
function CountryList({ countries, value, onChoose, onClose }: {
  countries: { code: string; name: string }[];
  value: string | null;
  onChoose: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  useOverlay(true, onClose);
  useEffect(() => {
    const timer = window.setTimeout(() => searchRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);
  const folded = foldText(query.trim());
  const shown = folded ? countries.filter(country => foldText(country.name).includes(folded)) : countries;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#061b3b]/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="flex max-h-[85svh] w-full max-w-[460px] flex-col rounded-t-3xl bg-[#fffdf9] shadow-[0_24px_60px_rgba(10,40,90,.28)] sm:max-h-[80vh] sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
          <h2 id={titleId} className="text-lg font-extrabold text-[#0a285a]">{t("profile.chooseNationality")}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.cancel")} className="pressable -me-2 grid size-11 shrink-0 place-items-center rounded-full text-[#0a285a]">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="px-5 pb-3">
          <label className="flex h-12 items-center gap-2 rounded-2xl border border-[#d5dfeb] bg-white px-4 focus-within:border-[#0a285a] focus-within:ring-2 focus-within:ring-[#0a285a]/15">
            <Search className="size-4 shrink-0 text-[#536b8c]" aria-hidden />
            <span className="sr-only">{t("profile.countrySearch")}</span>
            <input
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t("profile.countrySearch")}
              className="type-body w-full bg-transparent text-[16px] text-[#0a285a] outline-none placeholder:text-[#8a9ab3]"
            />
          </label>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {shown.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm ink-muted">{t("profile.countryNone")}</li>
          ) : shown.map(country => {
            const chosen = country.code === value;
            return (
              <li key={country.code}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => { pressHaptic(); onChoose(country.code); }}
                  className="pressable flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-start text-[15px] text-[#0a285a] hover:bg-[#f0f2f5]"
                >
                  <span className={chosen ? "font-bold" : ""}>{country.name}</span>
                  {chosen ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
