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
 *
 * And what every order starts from, on the owner's word ("allow customers to
 * set or change their default delivery address in Settings" and "their default
 * payment method"), kept on the account (0088,
 * `Shared/commerce/customerDefaults.ts`):
 *
 * - **Delivery address** is the address book as choices. Choosing one is the
 *   header's own choice — the area and the address in use, written to the
 *   account by `CustomerContext` — so the header, the cart and checkout start
 *   from it at once. An address with no governorate cannot price a delivery
 *   and is offered disabled, saying why; an empty book is a link to add one.
 * - **Payment method** offers cash on delivery and draws KNET, a card and
 *   Apple Pay as coming, none of them choosable, checkout's rule until a card
 *   service is wired.
 */
import { CurrencySelect } from "@/components/ui/CurrencySelect";
import { Select } from "@/components/ui/Select";
import { PANEL } from "@/components/account/profileParts";
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { flagOf, HOME_COUNTRY, SHOP_COUNTRIES } from "@shared/commerce/country";
import { PAYMENT_METHODS, type PaymentMethod } from "@shared/commerce/customerDefaults";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { kuwaitDeliveryZones } from "@shared/customer";
import { useDeliveryAddress } from "@/components/cart/DeliveryAddressCard";
import { rememberAddress } from "@/lib/lastAddress";
import { trpc } from "@/lib/trpc";
import { Banknote, Coins, Globe, Languages, MapPin, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

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
        <Row icon={<MapPin className="size-[22px]" strokeWidth={1.75} />} label={t("quick.deliveryAddress")} labelFor="quick-address">
          <AddressChoice />
        </Row>
        <Row icon={<Banknote className="size-[22px]" strokeWidth={1.75} />} label={t("quick.paymentMethod")} labelFor="quick-payment">
          <PaymentChoice />
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

/** The way each method is named, checkout's own words. */
export const PAYMENT_NAME: Record<PaymentMethod, MessageKey> = {
  cod: "checkout.payCod",
  knet: "checkout.payKnet",
  card: "checkout.payCard",
  apple_pay: "checkout.payApple",
};

/** The address book as choices; choosing one is the address the shop delivers to, kept on the account. */
function AddressChoice() {
  const { t, isArabic } = useTranslation();
  const { setDeliveryZoneId } = useCustomer();
  const { address, book, loaded } = useDeliveryAddress();
  if (!loaded) return <span aria-hidden className="block h-11 w-full animate-pulse rounded-xl bg-[#eef1f6]" />;
  if (book.length === 0) {
    return (
      <Link href="/account/addresses" id="quick-address" className="glass-field inline-flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-[14px] font-semibold text-[#0a285a]">
        <Plus className="size-4" aria-hidden />{t("quick.addAddress")}
      </Link>
    );
  }
  const zoneOf = (id: string | null | undefined) => {
    const zone = kuwaitDeliveryZones.find(entry => entry.id === id);
    return zone ? (isArabic ? zone.labelAr : zone.label) : null;
  };
  return (
    <Select
      id="quick-address"
      value={address ? String(address.id) : ""}
      aria-label={t("quick.deliveryAddress")}
      className={FIELD}
      onChange={event => {
        const row = book.find(entry => String(entry.id) === event.target.value);
        if (!row?.governorate) return;
        pressHaptic();
        setDeliveryZoneId(row.governorate);
        rememberAddress(row.id);
      }}
    >
      {address ? null : <option value="" disabled>{t("home.chooseAreaShort")}</option>}
      {book.map(row => (
        <option key={row.id} value={String(row.id)} disabled={!row.governorate}>
          {[row.label, zoneOf(row.governorate) ?? t("quick.noArea")].join(" · ")}
        </option>
      ))}
    </Select>
  );
}

/** Cash on delivery, and the ways that are coming drawn as they will be. */
function PaymentChoice() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const defaults = trpc.customer.defaults.get.useQuery(undefined, { staleTime: 60_000, retry: false });
  const save = trpc.customer.defaults.setPayment.useMutation({
    onSuccess: async () => { await utils.customer.defaults.get.invalidate(); },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("defaults.failed")),
  });
  const choosable = defaults.data?.choosable ?? ["cod"];
  const value = save.variables?.method ?? defaults.data?.payment ?? "cod";
  return (
    <Select
      id="quick-payment"
      value={value}
      aria-label={t("quick.paymentMethod")}
      className={FIELD}
      onChange={event => {
        const method = PAYMENT_METHODS.find(entry => entry === event.target.value);
        if (!method || method === value) return;
        pressHaptic();
        save.mutate({ method });
      }}
    >
      {PAYMENT_METHODS.map(method => (
        <option key={method} value={method} disabled={!choosable.includes(method)}>
          {`${t(PAYMENT_NAME[method])}${method === "cod" ? "" : ` · ${t("checkout.paySoon")}`}`}
        </option>
      ))}
    </Select>
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
