/**
 * The pieces "Your profile" is drawn from (`ProfileManager`,
 * `ProfileDetailCards`), in a file of their own so neither imports the other.
 */
import { useId, type InputHTMLAttributes, type ReactNode } from "react";

/*
 * A box with its label inside the rim, drawn to the owner's reference: the
 * label small and muted at the top, a star when it is needed, what is typed
 * under it, a navy rim while it has focus. The label never moves — the
 * sign-in form's rule against one that lifts as you type — it only sits inside.
 */
export function FloatingField({ label, required = false, start, end, leftToRight = false, className = "", ...input }: {
  label: string;
  required?: boolean;
  /** Drawn before what is typed, like the phone's +965. */
  start?: ReactNode;
  end?: ReactNode;
  /** An email, a password or a number types left to right on either page. */
  leftToRight?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={`relative flex min-h-16 min-w-0 items-center gap-2 rounded-2xl border border-[#d5dfeb] bg-white px-4 py-2 transition focus-within:border-[#0a285a] focus-within:ring-2 focus-within:ring-[#0a285a]/15 ${className}`}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block truncate text-[12px] font-medium ink-muted">
          {label}{required ? <span className="ink-accent" aria-hidden> *</span> : null}
        </label>
        {/* A number or an address reads left to right with what comes before it. */}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5" dir={leftToRight ? "ltr" : undefined}>
          {start}
          <input id={id} {...input} required={required || undefined} dir={leftToRight ? "ltr" : input.dir} className="type-body block w-full min-w-0 bg-transparent text-[16px] font-medium text-[#0a285a] outline-none placeholder:text-[#8a9ab3]" />
        </div>
      </div>
      {end}
    </div>
  );
}

/**
 * The account's one card: white, round-cornered, no rim, a shadow you have to
 * look for — the home's rows and tiles and every "Your profile" card are this,
 * so the two pages read as one design.
 */
export const PANEL = "rounded-3xl bg-white shadow-[0_1px_2px_rgba(10,40,90,.05)]";

/** One of the page's white cards: a title, a line on what it is for, the fields. */
export function ProfileCard({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className={`${PANEL} p-5 sm:p-6`}>
      {title ? <h3 id={titleId} className="text-[17px] font-bold text-[#0a285a]">{title}</h3> : null}
      {note ? <p className={`text-[14px] leading-5 ink-muted ${title ? "mt-1" : ""}`}>{note}</p> : null}
      <div className={title || note ? "mt-4" : ""}>{children}</div>
    </section>
  );
}

/*
 * The account's two buttons, as pills like the home's language switch and
 * points: navy for the one that saves, white with a light rim for the rest
 * (Cancel, "Change email"). Not `.pressable`, which would force its own type.
 */
export const primary =
  "inline-flex h-12 items-center gap-2 rounded-full bg-[#0a285a] px-6 text-[15px] font-semibold text-white enabled:hover:bg-[#0d3372] disabled:opacity-50";

export const secondary =
  "inline-flex h-12 items-center gap-2 rounded-full border border-[#d5dfeb] bg-white px-6 text-[15px] font-semibold text-[#0a285a] hover:bg-[#f0f2f5]";

