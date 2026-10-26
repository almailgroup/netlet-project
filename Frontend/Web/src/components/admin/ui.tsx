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
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, CircleAlert, Eye, EyeOff, Info } from "lucide-react";
import { Link } from "wouter";
import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";

/** Re-exported so every portal page takes it from where it takes the rest. */
export { isolate } from "@/lib/isolate";

/** A text box, a select or a textarea. Grows to 44px, so a thumb can hit it. */
export const fieldClass =
  "type-body h-11 w-full rounded-xl border border-[#cfd9e6] bg-white px-3.5 text-[14px] text-[#0a285a] outline-none transition placeholder:text-[#6b7c93] focus:border-[#0a285a] focus:ring-2 focus:ring-[#0a285a]/15 disabled:cursor-not-allowed disabled:bg-[#f4f6f9] disabled:text-[#536b8c] aria-[invalid=true]:border-[#b3412c] aria-[invalid=true]:focus:ring-[#b3412c]/15";

const buttonBase =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a285a] disabled:cursor-not-allowed disabled:opacity-60";

export const buttonClass = {
  primary: `${buttonBase} bg-[#0a285a] text-white hover:bg-[#0d3372]`,
  secondary: `${buttonBase} border border-[#cfd9e6] bg-white text-[#0a285a] hover:bg-[#f0f2f5]`,
  danger: `${buttonBase} bg-[#8c2f22] text-white hover:bg-[#7a2a1e]`,
  /* For a destructive act that is not the page's main one: red words, no fill. */
  quietDanger: `${buttonBase} border border-[#efc6bd] bg-white text-[#8c2f22] hover:bg-[#fdeceb]`,
} as const;

/** The same three, a size down, for an action inside a row of a list. */
const smallBase =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0a285a] disabled:cursor-not-allowed disabled:opacity-60";

export const smallButtonClass = {
  primary: `${smallBase} bg-[#0a285a] text-white hover:bg-[#0d3372]`,
  secondary: `${smallBase} border border-[#cfd9e6] bg-white text-[#0a285a] hover:bg-[#f0f2f5]`,
  danger: `${smallBase} bg-[#8c2f22] text-white hover:bg-[#7a2a1e]`,
  quietDanger: `${smallBase} border border-[#efc6bd] bg-white text-[#8c2f22] hover:bg-[#fdeceb]`,
} as const;

/** A text box that grows, on the same rules as a field. */
export const textareaClass = `${fieldClass} h-auto min-h-24 py-2.5 leading-6`;

/** A list's table, its header cells and its body cells. */
export const tableClass = {
  wrap: "overflow-x-auto rounded-2xl border border-[#e1e7ef] bg-white",
  table: "w-full text-start text-[14px]",
  head: "border-b border-[#e1e7ef] bg-[#fafbfd] text-[13px] text-[#536b8c]",
  th: "px-4 py-3 text-start font-semibold whitespace-nowrap",
  /* A header cell's own alignment is the browser's centre, not inherited, so
     a right-hand column needs its own class rather than `th` plus `text-end`
     — the two utilities tie and whichever Tailwind wrote later wins. */
  thEnd: "px-4 py-3 text-end font-semibold whitespace-nowrap",
  row: "border-b border-[#f0f2f6] last:border-b-0",
  td: "px-4 py-3 align-top",
} as const;

/** The way back to the list a page belongs to, above its heading. */
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a]">
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{children}
    </Link>
  );
}

/**
 * A heading inside a page that is not a card's — a group of tiles, a list.
 * Sentence case and 16px: an uppercase tracked label over a section is the
 * mark of generated design the storefront already removed, and it does
 * nothing in Arabic.
 */
