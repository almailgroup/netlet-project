/**
 * The form with room round it: `/signin`, `/signup`, and `/account` while
 * signed out.
 *
 * The form is a white card and beside it, on a wide screen, what an account is
 * for — three things the account actually does, each checkable on the site,
 * over the shop's own department pictures, so the page looks like the shop it
 * signs into rather than a form anywhere. No slogan and no invented numbers: a
 * sign-in page claiming twelve thousand happy sellers is checked once and never
 * trusted again. On a phone the form comes first and the three points follow
 * it, without the pictures, for somebody deciding whether to make an account.
 */
import { Heart, MapPin, Package } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { AuthForm, type AuthMode } from "./AuthForm";
import { OrderFacts } from "./AuthDialog";

const ART = ["electronics", "home-and-kitchen", "style", "beauty", "grocery", "all"] as const;

export function AuthScreen({ mode, onModeChange, onDone, heading, autoFocus }: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onDone?: () => void;
  heading: "h1" | "h2";
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const Sub = heading === "h1" ? "h2" : "h3";
  const points = [
    { icon: Package, title: "auth.benefitOrders", note: "auth.benefitOrdersNote" },
    { icon: MapPin, title: "auth.benefitCheckout", note: "auth.benefitCheckoutNote" },
    { icon: Heart, title: "auth.benefitLists", note: "auth.benefitListsNote" },
  ] as const;

  return (
    <div className="mx-auto grid w-full max-w-[1080px] items-start gap-8 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:gap-14">
      <section className="w-full min-w-0 rounded-[28px] border border-[#e3e1d9] bg-white px-5 py-8 shadow-[0_24px_60px_rgba(10,40,90,.07)] sm:px-10 sm:py-10">
        <AuthForm mode={mode} onModeChange={onModeChange} onDone={onDone} heading={heading} autoFocus={autoFocus} />
      </section>

      <aside className="min-w-0 lg:pt-4">
        <div className="hidden grid-cols-3 gap-3 lg:grid" aria-hidden>
          {ART.map(slug => (
            <div key={slug} className="grid aspect-[4/3] place-items-center rounded-2xl bg-white p-3">
              <img
                src={appPath(`/departments/${slug}.webp`)}
                alt=""
                loading="lazy"
                decoding="async"
                className="max-h-full w-auto object-contain"
              />
            </div>
          ))}
        </div>

        <Sub className="text-[20px] font-extrabold text-[#0a285a] lg:mt-9 lg:text-[22px]">{t("auth.asideTitle")}</Sub>
        <ul className="mt-5 space-y-5">
          {points.map(point => (
            <li key={point.title} className="flex gap-3.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[#0a285a] shadow-[0_1px_2px_rgba(10,40,90,.08)]">
                <point.icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block text-[15px] font-bold text-[#0a285a]">{t(point.title)}</span>
                <span className="mt-0.5 block text-[14px] leading-6 text-[#3d5170]">{t(point.note)}</span>
              </span>
            </li>
          ))}
        </ul>
        <OrderFacts className="mt-8 border-t border-[#e3e1d9] pt-6" />
      </aside>
    </div>
  );
}
