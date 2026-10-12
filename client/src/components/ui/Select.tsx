/**
 * The shop's dropdown: one designed menu in place of the browser's own.
 *
 * Every `<select>` on the site opened the operating system's list — grey,
 * square, in the system font, a different thing on every browser — under
 * fields that were otherwise NetLet's own. This draws the list itself, the
 * same everywhere: a white sheet with a light rim and a soft shadow, rows a
 * thumb can hit, a tint under the pointer and a navy tick beside the choice.
 *
 * **It is used the way the element it replaces is used**, so swapping one in
 * changes the tag and nothing else: `<option>` children (a disabled one with
 * an empty value is the placeholder), `value` as a string or a number, and
 * `onChange` handed `{ target: { value } }`. Forty-nine selects moved across
 * without one handler rewritten, which is the argument for the shape.
 *
 * **It behaves like the WAI-ARIA select-only combobox.** Focus never leaves
 * the button; the open list is pointed at with `aria-activedescendant`, so a
 * screen reader hears each row as the arrows reach it. Arrows, Home and End,
 * Page Up and Down move; Enter or Space chooses; Escape closes without
 * changing anything (and without closing the dialog the field sits in); Tab
 * closes and moves on; typing letters jumps to the first row that starts with
 * them. Opening never changes the value — several of these save the moment
 * they change, and a keyboard passing through must not save on the way past.
 *
 * **The list is portalled and fixed against the button**: a select sits
 * inside cards, tables and dialogs that clip their overflow, and a list cut
 * off by its own card is worse than the grey one. It opens below, or above
 * when there is more room there, starts on the button's inline-start edge in
 * either language, and follows the button while the page scrolls.
 *
 * It is portalled into the nearest dialog or landmark rather than `<body>`. A
 * list outside an `aria-modal` dialog is outside what a screen reader reads
 * while the dialog is open, so the row the arrows reach was never announced;
 * and one outside every landmark is content no landmark holds. Fixed
 * positioning resolves against a transformed or contained ancestor rather
 * than the window, so `fixedOrigin` finds one if the target sits inside it.
 */
import { Check, ChevronDown } from "lucide-react";
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };
type Choice = { value: string; label: ReactNode; text: string; disabled: boolean };

/** The words of a label, for typing to jump to it. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** `<option>` children, through any fragments and arrays a `.map` makes. */
function choicesOf(children: ReactNode): Choice[] {
  const out: Choice[] = [];
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      out.push(...choicesOf((child as ReactElement<{ children?: ReactNode }>).props.children));
      return;
    }
    const props = (child as ReactElement<OptionProps>).props;
    const value = props.value === undefined ? textOf(props.children) : String(props.value);
    out.push({ value, label: props.children, text: textOf(props.children).trim(), disabled: Boolean(props.disabled) });
  });
  return out;
}

const TYPEAHEAD_MS = 600;

/** Where the open list goes: the dialog the field is in, else its landmark. */
const PORTAL_HOME = '[role="dialog"], [role="alertdialog"], dialog, header, main, footer, nav, aside';

/**
 * The box `position: fixed` measures from. The window, unless an ancestor
 * makes itself the containing block — a transform, a filter, containment or a
 * size container all do — in which case it is that ancestor's padding box.
 */
