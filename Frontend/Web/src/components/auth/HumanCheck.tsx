/**
 * Google's "I'm not a robot" box (reCAPTCHA v2), on Create account.
 *
 * Drawn only when the server says the check is configured
 * (`auth.signupOptions`), and Google's script is fetched only then — on the
 * form that needs it, not on every page that has a header. The box hands back
 * a token, which `auth.register` asks Google about before a code is sent; the
 * token is good once, so the form resets the box after every attempt.
 *
 * In the page's language (`hl`), which Google fixes when its script loads. And
 * compact on a screen too narrow for the ordinary box: it is 304px wide, which
 * on a 320px phone props the form open sideways.
 */
import { CircleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";

type Grecaptcha = {
  render: (container: HTMLElement, options: Record<string, unknown>) => number;
  reset: (widgetId?: number) => void;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
    __netletCaptchaReady?: () => void;
  }
}

/** The ordinary box's width; anything narrower gets the compact one. */
const NORMAL_WIDTH = 304;

let loading: Promise<Grecaptcha> | null = null;

function loadGoogle(locale: string): Promise<Grecaptcha> {
  if (window.grecaptcha?.render) return Promise.resolve(window.grecaptcha);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.__netletCaptchaReady = () => (window.grecaptcha ? resolve(window.grecaptcha) : reject(new Error("no grecaptcha")));
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?onload=__netletCaptchaReady&render=explicit&hl=${encodeURIComponent(locale)}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      /* Forgotten, so a later form can try again rather than inherit the failure. */
      loading = null;
      script.remove();
      reject(new Error("recaptcha did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function HumanCheck({ siteKey, onToken, resetKey, issue, issueId }: {
  siteKey: string;
  /** The token once ticked, null when it lapses or is reset. */
  onToken: (token: string | null) => void;
  /** Changed by the form after each attempt, because a token is good once. */
  resetKey: number;
  /** What is wrong, said under the box. */
  issue?: string | null;
  issueId?: string;
}) {
  const { t, locale } = useTranslation();
  const labelId = useId();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<number | null>(null);
  const tokenSink = useRef(onToken);
  tokenSink.current = onToken;
  const [compact, setCompact] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = box.current;
    if (!container) return;
    let cancelled = false;
    const small = container.offsetWidth > 0 && container.offsetWidth < NORMAL_WIDTH;
    setCompact(small);
    loadGoogle(locale)
      .then(grecaptcha => {
        if (cancelled || widget.current !== null) return;
        widget.current = grecaptcha.render(container, {
          sitekey: siteKey,
          size: small ? "compact" : "normal",
          theme: "light",
          callback: (token: string) => tokenSink.current(token),
          "expired-callback": () => tokenSink.current(null),
          "error-callback": () => tokenSink.current(null),
        });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // Rendered once per mount: Google draws into the box and keeps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  useEffect(() => {
    if (resetKey === 0 || widget.current === null) return;
    window.grecaptcha?.reset(widget.current);
    tokenSink.current(null);
  }, [resetKey]);

  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="text-[14px] font-semibold text-[#0a285a]">{t("auth.captchaLabel")}</p>
      {/* The height is held while Google draws, so nothing under it moves. */}
      <div ref={box} className={`mt-2 ${compact ? "min-h-[144px]" : "min-h-[78px]"}`} />
      {failed ? (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold leading-5 text-[#a3261c]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("auth.captchaLoadFailed")}</span>
        </p>
      ) : issue ? (
        <p id={issueId} className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold leading-5 text-[#a3261c]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{issue}</span>
        </p>
      ) : null}
    </div>
  );
}
