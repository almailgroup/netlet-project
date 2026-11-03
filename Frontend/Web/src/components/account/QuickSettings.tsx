/**
 * Country, currency and language, on My Profile itself — on the owner's word:
 * "clearly visible and directly accessible from the My Profile page, rather
 * than being hidden inside the Preferences section".
 *
 * One card of three rows, each changed where it is drawn:
 *
 * - **Country** is Kuwait, where NetLet sells and delivers. The list names the
 *   rest of the Gulf as coming and none of them can be chosen
 *   (`Shared/commerce/country.ts`): a country somebody could pick and then be
 *   delivered nothing in would be a control that lies.
 * - **Currency** is the reading aid it always was (`CurrencySelect`): prices
 *   shown in it, everything charged in dinars.
 * - **Language** is the two buttons Preferences had, each written in its own
 *   language so whoever needs it can read it.
 */
import { CurrencySelect } from "@/components/ui/CurrencySelect";
import { Select } from "@/components/ui/Select";
import { PANEL } from "@/components/account/profileParts";
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { flagOf, HOME_COUNTRY, SHOP_COUNTRIES } from "@shared/commerce/country";
import { Coins, Globe, Languages } from "lucide-react";
import type { ReactNode } from "react";

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const FIELD = "glass-field flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 text-[14px] font-semibold text-[#1f2a44]";

export function QuickSettings() {
  const { t, locale } = useTranslation();
  const { setLocale } = useCustomer();
  return (
    <section aria-labelledby="quick-settings" className={`${PANEL} px-5 py-4`}>
      <h2 id="quick-settings" className="text-[16px] font-bold text-[#0a285a]">{t("quick.settingsTitle")}</h2>
      <div className="mt-3 divide-y divide-dashed divide-[#e3e6ec]">
        <Row icon={<Globe className="size-[22px]" strokeWidth={1.75} />} label={t("quick.country")} labelFor="quick-country">
          <Select id="quick-country" value={HOME_COUNTRY} aria-label={t("quick.country")} className={FIELD} onChange={() => undefined}>
            {SHOP_COUNTRIES.map(country => (
              <option key={country.code} value={country.code} disabled={!country.open}>
                {`${flagOf(country.code)} ${countryName(country.code, locale)}${country.open ? "" : ` · ${t("quick.comingSoon")}`}`}
              </option>
            ))}
          </Select>
        </Row>
        <Row icon={<Coins className="size-[22px]" strokeWidth={1.75} />} label={t("currency.title")} labelFor="quick-currency">
          <CurrencySelect id="quick-currency" className={FIELD} />
        </Row>
        <Row icon={<Languages className="size-[22px]" strokeWidth={1.75} />} label={t("account.language")}>
          {/* Two buttons rather than a list: there are exactly two, each in its
              own language so it is legible to whoever needs it. */}
          <div role="group" aria-label={t("account.language")} className="inline-flex w-full gap-1 rounded-2xl bg-[#eef1f6] p-1">
            {(["en", "ar"] as const).map(code => {
              const active = locale === code;
              return (
                <button
                  key={code}
                  type="button"
                  lang={code}
                  aria-pressed={active}
                  onClick={() => { if (!active) { pressHaptic(); setLocale(code); } }}
                  className={`min-h-10 flex-1 rounded-xl px-3 text-[14px] font-bold transition ${
                    active ? "bg-white text-[#0a285a] shadow-[0_1px_3px_rgba(10,40,90,.12)]" : "ink-muted hover:text-[#0a285a]"
                  }`}
                >
                  {code === "en" ? "English" : "العربية"}
                </button>
              );
            })}
          </div>
        </Row>
      </div>
      <p className="mt-3 text-[12px] leading-5 ink-muted">{t("quick.note")}</p>
    </section>
  );
}

function Row({ icon, label, labelFor, children }: { icon: ReactNode; label: string; labelFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
      <span className="flex min-w-0 items-center gap-3.5 sm:w-44 sm:shrink-0">
        <span className="shrink-0 text-[#5d6b82]" aria-hidden>{icon}</span>
        {labelFor ? (
          <label htmlFor={labelFor} className="text-[15px] font-medium text-[#1f2a44]">{label}</label>
        ) : (
          <span className="text-[15px] font-medium text-[#1f2a44]">{label}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