function fixedOrigin(from: Element) {
  for (let el: Element | null = from; el && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    const contains =
      style.transform !== "none" ||
      style.filter !== "none" ||
      style.perspective !== "none" ||
      (style.backdropFilter ?? "none") !== "none" ||
      /layout|paint|strict|content/.test(style.contain) ||
      /transform|filter|perspective/.test(style.willChange) ||
      (style.containerType ?? "normal") !== "normal";
    if (contains) {
      const rect = el.getBoundingClientRect();
      return { left: rect.left + el.clientLeft, top: rect.top + el.clientTop, width: el.clientWidth, height: el.clientHeight };
    }
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}
const BASE_TRIGGER = "h-11 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[14px] text-[#0a285a]";

export function Select({
  value,
  onChange,
  children,
  className = BASE_TRIGGER,
  disabled = false,
  id,
  title,
  onBlur,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: {
  value: string | number | null | undefined;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  /** The closed field's look; the list's look is the shop's own. */
  className?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  onBlur?: (event: FocusEvent<HTMLButtonElement>) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const generated = useId();
  const buttonId = id ?? `${generated}-select`;
  const listId = `${generated}-list`;
  const optionId = (index: number) => `${generated}-opt-${index}`;

  const choices = useMemo(() => choicesOf(children), [children]);
  /* A disabled option with no value is the native placeholder: it names the
     empty field and is never offered as a row. */
  const placeholder = choices.find(choice => choice.value === "" && choice.disabled);
  const rows = useMemo(() => choices.filter(choice => !(choice.value === "" && choice.disabled)), [choices]);
  const current = String(value ?? "");
  const selectedIndex = rows.findIndex(row => row.value === current);
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : undefined;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const enabled = useCallback((index: number) => index >= 0 && index < rows.length && !rows[index].disabled, [rows]);
  const step = useCallback((from: number, by: number) => {
    if (rows.length === 0) return -1;
    let index = from;
    for (let moved = 0; moved < rows.length; moved++) {
      index = Math.min(rows.length - 1, Math.max(0, index + by));
      if (enabled(index)) return index;
      if (index === 0 || index === rows.length - 1) break;
    }
    return enabled(from) ? from : -1;
  }, [enabled, rows.length]);
  const first = useCallback(() => step(-1, 1), [step]);
  const last = useCallback(() => step(rows.length, -1), [rows.length, step]);

  const [home, setHome] = useState<Element | null>(null);

  const measure = useCallback(() => {
    const target = button.current;
    if (!target) return;
    const portal = target.closest(PORTAL_HOME) ?? document.body;
    setHome(portal);
    const origin = fixedOrigin(portal);
    const rect = target.getBoundingClientRect();
    const gap = 6;
    const edge = 8;
    const below = window.innerHeight - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const up = below < 220 && above > below;
    const rtl = getComputedStyle(target).direction === "rtl";
    const room = rtl ? rect.right - edge : window.innerWidth - rect.left - edge;
    setPlace({
      position: "fixed",
      ...(up ? { bottom: origin.top + origin.height - rect.top + gap } : { top: rect.bottom + gap - origin.top }),
      ...(rtl ? { right: origin.left + origin.width - rect.right } : { left: rect.left - origin.left }),
      minWidth: Math.min(rect.width, room),
      maxWidth: room,
      maxHeight: Math.max(120, Math.min(320, up ? above : below)),
      transformOrigin: up ? "bottom" : "top",
    });
  }, []);

  const show = (at: number) => {
    if (disabled || rows.length === 0) return;
    measure();
    setActive(at >= 0 ? at : first());
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    typed.current = { text: "", at: 0 };
  };
  const choose = (index: number) => {
    if (!enabled(index)) return;
    hide();
    if (rows[index].value !== current) onChange({ target: { value: rows[index].value } });
  };

  /* Follow the button while the page or a panel scrolls, and close on a press
     anywhere that is neither the button nor the list. */
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !list.current?.contains(target)) hide();
    };
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  /* Letters typed within a moment of each other are one word, matched from the
     row after the one the arrows are on, so "S" pressed twice walks through
     every row that starts with S. */
  const typeahead = (key: string) => {
    const now = Date.now();
    const fresh = now - typed.current.at > TYPEAHEAD_MS;
    const text = (fresh ? "" : typed.current.text) + key.toLocaleLowerCase();
    typed.current = { text, at: now };
    const start = open ? active : selectedIndex;
    const from = Math.max(start, -1) + (text.length === 1 ? 1 : 0);
    const order = rows.map((_, index) => (((from + index) % rows.length) + rows.length) % rows.length);
    const hit = order.find(index => enabled(index) && rows[index].text.toLocaleLowerCase().startsWith(text));
    if (hit === undefined) return;
    if (open) setActive(hit);
    else show(hit);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!open) show(selectedIndex >= 0 ? selectedIndex : key === "ArrowUp" ? last() : first());
      else setActive(step(active, key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (key === "Home" || key === "End") {
      if (!open) return;
      event.preventDefault();
      setActive(key === "Home" ? first() : last());
      return;
    }
    if (key === "PageDown" || key === "PageUp") {
      if (!open) return;
      event.preventDefault();
      setActive(step(active, key === "PageDown" ? 10 : -10));
      return;
    }
    if (key === "Escape") {
      if (!open) return;
      /* The list closes; a dialog around it does not. */
      event.preventDefault();
      event.stopPropagation();
      hide();
      return;
    }
    if (key === "Tab") {
      if (open) hide();
      return;
    }
    if (key === "Enter" || (key === " " && !(open && typed.current.text && Date.now() - typed.current.at < TYPEAHEAD_MS))) {
      event.preventDefault();
      if (open) choose(active);
      else show(selectedIndex);
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      typeahead(key);
    }
  };

  const shown = selected ?? (placeholder ? undefined : rows[0]);
  const muted = !selected;

  return (
    <>
      <button
        ref={button}
        id={buttonId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        title={title}
        disabled={disabled}
        onClick={() => (open ? hide() : show(selectedIndex))}
        onKeyDown={onKeyDown}
        onBlur={event => {
          hide();
          onBlur?.(event);
        }}
        /* The header's hover, as the solid fill a white field takes; a caller
           that drew its own hover keeps it. */
        className={`${className} ${className.includes("hover:bg-") ? "" : "enabled:hover:bg-[#f0f2f5]"} inline-flex min-w-0 cursor-pointer items-center justify-between gap-2 text-start disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={`min-w-0 truncate ${muted ? "ink-muted" : ""}`}>
          {shown ? shown.label : placeholder?.label}
        </span>
        <ChevronDown aria-hidden className={`size-4 shrink-0 opacity-70 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && home
        ? createPortal(
            <ul
              ref={list}
              id={listId}
              role="listbox"
              aria-labelledby={buttonId}
              tabIndex={-1}
              style={place}
              /* The button keeps focus, so a press on a row never blurs it and
                 closes the list before the row is chosen. */
              onMouseDown={event => event.preventDefault()}
              /* Kept to the list: a dialog around the field closes on clicks
                 that reach its backdrop through React's tree. */
              onClick={event => event.stopPropagation()}
              className="select-menu z-[90] overflow-y-auto overscroll-contain rounded-xl border border-[#e1e7ef] bg-white p-1.5 shadow-[0_16px_36px_-12px_rgba(10,40,90,0.28)]"
            >
              {rows.map((row, index) => {
                const isSelected = index === selectedIndex;
                const isActive = index === active;
                return (
                  <li
                    key={`${row.value}-${index}`}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={row.disabled || undefined}
                    onPointerMove={() => { if (!row.disabled && active !== index) setActive(index); }}
                    onClick={() => choose(index)}
                    className={`flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] leading-5 ${
                      row.disabled
                        ? "cursor-not-allowed ink-muted opacity-60"
                        : `cursor-pointer text-[#0a285a] ${isActive ? "bg-[#0a285a]/[.06]" : ""}`
                    } ${isSelected ? "font-semibold" : ""}`}
                  >
                    <span className="min-w-0 flex-1">{row.label}</span>
                    <Check aria-hidden className={`size-4 shrink-0 text-[#0a285a] ${isSelected ? "" : "invisible"}`} />
                  </li>
                );
              })}
            </ul>,
            home,
          )
        : null}
    </>
  );
}
