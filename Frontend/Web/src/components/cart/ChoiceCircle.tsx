/**
 * The circle beside a bag line, a store and All, on the owner's word (a
 * picture of a shop's cart: "you should be able to choose what products you
 * want the price for and only checkout for those products").
 *
 * A checkbox to a screen reader and a keyboard (`role="checkbox"`, with
 * `mixed` for a store or All with some of its lines chosen), drawn as a navy
 * disc with a white tick when chosen, a white minus when partly, and an empty
 * ring when left out. The disc is 22px and the press 44px a side under a
 * coarse pointer — the button is the target and the disc a span inside it,
 * `DiscButton`'s rule, so the bigger hit area never moves the row.
 */
import { Check, Minus } from "lucide-react";

export type ChoiceState = "all" | "none" | "some";

export function ChoiceCircle({ state, label, onToggle, className = "" }: {
  state: ChoiceState;
  /** What choosing it does, said whole: "Include Smart watch in this checkout". */
  label: string;
  /** Pressed: true to choose, false to leave out. Some chosen chooses all. */
  onToggle: (chosen: boolean) => void;
  className?: string;
}) {
  const checked = state === "all" ? true : state === "some" ? "mixed" : false;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onToggle(state !== "all")}
      className={`choice-circle grid size-11 shrink-0 place-items-center rounded-full pointer-fine:size-8 ${className}`}
    >
      <span
        aria-hidden
        className={`grid size-[22px] place-items-center rounded-full border-2 transition-colors duration-150 ${
          state === "none" ? "border-[#6f7f99] bg-white" : "border-[#0a285a] bg-[#0a285a] text-white"
        }`}
      >
        {state === "all" ? <Check className="size-3.5" strokeWidth={3.2} /> : state === "some" ? <Minus className="size-3.5" strokeWidth={3.2} /> : null}
      </span>
    </button>
  );
}
