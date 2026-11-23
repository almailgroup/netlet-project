/**
 * Checkout's round icons, on the owner's word ("for the payment method make
 * it icons, round shaped icons … the same for the codes, gift cards and
 * points"): a circle with its mark, its name under it, and a line under that
 * saying where it stands. The payment methods are a radio group of them and
 * the codes, the gift card and the points are three that each open their own
 * box (`BagSavings`); this file is only what they look like.
 *
 * **The marks of KNET, Visa and Mastercard and Apple Pay are mockups**, on the
 * owner's word ("for now add a mockup design"): NetLet's own drawing of how
 * each will look, never a brand's file, and none can be chosen until a card
 * service is integrated (3.2.1).
 */
import { Banknote, Check, Gift, Ticket } from "lucide-react";
import type { ReactNode } from "react";
import { PointsCoin } from "@/components/ui/PointsCoin";

export type RoundBadge = "done" | "problem" | null;

/** The circle: its own fill, a navy ring round it while it is the one chosen or open, and a corner badge. */
export function RoundFace({ fill, ring, badge, children }: { fill: string; ring: boolean; badge?: RoundBadge; children: ReactNode }) {
  return (
    <span aria-hidden className="relative grid shrink-0 place-items-center">
      <span
        className={`grid size-[52px] place-items-center overflow-hidden rounded-full border transition-[box-shadow,border-color] duration-200 sm:size-14 ${fill} ${
          ring ? "border-[#0a285a] shadow-[0_0_0_2px_#ffffff,0_0_0_4px_#0a285a]" : "border-[#e1e6ee]"
        }`}
      >
        {children}
      </span>
      {badge ? (
        <span
          className={`absolute -end-0.5 -top-0.5 grid size-5 place-items-center rounded-full border-2 border-white text-white ${
            badge === "done" ? "bg-[#2f7a3a]" : "bg-[#b42318]"
          }`}
        >
          {badge === "done" ? <Check className="size-3" strokeWidth={3} /> : <span className="text-[11px] font-extrabold leading-none">!</span>}
        </span>
      ) : null}
    </span>
  );
}

export type PaymentMark = "cod" | "knet" | "card" | "apple";

/** What each way to pay looks like inside its circle, and the circle's own fill. */
export function paymentFace(mark: PaymentMark, chosen: boolean): { fill: string; mark: ReactNode } {
  switch (mark) {
    case "cod":
      return { fill: chosen ? "bg-[#0a285a] text-white" : "bg-[#eef3fa] text-[#0a285a]", mark: <Banknote className="size-6" strokeWidth={1.75} /> };
    case "knet":
      /* KNET's own blue with a green bar under the word: a mockup, not the mark. */
      return {
        fill: "bg-white",
        mark: (
          <span className="flex flex-col items-center leading-none">
            <span className="text-[13px] font-black tracking-[-0.02em] text-[#0b4ea2]">KNET</span>
            <span className="mt-1 h-[3px] w-7 rounded-full bg-[#2fa84f]" />
          </span>
        ),
      };
    case "card":
      return {
        fill: "bg-white",
        mark: (
          <span className="flex flex-col items-center leading-none">
            <span className="text-[11px] font-black italic tracking-[-0.02em] text-[#1a1f71]">VISA</span>
            <svg viewBox="0 0 32 20" className="mt-1 h-[13px] w-auto" focusable="false">
              <circle cx="11" cy="10" r="9" fill="#eb001b" />
              <circle cx="21" cy="10" r="9" fill="#f79e1b" />
              <path d="M16 2.6a9 9 0 0 1 0 14.8a9 9 0 0 1 0-14.8z" fill="#ff5f00" />
            </svg>
          </span>
        ),
      };
    case "apple":
      return {
        fill: "bg-black text-white",
        mark: (
          <span className="flex items-center gap-[2px] leading-none" dir="ltr">
            <svg viewBox="0 0 814 1000" className="h-[14px] w-auto" fill="currentColor" focusable="false">
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
            </svg>
            <span className="text-[13px] font-semibold tracking-[-0.01em]">Pay</span>
          </span>
        ),
      };
  }
}

export type SavingsMark = "discount" | "gift" | "points";

/** The code, the gift card and the points, each on a fill of its own drawn from the navy and the orange. */
export function savingsFace(mark: SavingsMark): { fill: string; mark: ReactNode } {
  switch (mark) {
    case "discount":
      return { fill: "bg-[#eaf1fb] text-[#0a285a]", mark: <Ticket className="size-6" strokeWidth={1.75} /> };
    case "gift":
      return { fill: "bg-[#fdf0e8] text-[#a44a2b]", mark: <Gift className="size-6" strokeWidth={1.75} /> };
    case "points":
      return { fill: "bg-[#fff6df]", mark: <PointsCoin size={30} /> };
  }
}

/** The name under a circle and the line under that. Two lines of name at most, centred. */
export function RoundLabel({ title, note, tone = "muted" }: { title: string; note?: ReactNode; tone?: "muted" | "good" | "bad" }) {
  return (
    <span className="mt-2 flex min-w-0 flex-col items-center text-center">
      <span className="line-clamp-2 text-[12px] font-bold leading-4 text-[#0a285a] sm:text-[13px]">{title}</span>
      {note ? (
        <span className={`mt-0.5 line-clamp-1 max-w-full text-[11px] font-semibold leading-4 ${tone === "good" ? "text-[#2f5d33]" : tone === "bad" ? "text-[#8c2f22]" : "ink-muted"}`}>{note}</span>
      ) : null}
    </span>
  );
}
