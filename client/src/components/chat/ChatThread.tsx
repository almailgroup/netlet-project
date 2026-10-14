/**
 * One conversation, read from either side.
 *
 * Mine on the trailing edge and theirs on the leading one, which mirrors in
 * Arabic by construction (`justify-end`, `ms-`/`me-`). Each message says what
 * it was about when it was about something — the product, the order — because
 * "is it in stock?" six messages after "about the lamp" is otherwise a puzzle.
 *
 * A real list with each message's sender spelled out for a screen reader: a
 * column of bubbles told apart by colour and side alone says nothing to
 * somebody who cannot see either.
 */
import { SHOP_TIME_ZONE } from "@/hooks/useDateFormat";
import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useTranslation } from "@/hooks/useTranslation";

export type ThreadMessage = {
  id: number;
  side: string;
  body: string;
  createdAt: Date | string;
  productId: number | null;
  productTitle: string | null;
  orderReference: string | null;
};

export function ChatThread({
  messages,
  mySide,
  theirName,
  productHref,
}: {
  messages: ThreadMessage[];
  mySide: "shopper" | "seller";
  theirName: string;
  /** Where a product mentioned in the thread can be opened, when this side may. */
  productHref?: (message: ThreadMessage) => string | null;
}) {
  const { t, isArabic } = useTranslation();
  /* A chat needs the time as well as the day; Latin digits in Arabic, as the
     rest of the site prints them. */
  const stamp = (value: Date | string) =>
    new Date(value).toLocaleString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: SHOP_TIME_ZONE,
    });
  const box = useRef<HTMLOListElement>(null);

  /* The newest message is the one being read; land on it by scrolling the
     thread's own box. `scrollIntoView` was the first version, and it scrolls
     every scrollable ancestor too — so opening a conversation jumped the whole
     account page to wherever the box happened to end. */
  useEffect(() => {
    const list = box.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  return (
    <ol ref={box} tabIndex={0} className="max-h-[420px] space-y-3 overflow-y-auto rounded-2xl bg-[#f7f8fb] p-3" aria-label={t("chat.threadWith", { name: theirName })}>
      {messages.map(message => {
        const mine = message.side === mySide;
        const href = productHref?.(message) ?? null;
        return (
          <li key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${mine ? "bg-[#0a285a] text-white" : "border border-[#e6e9ef] bg-white text-[#0a285a]"}`}>
              <p className="sr-only">{mine ? t("chat.you") : theirName}:</p>
              {message.productTitle || message.orderReference ? (
                <p className={`mb-1 text-[12px] font-extrabold ${mine ? "text-[#c9d6ea]" : "ink-muted"}`}>
                  {message.productTitle ? (
                    href ? <Link href={href} className="underline" dir="auto">{t("chat.about", { subject: message.productTitle })}</Link>
                      : <span dir="auto">{t("chat.about", { subject: message.productTitle })}</span>
                  ) : (
                    <span>{t("chat.aboutOrder")} <bdi dir="ltr">{message.orderReference}</bdi></span>
                  )}
                </p>
              ) : null}
              <p dir="auto" className="text-sm leading-6 whitespace-pre-line [overflow-wrap:anywhere]">{message.body}</p>
              <p className={`mt-1 text-[11px] ${mine ? "text-[#c9d6ea]" : "ink-muted"}`}>{stamp(message.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
