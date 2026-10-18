/**
 * The header of the two pages that leave the shop's frame on purpose:
 * checkout and sign-in.
 *
 * Both used to draw their own and no two details agreed — the height, the
 * rule under it, a translucent ground on one and white on the other, a
 * language switch on one only, and checkout's way back to the shop a plain
 * `<a>` that reloaded the whole app on the one page where a shopper should
 * never wait. It is one bar now, the same white and height as the shop's own:
 * the logo, an optional line of reassurance, the language, and the way back.
 * No search, no departments, no cart — every exit on a payment page is an
 * invitation to take it, and the search field is what somebody leaves a
 * half-typed password for.
 */
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { logoImage } from "@/lib/brandAssets";
import type { MessageKey } from "@shared/i18n/dictionary";

const plain = "pressable flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-extrabold text-[#0a285a] transition-colors hover:bg-[#0a285a]/[.06]";

export function BareHeader({ note, skipLabel = "nav.skipToContent" }: {
  /** A short line beside the logo on a wide screen — checkout's "Pay on delivery". */
  note?: ReactNode;
  skipLabel?: MessageKey;
}) {
  const { t, isArabic } = useTranslation();
  const { toggleLocale } = useCustomer();
  return (
    <>
      <a
        href="#main"
        className="glass glass-navy sr-only rounded-full px-4 py-2 text-xs font-extrabold focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-50"
      >
        {t(skipLabel)}
      </a>
      <header className="border-b border-[#e6e9ef] bg-white">
        <div className="container flex h-[68px] items-center gap-2 lg:h-[76px]">
          <Link href="/" className="me-auto flex shrink-0 items-center" aria-label={t("header.home")}>
            <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-10 w-auto max-w-[120px] object-contain lg:h-12 lg:max-w-[156px]" />
          </Link>
          {note ? <div className="me-2 hidden items-center gap-2 text-[13px] font-semibold text-[#536b8c] sm:flex">{note}</div> : null}
          <button type="button" onClick={toggleLocale} title={t("header.changeLanguage")} className={plain}>
            <span lang={isArabic ? "en" : "ar"}>{t("header.language")}</span>
          </button>
          <Link href="/" className={plain}>
            <ArrowLeft className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
            {/* The arrow alone on a phone; the words stay in the name. */}
            <span className="sr-only sm:not-sr-only">{t("header.continueShopping")}</span>
          </Link>
        </div>
      </header>
    </>
  );
}