export function SectionHeading({ children, description, actions, className = "" }: {
  children: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[16px] leading-6 font-bold text-[#0a285a]">{children}</h2>
        {description ? <p className="mt-0.5 max-w-2xl text-[13px] leading-5 ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Nothing here yet, said in a sentence, with the one thing to do about it. */
export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#b8c9dc] bg-white px-6 py-12 text-center">
      <p className="text-[15px] font-bold text-[#0a285a]">{title}</p>
      {children ? <div className="mx-auto mt-2 max-w-md text-[14px] leading-6 text-[#536b8c]">{children}</div> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

const NOTICE_TONE = {
  info: { box: "border-[#cfd9e6] bg-[#f4f7fb] text-[#0a285a]", icon: Info },
  warning: { box: "border-[#ecd49a] bg-[#fff8e6] text-[#5c3f0c]", icon: CircleAlert },
  danger: { box: "border-[#f2b69e] bg-[#fdeceb] text-[#8c2f22]", icon: AlertTriangle },
  success: { box: "border-[#b9dcc1] bg-[#eef8f0] text-[#1f4d2a]", icon: CheckCircle2 },
} as const;

/** A sentence the page needs somebody to read before they act. */
export function Notice({ tone = "info", children, action, className = "" }: {
  tone?: keyof typeof NOTICE_TONE;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const { box, icon: Icon } = NOTICE_TONE[tone];
  return (
    <div role="note" className={`flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-[14px] leading-6 ${box} ${className}`}>
      <Icon className="mt-1 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const PILL_TONE = {
  neutral: "bg-[#eef1f5] text-[#3d5376]",
  navy: "bg-[#e7edf5] text-[#0a285a]",
  good: "bg-[#d4edda] text-[#155724]",
  warning: "bg-[#fff3cd] text-[#6b4f1d]",
  danger: "bg-[#fdeceb] text-[#8c2f22]",
} as const;

/** A short state beside a name: a status, a count, a badge. */
export function Pill({ tone = "neutral", children }: { tone?: keyof typeof PILL_TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold whitespace-nowrap ${PILL_TONE[tone]}`}>
      {children}
    </span>
  );
}

/**
 * A filter of a few states, all visible at once — the one in force is seen
 * without opening anything, which a dropdown cannot say. Buttons with
 * `aria-pressed` in a named group: it filters a list, it does not switch
 * panels, so it is not a tablist.
 */
export function Segmented<T extends string>({ label, options, value, onChange, className = "" }: {
  label: string;
  options: readonly { value: T; label: ReactNode; count?: number | null }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`hide-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-xl bg-[#eef1f5] p-1 ${className}`}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition ${value === option.value ? "bg-white text-[#0a285a] shadow-sm" : "text-[#536b8c] hover:text-[#0a285a]"}`}
        >
          {option.label}
          {option.count != null ? <span className="tabular-nums text-[12px] font-normal ink-muted">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** A labelled switch with its explanation, for a yes/no that changes behaviour. */
export function Toggle({ checked, onChange, label, hint, disabled, className = "" }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`tint-on-hover flex cursor-pointer items-start gap-3 rounded-xl border border-[#e1e7ef] bg-[#fafbfd] p-3.5 ${disabled ? "cursor-not-allowed opacity-60" : ""} ${className}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[#0a285a]"
      />
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-[#0a285a]">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12px] leading-5 ink-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * A figure and what it counts. The row is a list, not a `dl`: a tile that is
 * also a link cannot hold `dt`/`dd`, and axe refuses the pair inside an anchor.
 */
export function Stat({ label, value, note, href, tone = "normal" }: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  href?: string;
  tone?: "normal" | "good" | "warning" | "danger";
}) {
  const ink = tone === "good" ? "text-[#2f5d33]" : tone === "warning" ? "text-[#6b4f1d]" : tone === "danger" ? "text-[#8c2f22]" : "text-[#0a285a]";
  const body = (
    <>
      <span className="block text-[13px] font-semibold ink-muted">{label}</span>
      <span className={`mt-1 block text-[24px] leading-8 font-extrabold tabular-nums ${ink}`}>{value}</span>
      {note ? <span className="mt-0.5 block text-[12px] leading-5 ink-muted">{note}</span> : null}
    </>
  );
  const box = "block h-full rounded-2xl border border-[#e1e7ef] bg-white p-4";
  return (
    <li className="min-w-0">
      {href ? (
        href.startsWith("#")
          ? <a href={href} className={`${box} transition hover:border-[#0a285a]/30`}>{body}</a>
          : <Link href={href} className={`${box} transition hover:border-[#0a285a]/30`}>{body}</Link>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

/** A row of `Stat`s: two to a phone, more as the page widens. */
export function StatGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${className}`}>{children}</ul>;
}

/** Placeholder blocks while a page's cards load, announced once. */
export function SkeletonCards({ count = 3, label }: { count?: number; label: string }) {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} aria-hidden className="rounded-2xl border border-[#e1e7ef] bg-white p-5">
          <div className="h-4 w-1/3 animate-pulse rounded bg-[#eef1f6]" />
          <div className="mt-4 h-3 w-2/3 animate-pulse rounded bg-[#f3f5f8]" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-[#f3f5f8]" />
        </div>
      ))}
    </div>
  );
}

/**
 * The page's own heading, its one line of explanation and its actions.
 *
 * `leading` sits before the heading (a store's logo) and `meta` under it (its
 * status and address), outside the `h1`, so the heading a screen reader lists
 * is the name and nothing else.
 */
export function PageHeader({ title, description, actions, leading, meta, children }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  meta?: ReactNode;
  /** Anything that belongs above the heading, like a way back. */
  children?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {children}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="min-w-0">
            <h1 dir="auto" className="text-[22px] leading-8 font-extrabold break-words text-[#0a285a] sm:text-[24px]">{title}</h1>
            {meta ? <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px]">{meta}</div> : null}
            {description ? <p className="mt-1 max-w-2xl text-[14px] leading-6 ink-muted">{description}</p> : null}
          </div>
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

/**
 * A password somebody is setting for somebody else, with the eye to read it
 * back — an administrator opening a store hands the first password over, and
 * one typed blind is one they cannot be sure they are handing over right.
 * `Field` names it like any box: the id and the note go to the input inside.
 */
export function PasswordBox({ value, onChange, id, "aria-describedby": describedBy, "aria-invalid": invalid }: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const { t } = useTranslation();
  const [reveal, setReveal] = useState(false);
  const label = t(reveal ? "auth.hidePassword" : "auth.showPassword");
  return (
    <div className="relative">
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        dir="ltr"
        type={reveal ? "text" : "password"}
        autoComplete="new-password"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        onChange={event => onChange(event.target.value)}
        /* Room for the eye. The box types left to right on either page, so its
           own end is the right; on the Arabic page the eye sits at the page's
           end, the left, and the room goes there (the sign-in form's rule). */
        className={`${fieldClass} pe-12 rtl:pe-3.5 rtl:ps-12`}
      />
      <button
        type="button"
        onClick={() => setReveal(shown => !shown)}
        aria-pressed={reveal}
        aria-label={label}
        title={label}
        className="absolute end-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-[#536b8c] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]"
      >
        {reveal ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
      </button>
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
