/**
 * The form with room round it: `/signin`, `/signup`, and `/account` while
 * signed out.
 *
 * **One card in two halves.** The form on white, and beside it on a wide
 * screen a navy panel saying what the account is for — three things it
 * actually does, each checkable on the site, and the three facts every order
 * carries — under one picture of NetLet itself when there is one.
 *
 * **The picture is a file**: `client/src/assets/auth/welcome.webp`, NetLet's
 * own street — four stores and the van being loaded, the towers behind. The
 * build picks it up by name, so replacing it is dropping in another file, and
 * with none the panel is its words alone rather than an empty frame or a
 * broken image. The department pictures were here before, and the owner asked
 * for a picture of the marketplace instead of its shelves. It used to be a white
 * card with the same points loose on the pearl beside it, which read as a form
 * and some notes rather than as one thing; drawn as one card it reads as the
 * shop's own door. The navy is the brand's and the panel is flat — no
 * gradient, no blur, no blobs, for the reasons under Buttons in CLAUDE.md.
 *
 * No slogan and no invented numbers: a sign-in page claiming twelve thousand
 * happy sellers is checked once and never trusted again. The one line under
 * the panel's heading is a fact — one account works at every store.
 *
 * On a phone the form comes first and the panel follows it, without the
 * pictures, for somebody deciding whether to make an account; the form is
 * what they came for and the keyboard leaves room for little else.
 */
import { Heart, MapPin, Package } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { AuthForm, type AuthMode } from "./AuthForm";
import { OrderFacts } from "./AuthDialog";

/* Found at build time: an empty match is no picture, never a missing file. */
const WELCOME = Object.values(
  import.meta.glob<string>("../../assets/auth/welcome.{webp,png,jpg,jpeg}", { eager: true, query: "?url", import: "default" }),
)[0] ?? null;

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
    <div className="mx-auto grid w-full max-w-[1120px] overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_rgba(10,40,90,.10)] ring-1 ring-[#e3e1d9] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="min-w-0 px-5 py-8 sm:px-12 sm:py-12 lg:flex lg:items-center lg:px-14 lg:py-14">
        <div className="mx-auto w-full max-w-[420px]">
          <AuthForm mode={mode} onModeChange={onModeChange} onDone={onDone} heading={heading} autoFocus={autoFocus} />
        </div>
      </section>

      <aside className="relative flex min-w-0 flex-col overflow-hidden bg-[#0a285a] text-white">
        {/* NetLet's own street: the stores, the van, the towers. Edge to edge,
            because its edges are the panel's navy and a frame would only draw
            a box round a picture that is meant to be the panel. Cropped a
            little top and bottom (sky and road) so the panel stays the height
            of the form beside it. Decorative — the words below say what the
            account does. */}
        {WELCOME ? (
          <img
            src={WELCOME}
            alt=""
            loading="lazy"
            decoding="async"
            className="block aspect-[16/10] w-full object-cover"
          />
        ) : null}
        {/* The orange of the logo's roof, as one edge: on the picture's foot
            when there is one, on the panel's top when there is not. */}
        <span className={`${WELCOME ? "" : "absolute inset-x-0 top-0 "}h-1.5 shrink-0 bg-[#f2683a]`} aria-hidden />

        <div className="flex flex-1 flex-col px-5 pb-9 pt-8 sm:px-12 sm:pb-12 sm:pt-10 lg:px-12 lg:pb-12">
          <Sub className="text-[22px] font-extrabold leading-tight sm:text-[26px]">{t("auth.asideTitle")}</Sub>
          <p className="mt-2 text-[15px] leading-6 text-[#c9d4e2]">{t("auth.asideNote")}</p>

          <ul className="mt-7 space-y-5 lg:mb-9">
            {points.map(point => (
              <li key={point.title} className="flex gap-3.5">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f2683a] text-[#0a285a]">
                  <point.icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block text-[15px] font-bold text-white">{t(point.title)}</span>
                  <span className="mt-0.5 block text-[14px] leading-6 text-[#c9d4e2]">{t(point.note)}</span>
                </span>
              </li>
            ))}
          </ul>

          {/* At the foot of the panel however tall the form beside it is. */}
          <OrderFacts tone="dark" className="mt-9 border-t border-white/15 pt-6 lg:mt-auto" />
        </div>
      </aside>
    </div>
  );
}
