/**
 * The portal's building blocks: a page heading, a card, a labelled field and
 * three buttons.
 *
 * Every admin page used to style these for itself, and they had drifted into
 * five label sizes (10px to 13px), three input heights and focus rings in the
 * brand orange on some pages and navy on others. Navy, as `.glass-field` has
 * it: the orange is a fill, and as a 1px ring on white it is the 3.08:1 pairing
 * the colour rules already moved the words off. One copy is what keeps them
 * from drifting again, which is the argument `StoreHeader` makes for the shop.
 *
 * Sizes are set here rather than through `.pressable`, whose `!important`
 * 14px/500 is the storefront's and would flatten a portal heading.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { AlertCircle } from "lucide-react";
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/**
 * A merchant's words placed inside one of ours, kept in their own direction.
 *
 * A product name goes into "Delete “{title}”?" and into toasts, and a Latin
 * name inside an Arabic sentence otherwise takes the sentence's punctuation
 * with it — the quote marks and a trailing hyphen landed on the wrong sides.
 * First-strong isolate and its pop are what `<bdi>` does, for a string.
 */
export const isolate = (text: string) => `\u2068${text}\u2069`;

/** A text box, a select or a textarea. Grows to 44px, so a thumb can hit it. */
export const fieldClass =
  "type-body h-11 w-full rounded-xl border border-[#cfd9e6] bg-white px-3.5 text-[14px] text-[#0a285a] outline-none transition placeholder:text-[#6b7c93] focus:border-[#0a285a] focus:ring-2 focus:ring-[#0a285a]/15 disabled:cursor-not-allowed disabled:bg-[#f4f6f9] disabled:text-[#536b8c] aria-[invalid=true]:border-[#b3412c] aria-[invalid=true]:focus:ring-[#b3412c]/15";

const buttonBase =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a285a] disabled:cursor-not-allowed disabled:opacity-60";

export const buttonClass = {
  primary: `${buttonBase} bg-[#0a285a] text-white hover:bg-[#0d3372]`,
  secondary: `${buttonBase} border border-[#cfd9e6] bg-white text-[#0a285a] hover:bg-[#f2f5f9]`,
  danger: `${buttonBase} bg-[#8c2f22] text-white hover:bg-[#7a2a1e]`,
  /* For a destructive act that is not the page's main one: red words, no fill. */
  quietDanger: `${buttonBase} border border-[#efc6bd] bg-white text-[#8c2f22] hover:bg-[#fdeceb]`,
} as const;

/** The page's own heading, its one line of explanation and its actions. */
export function PageHeader({ title, description, actions, children }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Anything that belongs above the heading, like a way back. */
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {children}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 dir="auto" className="text-[22px] leading-8 font-extrabold text-[#0a285a] sm:text-[24px]">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-[14px] leading-6 ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/**
 * One section of a page: a heading, a line on what it is for, the fields, and
 * its own Save at the foot — one Save per section, so pressing it writes only
 * what that section says.
 */
export function Card({ id, title, description, step, footer, tone = "normal", children }: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  /** A number beside the heading, for a form somebody fills in order. */
  step?: number;
  footer?: ReactNode;
  tone?: "normal" | "danger";
  children?: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`scroll-mt-24 rounded-2xl border bg-white ${tone === "danger" ? "border-[#efc6bd]" : "border-[#e1e7ef]"}`}
    >
      <div className="px-5 pt-5 sm:px-6">
        <h2 id={headingId} className={`flex items-center gap-2.5 text-[16px] leading-6 font-bold ${tone === "danger" ? "text-[#8c2f22]" : "text-[#0a285a]"}`}>
          {step ? (
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-[#e7edf5] text-[12px] font-bold text-[#0a285a]">{step}</span>
          ) : null}
          {title}
        </h2>
        {description ? <p className="mt-1 max-w-2xl text-[13px] leading-5 ink-muted">{description}</p> : null}
      </div>
      {children ? <div className="px-5 pt-4 pb-5 sm:px-6">{children}</div> : <div className="pb-5" />}
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-[#eef1f5] bg-[#fafbfd] px-5 py-3 sm:px-6">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A label, the control, and either the problem or the hint under it.
 *
 * The control is the one child, and it is given the id the label points at and
 * the description it should be read with — so the message a seller sees under
 * a box is the message a screen reader says on entering it, and an error
 * replaces the hint rather than stacking on it.
 */
export function Field({ label, hint, error, optional, className = "", children }: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}) {
  const { t } = useTranslation();
  const generated = useId();
  const id = (isValidElement(children) && children.props.id) || generated;
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-describedby": note ? noteId : undefined,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  return (
    <div className={className}>
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-5 font-semibold text-[#0a285a]">
        {label}
        {optional ? <span className="text-[12px] font-normal ink-muted">{t("admin.optional")}</span> : null}
      </label>
      <div className="mt-1.5">{control}</div>
      {error ? (
        <p id={noteId} className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-5 font-semibold text-[#8c2f22]">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{error}
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1.5 text-[12px] leading-5 ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Placeholder rows while a table loads, announced once rather than drawn silently. */
export function SkeletonRows({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div role="status" className="space-y-px overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden className="flex items-center gap-4 border-b border-[#f0f2f6] px-4 py-3.5 last:border-b-0">
          <div className="size-11 shrink-0 animate-pulse rounded-lg bg-[#eef1f6]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-2/5 animate-pulse rounded bg-[#eef1f6]" />
            <div className="h-2.5 w-1/4 animate-pulse rounded bg-[#f3f5f8]" />
          </div>
          <div className="hidden h-3 w-16 animate-pulse rounded bg-[#eef1f6] sm:block" />
        </div>
      ))}
    </div>
  );
}
