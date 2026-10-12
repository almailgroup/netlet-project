/**
 * The sign-in overlay the header, checkout and the other in-place prompts open.
 *
 * It signs somebody in where they are — a half-filled checkout or a product
 * page is not left for a sign-in page and found again — and the form inside is
 * `AuthForm`, the same one `/signin`, `/signup` and a signed-out `/account`
 * draw, so the three cannot disagree.
 *
 * **One column, the form alone.** It was a card with a navy panel of selling
 * points beside the form; on a wide screen the eye went to the panel, and on a
 * phone the panel was hidden anyway. A dialog somebody opened to sign in is
 * for signing in. What every order carries — delivery across Kuwait, cash on
 * delivery, the return window — sits in one quiet line at its foot.
 *
 * **On a phone it is the whole screen**, not a card floating over the shop:
 * the keyboard takes half of a 390px screen, and a card with a margin round it
 * left the password box under the keyboard. From `sm` up it is a card.
 */
import { RotateCcw, Truck, Wallet, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { useOverlay } from "@/hooks/useOverlay";
import { logoImage } from "@/lib/brandAssets";
import { RETURN_WINDOW_DAYS } from "@shared/commerce/returns";
import { DiscButton } from "@/components/ui/DiscButton";
import { AuthForm, type AuthMode } from "./AuthForm";

export default function AuthDialog({ open, onClose, initialMode = "signin" }: {
  open: boolean;
  onClose: () => void;
  /** "Create account" opens on creating one; everything else on signing in. */
  initialMode?: AuthMode;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const titleId = useId();

  /* Each opening starts where its button said, not where the last one ended. */
  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  useOverlay(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#061b3b]/60" onClick={onClose}>
      <div className="flex min-h-full sm:items-center sm:justify-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={event => event.stopPropagation()}
          className="flex min-h-[100dvh] w-full flex-col bg-white sm:min-h-0 sm:max-w-[460px] sm:overflow-hidden sm:rounded-[28px] sm:shadow-[0_32px_80px_rgba(6,27,59,.35)]"
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-4 sm:px-9 sm:pt-7">
            <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-9 w-auto max-w-[120px] object-contain" />
            <DiscButton onClick={onClose} aria-label={t("auth.close")} discClassName="size-9">
              <X className="size-4" />
            </DiscButton>
          </div>

          <div className="flex-1 px-5 pb-8 pt-6 sm:px-9 sm:pb-9 sm:pt-7">
            <AuthForm mode={mode} onModeChange={setMode} onDone={onClose} titleId={titleId} autoFocus />
          </div>

          <OrderFacts className="border-t border-[#ebe9e1] bg-[#f7f6f2] px-5 py-4 sm:px-9" />
        </div>
      </div>
    </div>
  );
}

/**
 * The three things every order carries, said once at the foot of the form —
 * true of every order, so a fair thing to put beside a password box, where a
 * slogan or an invented count of happy customers would not be.
 */
export function OrderFacts({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const facts = [
    { icon: Truck, label: t("checkout.builtForKuwait") },
    { icon: Wallet, label: t("home.payOnDelivery") },
    { icon: RotateCcw, label: t("home.returnsWithin", { days: RETURN_WINDOW_DAYS }) },
  ];
  return (
    <ul className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] font-semibold text-[#3d5170] ${className}`}>
      {facts.map(fact => (
        <li key={fact.label} className="flex items-center gap-1.5">
          <fact.icon className="size-3.5 shrink-0 text-[#0a285a]" aria-hidden />
          {fact.label}
        </li>
      ))}
    </ul>
  );
}
