/**
 * "Continue with Google" and "Continue with Microsoft" — each drawn to its
 * provider's branding rules for a sign-in button: white, a grey rim, the
 * provider's mark in its own colours, the words beside it, the same height as
 * the form's other buttons. The shop's own buttons rather than either
 * provider's script, because nothing of theirs runs in the page: a press
 * opens the provider's own page in a popup (`lib/popupSignIn.ts`).
 *
 * The nonce and its hash are made before the button can be pressed, since
 * the popup opens only inside a press; a fresh nonce after every attempt.
 */
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { askInPopup, popupAddress, preparePopup, returnPage, type PopupPrepared, type PopupProof, type PopupProvider } from "@/lib/popupSignIn";

type ButtonProps<Label extends string> = {
  clientId: string;
  label?: Label;
  /** The proof is with the server: the button waits with it. */
  busy?: boolean;
  onProof: (proof: PopupProof) => void;
  /** The popup could not be opened or answered nonsense. Closing it is not a failure. */
  onFailed: () => void;
};

export function GoogleButton({ label = "auth.continueWithGoogle", ...props }: ButtonProps<"auth.continueWithGoogle" | "account.deleteWithGoogle">) {
  return (
    <PopupButton
      {...props}
      provider="google"
      label={label}
      className="border-[#747775] text-[#1f1f1f]"
      mark={
        <svg viewBox="0 0 48 48" className="size-[18px] shrink-0" aria-hidden focusable="false">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
      }
    />
  );
}

/** Microsoft's light button: white, a #8C8C8C rim, #5E5E5E words, the four squares. */
export function MicrosoftButton({ label = "auth.continueWithMicrosoft", ...props }: ButtonProps<"auth.continueWithMicrosoft" | "account.deleteWithMicrosoft">) {
  return (
    <PopupButton
      {...props}
      provider="microsoft"
      label={label}
      className="border-[#8c8c8c] text-[#5e5e5e]"
      mark={
        <svg viewBox="0 0 21 21" className="size-[18px] shrink-0" aria-hidden focusable="false">
          <rect x="1" y="1" width="9" height="9" fill="#F25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
          <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
      }
    />
  );
}

function PopupButton({
  provider,
  clientId,
  label,
  busy = false,
  onProof,
  onFailed,
  mark,
  className,
}: Omit<ButtonProps<string>, "label"> & {
  provider: PopupProvider;
  label: "auth.continueWithGoogle" | "account.deleteWithGoogle" | "auth.continueWithMicrosoft" | "account.deleteWithMicrosoft";
  mark: ReactNode;
  className: string;
}) {
  const { t, locale } = useTranslation();
  const [prepared, setPrepared] = useState<PopupPrepared | null>(null);
  const [round, setRound] = useState(0);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    setPrepared(null);
    preparePopup()
      .then(ready => { if (live) setPrepared(ready); })
      .catch(() => { if (live) onFailed(); });
    return () => { live = false; };
    // A new round makes a new nonce; the callback is not what it waits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const press = useCallback(() => {
    if (!prepared || asking) return;
    setAsking(true);
    const returnTo = `${window.location.origin}${appPath(returnPage(provider))}`;
    askInPopup(provider, popupAddress(provider, clientId, prepared, returnTo, locale), prepared)
      .then(proof => { if (proof) onProof(proof); })
      .catch(() => onFailed())
      .finally(() => {
        setAsking(false);
        setRound(count => count + 1);
      });
  }, [asking, clientId, locale, onFailed, onProof, prepared, provider]);

  const waiting = busy || asking;
  return (
    <button
      type="button"
      onClick={press}
      disabled={!prepared || waiting}
      aria-busy={waiting || !prepared ? true : undefined}
      className={`flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border bg-white px-5 text-[15px] font-semibold transition hover:bg-[#f0f2f5] disabled:cursor-wait disabled:opacity-80 ${className}`}
    >
      {waiting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : mark}
      <span>{t(label)}</span>
    </button>
  );
}
