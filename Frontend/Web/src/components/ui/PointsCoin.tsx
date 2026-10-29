/**
 * The NetLet points coin, on the owner's word ("add a good coin icon for
 * NetLet points"): wherever a balance of points is drawn — the account's
 * points row, the points page, the affiliate page, checkout's points line —
 * so a point is recognised before its number is read.
 *
 * A coin in the brand's warm end: an amber face lit from above, running into
 * the brand orange at its foot, on a darker edge that gives it thickness, a
 * pressed ring inside the rim and NetLet's N in the navy at its centre, with a
 * soft gloss at the top. It is drawn rather than a file so it is sharp at every
 * size from the 16px of a line to the 56px of the points page, and the app's
 * `PointsCoin` draws the same shapes.
 *
 * Decorative unless given a `label`: beside a figure that says "points" the
 * coin is the figure's picture, and a screen reader saying "coin" before it
 * says nothing the figure does not.
 */
import { useId } from "react";

export function PointsCoin({ size = 20, className = "", label }: { size?: number; className?: string; label?: string }) {
  /* Each coin's gradients get their own ids: two coins sharing one id lose
     their fill the moment the first is hidden. */
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd894" />
          <stop offset="0.5" stopColor="#fbab48" />
          <stop offset="1" stopColor="#f2843a" />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* The edge, a little lower than the face, is the coin's thickness. */}
      <circle cx="20" cy="21.6" r="17.6" fill="#c8601f" />
      <circle cx="20" cy="19.6" r="17.6" fill={`url(#${id}f)`} />
      <circle cx="20" cy="19.6" r="17" fill="none" stroke={`url(#${id}r)`} strokeWidth="1.2" />
      {/* The pressed ring: a groove in the orange, lit along its foot. */}
      <circle cx="20" cy="19.6" r="13.1" fill="none" stroke="#d86f27" strokeOpacity="0.55" strokeWidth="1.3" />
      <circle cx="20" cy="20.3" r="13.1" fill="none" stroke="#ffffff" strokeOpacity="0.32" strokeWidth="0.8" />
      <path d="M14.3 26.1V13.2h3.1l6.2 8.3v-8.3h3.1v12.9h-3.1l-6.2-8.3v8.3z" fill="#0a285a" />
      <ellipse cx="14.5" cy="9.4" rx="7.2" ry="3.1" fill="#ffffff" fillOpacity="0.32" transform="rotate(-24 14.5 9.4)" />
    </svg>
  );
}
