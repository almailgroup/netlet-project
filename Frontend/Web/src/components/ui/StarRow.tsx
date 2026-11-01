/**
 * Five stars for a score, each full, half or empty (`starFills`, the app's
 * `StarRow` is the same drawing): gold for what the score reaches and a pale
 * grey for the rest, a half star cut down its middle. The stars are for the
 * eye; the score is said in words by whatever holds them, so the row is
 * hidden from a screen reader.
 *
 * A half star's gold is clipped from the inline start, so on the Arabic page
 * a row fills from the right, the way it is read there.
 */
import { starFills } from "@shared/commerce/productDetail";
import { Star } from "lucide-react";

export function StarRow({ value, scaleMax = 5, size = 12 }: { value: number; scaleMax?: number; size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center gap-px">
      {starFills(value, scaleMax).map((fill, index) => (
        <span key={index} className="relative block shrink-0" style={{ width: size, height: size }}>
          <Star className="absolute inset-0 size-full fill-[#dfe3ea] text-[#dfe3ea]" strokeWidth={1.5} />
          {fill === "empty" ? null : (
            <span className={`absolute inset-y-0 start-0 overflow-hidden ${fill === "half" ? "w-1/2" : "w-full"}`}>
              <Star className="block fill-[#ffb800] text-[#ffb800]" strokeWidth={1.5} style={{ width: size, height: size }} />
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
