/**
 * The form with room round it: `/signin`, `/signup`, and `/account` while
 * signed out.
 *
 * **The form and a picture of NetLet, and nothing else, on the owner's word**
 * ("perfect, user friendly and understandable — simple, sleek, no unnecessary
 * stuff"). It used to carry a navy panel beside the form — three things the
 * account does, each with an orange tile, and the three facts every order
 * carries — which on a phone followed the form for another screen and a half,
 * so the page somebody opened to sign in was mostly about something else.
 * Checkout and the product page say what an order carries, where it is
 * decided.
 *
 * **The picture is a file**: `Frontend/Web/src/assets/auth/welcome.webp`,
 * NetLet's own street — four stores and the van being loaded, the towers
 * behind. The build picks it up by name, so replacing it is dropping in
 * another file, and with none the card is the form alone rather than an empty
 * frame. Decorative: the title says what the page is.
 *
 * - **From `lg`** it is a card in two halves, the form and the street beside
 *   it, the picture filling its half however tall the form is — framed in a
 *   pale sky margin with rounded corners, the calm colours the owner asked
 *   for ("colors that ease the eyes"), rather than running to the card's edge.
 * - **Below `lg`** the street is a band across the top and the form a white
 *   panel rising over its foot with rounded corners — on a phone reaching the
 *   screen's edges, the shape a phone's own apps open on, and from `sm` the
 *   top of a narrower card.
 */
import { heroSlides, streetImage } from "@/lib/brandAssets";
import { AuthForm, type AuthMode } from "./AuthForm";
import type { PortalSide } from "@shared/portal";

/* Found at build time: an empty match is no picture, never a missing file. */
const WELCOME = streetImage;
/* Its phone copy, half the bytes, for a band a phone draws 390 wide. */
const WELCOME_PHONE = heroSlides.find(slide => slide.src === streetImage)?.phone ?? null;

export function AuthScreen({ mode, onModeChange, onDone, heading, autoFocus, portal }: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onDone?: () => void;
  heading: "h1" | "h2";
  autoFocus?: boolean;
  /** The portal's own sign-in, under its name and with no Create account (`AuthForm`). */
  portal?: PortalSide | null;
}) {
  return (
    /* On a phone the screen reaches the edges, past the page's own gutter and
       top space; from `sm` it is the card. */
    <div className={`mx-auto grid w-full overflow-hidden bg-white max-sm:-mx-4 max-sm:-mt-6 max-sm:w-auto sm:max-w-[520px] sm:rounded-[28px] sm:shadow-[0_24px_64px_rgba(10,40,90,.10)] sm:ring-1 sm:ring-[#dfe6ef] lg:max-w-[1040px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`}>
      {WELCOME ? (
        <div className="relative h-[150px] overflow-hidden bg-[#0a285a] sm:h-[180px] lg:hidden" aria-hidden>
          <picture>
            {WELCOME_PHONE ? <source media="(max-width: 640px)" srcSet={WELCOME_PHONE} /> : null}
            <img src={WELCOME} alt="" loading="eager" decoding="async" className="block size-full object-cover" />
          </picture>
        </div>
      ) : null}

      <section
        className={`relative min-w-0 bg-white px-5 pb-10 pt-7 sm:px-12 sm:pb-12 sm:pt-10 lg:flex lg:min-h-[640px] lg:items-center lg:px-14 lg:py-14 ${
          WELCOME ? "-mt-6 rounded-t-[24px] lg:mt-0 lg:rounded-none" : ""
        }`}
      >
        <div className="mx-auto w-full max-w-[400px]">
          <AuthForm mode={mode} onModeChange={onModeChange} onDone={onDone} heading={heading} autoFocus={autoFocus} portal={portal} />
        </div>
      </section>

      {WELCOME ? (
        <div className="relative hidden min-w-0 bg-[#e7eff8] p-3 lg:block" aria-hidden>
          <div className="relative size-full overflow-hidden rounded-[18px] bg-[#0a285a]">
            <img src={WELCOME} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
