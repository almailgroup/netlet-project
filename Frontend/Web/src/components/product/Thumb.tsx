/**
 * A picture that might not be there, drawn so that it is never a broken icon.
 *
 * Product imagery is a URL a vendor typed — `Backend/src/services/inventory.ts` says so, and
 * will until uploads exist — so a dead link is an ordinary state rather than an
 * edge case. Every `<img>` in the storefront handled the *absent* case and none
 * of them handled the *failing* one, which is the more likely of the two: the
 * browser draws its own broken-image glyph on a white ground, and a category
 * rail of those looks like the site is broken rather than like one seller
 * mistyped a URL.
 *
 * One component rather than an `onError` at each call site, for the reason
 * `SettingPanel` is one component: fourteen copies of a fallback is fourteen
 * chances for one of them to be forgotten, and the forgotten one is the one a
 * shopper sees.
 */
import { ImageOff } from "lucide-react";
import { useState, type ReactNode } from "react";

export function Thumb({
  src,
  alt,
  className = "",
  priority = false,
  eager = false,
  icon,
  /**
   * The fallback's own surface, when the caller has a better one than a grey
   * box — the department tiles carry a colour per department and a neutral
   * fallback painted over it, which lost the one thing distinguishing them.
   */
  fallbackClassName = "bg-[#e7edf5] text-[#8aa0bd]",
  onLoad,
  draggable,
  style,
}: {
  src?: string | null;
  /** Empty for decoration, which is then also hidden from assistive tech. */
  alt: string;
  className?: string;
  /** The page's largest paint — its own picture, not a card in a rail. */
  priority?: boolean;
  /**
   * Fetched now, at no special priority: a picture drawn because it is about
   * to be looked at, somewhere the browser's lazy loading cannot tell — off to
   * the side of a scroller.
   */
  eager?: boolean;
  icon?: ReactNode;
  fallbackClassName?: string;
  onLoad?: () => void;
  draggable?: boolean;
  style?: React.CSSProperties;
}) {
  /*
   * The *failed* src rather than a boolean: a swatch that swaps the photo hands
   * this a new `src`, and a boolean would keep showing the fallback for a
   * picture that is perfectly fine. Storing which URL broke makes a new one
   * automatically un-broken, with no effect to reset it.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const broken = !src || failedSrc === src;

  if (broken) {
    return (
      <span
        aria-hidden
        className={`grid place-items-center ${fallbackClassName} ${className}`}
        style={style}
      >
        {icon ?? <ImageOff className="size-[28%] max-h-8 min-h-4 min-w-4 max-w-8" />}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt === "" ? true : undefined}
      loading={priority || eager ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      draggable={draggable}
      style={style}
      onError={() => setFailedSrc(src)}
      onLoad={onLoad}
      className={className}
    />
  );
}
