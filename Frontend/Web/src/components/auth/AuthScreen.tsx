/**
 * The form with room round it: `/signin`, `/signup`, and `/account` while
 * signed out.
 *
 * **One card in two halves.** The form on white, and beside it on a wide
 * screen a navy panel saying what the account is for — three things it
 * actually does, each checkable on the site, and the three facts every order
 * carries — under one picture of NetLet itself when there is one.
 *
 * **The picture is a file**: `Frontend/Web/src/assets/auth/welcome.webp`, NetLet's
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
 * **On a phone it is a screen of its own, not a card on the page**, on the
 * owner's word ("make the login and sign-up page better"): the street is a
 * band across the top, the width of the screen, and the form is a white panel
 * that rises over its foot with rounded corners — the shape a phone's own
 * apps open on — reaching the screen's edges rather than sitting in a card
 * with a margin round it, which took 40 pixels from every box. The panel of
 * what the account does follows the form, without its picture, which is the
 * band now; the form is what somebody came for and the keyboard leaves room
 * for little else. From `sm` up it is the card in two halves, as before.
 */
import { Heart, MapPin, Package } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { heroSlides, streetImage } from "@/lib/brandAssets";
import { AuthForm, type AuthMode } from "./AuthForm";
import { OrderFacts } from "./AuthDialog";

/* Found at build time: an empty match is no picture, never a missing file. */
const WELCOME = streetImage;
/* Its phone copy, half the bytes, for a band a phone draws 390 wide. */
const WELCOME_PHONE = heroSlides.find(slide => slide.src === streetImage)?.phone ?? null;

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
    /* On a phone the screen reaches the edges, past the page's own gutter and
       top space (`PageBody`, `PAGE_SPACE`); from `sm` it is the card. */
    <div className="mx-auto grid w-full max-w-[1120px] overflow-hidden bg-white max-sm:-mx-4 max-sm:-mt-6 max-sm:w-auto sm:rounded-[28px] sm:shadow-[0_30px_80px_rgba(10,40,90,.10)] sm:ring-1 sm:ring-[#e3e1d9] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* The street, across the top of a phone's screen. Decorative: the form
          under it says what the page is. The navy at its foot is the panel's
          shadow falling on it, so the white edge reads as lifted. */}
      {WELCOME ? (
        <div className="relative h-[176px] overflow-hidden bg-[#0a285a] sm:hidden" aria-hidden>
          <picture>
            {WELCOME_PHONE ? <source media="(max-width: 640px)" srcSet={WELCOME_PHONE} /> : null}
            <img src={WELCOME} alt="" loading="eager" decoding="async" className="block size-full object-cover" />
          </picture>
          <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0a285a]/45 to-transparent" />
        </div>
      ) : null}
      <section className={`relative min-w-0 bg-white px-5 pb-8 sm:px-12 sm:py-12 lg:flex lg:items-center lg:px-14 lg:py-14 ${WELCOME ? "max-sm:-mt-7 max-sm:rounded-t-[28px] max-sm:pt-7 max-sm:shadow-[0_-10px_30px_rgba(6,27,59,.18)]" : "pt-8"}`}>

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
            className="block aspect-[16/10] w-full object-cover max-sm:hidden"
          />
        ) : null}
        {/* The orange of the logo's roof, as one edge: on the picture's foot
            when there is one, on the panel's top when there is not (a phone's,
            whose picture is the band at the top). */}
        <span className={`${WELCOME ? "max-sm:absolute max-sm:inset-x-0 max-sm:top-0 " : "absolute inset-x-0 top-0 "}h-1.5 shrink-0 bg-[#f2683a]`} aria-hidden />

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
