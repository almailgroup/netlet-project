/**
 * Writing a message, with the contact filter running as you type (3.8).
 *
 * `contactFindings` is the same function the server refuses with, so the box
 * says what is wrong *before* the press rather than after a round trip — and
 * the send button cannot submit what the API would bounce. It names which kind
 * it found ("a phone number"), never echoes the match back: repeating the
 * number in a warning is one more place it is on screen.
 */
import { useId, useState } from "react";
import { LoaderCircle, SendHorizontal, ShieldAlert } from "lucide-react";
import { contactFindings, MAX_MESSAGE_LENGTH, type ContactKind } from "@shared/commerce/contactFilter";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useTranslation } from "@/hooks/useTranslation";

const KIND_LABEL: Record<ContactKind, MessageKey> = {
  phone: "chat.foundPhone",
  email: "chat.foundEmail",
  link: "chat.foundLink",
  handle: "chat.foundHandle",
};

/* A fine pointer that can hover is a desk with a keyboard; a coarse one is a
   phone. Asked at the keystroke, so a tablet that gains a keyboard is right. */
const hasKeyboard = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export function ChatComposer({
  onSend,
  pending,
  label,
  placeholder,
}: {
  /** Resolves true when the message went, so the box empties only then. */
  onSend: (body: string) => Promise<boolean>;
  pending: boolean;
  label: string;
  placeholder?: string;
}) {
  const { t, isArabic } = useTranslation();
  const [body, setBody] = useState("");
  const warningId = useId();
  const found = body.trim() ? contactFindings(body) : [];
  const blocked = found.length > 0;

  const submit = async () => {
    if (!body.trim() || blocked || pending) return;
    if (await onSend(body)) setBody("");
  };

  return (
    <form
      onSubmit={event => { event.preventDefault(); void submit(); }}
      className="mt-3"
    >
      <label className="block">
        <span className="sr-only">{label}</span>
        <textarea
          value={body}
          onChange={event => setBody(event.target.value)}
          onKeyDown={event => {
            /* Enter sends and Shift+Enter breaks a line — on a keyboard. A
               phone has no Shift, so there Enter must stay a line break and the
               button sends; otherwise a shopper on a phone can never write a
               second line, and a stray Enter posts half a sentence. */
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && hasKeyboard()) {
              event.preventDefault();
              void submit();
            }
          }}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={2}
          dir="auto"
          placeholder={placeholder ?? label}
          aria-invalid={blocked}
          aria-describedby={warningId}
          className="glass-field w-full resize-y rounded-2xl px-4 py-3 text-sm"
        />
      </label>

      {/* Polite, so a screen reader hears it after the keystroke rather than
          interrupting one. */}
      <div id={warningId} aria-live="polite" className="min-h-0">
        {blocked ? (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-[#fdeceb] px-3 py-2 text-[12px] leading-5 font-semibold text-[#8c2f22]">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {t("chat.offPlatformLive", {
                /* "the phone number and the link", in each language's own
                   grammar for a list — a comma alone reads as a typo. */
                found: new Intl.ListFormat(isArabic ? "ar" : "en", { type: "conjunction" }).format(found.map(kind => t(KIND_LABEL[kind]))),
              })}
            </span>
          </p>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[12px] ink-muted">{t("chat.keepOnNetLet")}</p>
        <button
          type="submit"
          disabled={!body.trim() || blocked || pending}
          className="glass-navy type-control pressable inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <SendHorizontal className="size-4 rtl:-scale-x-100" aria-hidden />}
          {t("chat.send")}
        </button>
      </div>
    </form>
  );
}
