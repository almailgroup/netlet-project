/**
 * A discount code on one product at checkout (migration 0074), on the owner's
 * word: "an Apply discount code option for each product … the discount
 * applies only to that product". It sits under the product's line and is
 * three states:
 *
 * - **Nothing applied**: "Apply discount code", which opens a box with Apply
 *   and Cancel. The code is asked about on the press, never per keystroke,
 *   since a guess counts against the address's ceiling.
 * - **Applied**: the code and what it takes off this product, with Remove.
 *   The line's price beside it is the price after the code.
 * - **No longer applies** (the quantity fell below its minimum, it expired,
 *   the store's permit lapsed): the code and why, with Remove — and Place
 *   order waits until it goes (`checkout.codeProblem`).
 *
 * A refusal is said under the box and leaves the line's earlier code on it.
 * A line in a set takes none, since its price is already the set's, and a
 * line the bag has drawn before the server answered for it waits for its id.
 */
import { useCart } from "@/contexts/CartContext";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { pressHaptic, refusedHaptic } from "@/lib/haptics";
import { isMessageKey } from "@shared/i18n/dictionary";
import { normaliseCode } from "@shared/commerce/vouchers";
import type { CartItem } from "@shared/commerce/types";
import { Check, LoaderCircle, Ticket, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function LineCode({ item, title }: { item: CartItem; title: string }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const { setLineCode } = useCart();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const fieldId = useId();
  const noteId = useId();
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const remover = useRef<HTMLButtonElement>(null);
  /* Where focus goes once the bag answers: the box's work is done. */
  const focusNext = useRef<"opener" | "remover" | null>(null);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  useEffect(() => {
    if (focusNext.current === "remover") remover.current?.focus();
    if (focusNext.current === "opener") opener.current?.focus();
    focusNext.current = null;
  });

  if (item.bundleName || item.lineId.startsWith("pending:")) return null;

  const apply = async () => {
    const typed = draft.trim();
    if (busy) return;
    if (!typed) {
      setRefusal("checkout.lineCodeEmpty");
      field.current?.focus();
      return;
    }
    pressHaptic();
    setBusy(true);
    setRefusal(null);
    try {
      const reason = await setLineCode(item.lineId, typed);
      if (reason) {
        refusedHaptic();
        setRefusal(reason);
        field.current?.focus();
        return;
      }
      setOpen(false);
      setDraft("");
      focusNext.current = "remover";
    } catch (error) {
      refusedHaptic();
      setRefusal(error instanceof Error ? error.message : "cart.updateFailed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    pressHaptic();
    setBusy(true);
    try {
      await setLineCode(item.lineId, null);
      focusNext.current = "opener";
    } catch {
      refusedHaptic();
    } finally {
      setBusy(false);
    }
  };

  const say = (key: string) => (isMessageKey(key) ? t(key) : tError(key));
  const held = item.code ?? null;
  const problem = item.codeProblem ?? null;

  if (held || problem) {
    const code = held?.code ?? problem!.code;
    return (
      <div className={`mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 ${problem ? "border-[#f0c8c2] bg-[#fdf1ef]" : "border-[#cfe3cf] bg-[#f1f8f1]"}`}>
        {problem ? <X className="mt-0.5 size-4 shrink-0 text-[#8c2f22]" aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-[#2f5d33]" aria-hidden />}
        <p className="min-w-0 flex-1 text-[13px] leading-5">
          <bdi dir="ltr" className="font-extrabold text-[#0a285a]">{code}</bdi>
          <span className={`block font-semibold ${problem ? "text-[#8c2f22]" : "text-[#2f5d33]"}`}>
            {problem ? say(problem.reason) : t("checkout.lineCodeOff", { amount: money(held!.amount) })}
          </span>
        </p>
        <button
          ref={remover}
          type="button"
          onClick={remove}
          disabled={busy}
          aria-label={t("checkout.lineCodeRemoveName", { code })}
          className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-2 text-[13px] font-bold text-[#0a285a] underline-offset-2 hover:underline disabled:opacity-55"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : t("checkout.lineCodeRemove")}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        ref={opener}
        type="button"
        onClick={() => { pressHaptic(); setOpen(true); setRefusal(null); }}
        className="mt-1.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 -ms-1 text-[13px] font-bold ink-accent underline-offset-2 hover:underline"
      >
        <Ticket className="size-4 shrink-0" aria-hidden />
        {t("checkout.lineCodeAdd")}
      </button>
    );
  }

  return (
    <form
      className="mt-2"
      onSubmit={event => { event.preventDefault(); void apply(); }}
    >
      <label htmlFor={fieldId} className="sr-only">{t("checkout.lineCodeLabel", { title })}</label>
      <div className="flex items-center gap-2">
        <input
          ref={field}
          id={fieldId}
          value={draft}
          onChange={event => { setDraft(event.target.value); if (refusal) setRefusal(null); }}
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); setRefusal(null); focusNext.current = "opener"; } }}
          dir="ltr"
          maxLength={40}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={refusal ? true : undefined}
          aria-describedby={refusal ? noteId : undefined}
          placeholder={t("checkout.lineCodeAdd")}
          className="h-10 min-w-0 flex-1 rounded-xl border border-[#d5dfeb] bg-white px-3 font-mono text-[15px] uppercase outline-none transition-shadow placeholder:font-sans placeholder:normal-case focus:border-[#0a285a] focus:shadow-[0_0_0_3px_rgba(10,40,90,.12)]"
        />
        <button type="submit" disabled={busy} className="glass glass-navy inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-bold disabled:opacity-55">
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t("checkout.lineCodeApply")}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setRefusal(null); setDraft(""); focusNext.current = "opener"; }}
          aria-label={t("checkout.lineCodeCancel")}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-[#536b8c]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {refusal ? (
        <p id={noteId} role="alert" className="mt-1.5 text-[13px] font-semibold leading-5 text-[#8c2f22]">
          {say(refusal)}
          {draft.trim() && refusal !== "checkout.lineCodeEmpty" ? <> <bdi dir="ltr" className="font-mono">({normaliseCode(draft) || draft})</bdi></> : null}
        </p>
      ) : null}
    </form>
  );
}
