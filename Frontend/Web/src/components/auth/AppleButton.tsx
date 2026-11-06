/**
 * "Continue with Apple" — Apple's own button, as Apple's guidelines draw it:
 * black, the Apple mark in white, the words beside it, the same height as the
 * form's own button. One door for signing in and creating an account, since
 * Apple's window does not tell them apart.
 *
 * Apple's script, the nonce and its hash are made before the button can be
 * pressed (`prepareApple`), because Apple's window opens only inside a press;
 * the button says it is getting ready meanwhile rather than offering a press
 * that would be blocked. A fresh nonce is made after every attempt.
 */
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { askApple, prepareApple, type ApplePrepared, type AppleProof } from "@/lib/appleSignIn";

export function AppleButton({
  clientId,
  label = "auth.continueWithApple",
  busy = false,
  onProof,
  onFailed,
}: {
  clientId: string;
  label?: "auth.continueWithApple" | "account.deleteWithApple";
  /** The proof is with the server: the button waits with it. */
  busy?: boolean;
  onProof: (proof: AppleProof) => void;
  /** Apple's window could not be opened or answered nonsense. Closing it is not a failure. */
  onFailed: () => void;
}) {
  const { t, locale } = useTranslation();
  const [prepared, setPrepared] = useState<ApplePrepared | null>(null);
  const [round, setRound] = useState(0);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    setPrepared(null);
    prepareApple(locale)
      .then(ready => { if (live) setPrepared(ready); })
      .catch(() => { if (live) onFailed(); });
    return () => { live = false; };
    // A new round makes a new nonce; the callback is not what it waits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, round]);

  const press = useCallback(() => {
    if (!prepared || asking) return;
    setAsking(true);
    const returnTo = `${window.location.origin}${appPath("/signin")}`;
    askApple(clientId, prepared, returnTo)
      .then(proof => { if (proof) onProof(proof); })
      .catch(() => onFailed())
      .finally(() => {
        setAsking(false);
        setRound(count => count + 1);
      });
  }, [asking, clientId, onFailed, onProof, prepared]);

  const waiting = busy || asking;
  return (
    <button
      type="button"
      onClick={press}
      disabled={!prepared || waiting}
      aria-busy={waiting || !prepared ? true : undefined}
      className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl tint-on-hover bg-black px-5 text-[15px] font-semibold text-white transition disabled:cursor-wait disabled:opacity-80"
    >
      {waiting ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : (
        <svg viewBox="0 0 814 1000" className="h-[18px] w-auto shrink-0" fill="currentColor" aria-hidden focusable="false">
          <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
        </svg>
      )}
      <span>{t(label)}</span>
    </button>
  );
}

/** The line between the form's own button and Apple's. */
export function OrDivider() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 text-[13px] font-medium text-[#536b8c]" aria-hidden>
      <span className="h-px flex-1 bg-[#d8dfe9]" />
      {t("auth.or")}
      <span className="h-px flex-1 bg-[#d8dfe9]" />
    </div>
  );
}
