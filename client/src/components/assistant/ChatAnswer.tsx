/**
 * One answer from the shop assistant, drawn the same way wherever it appears —
 * the chat, "Ask about this product" and the help page's box.
 *
 * Its words keep their own direction (`dir="auto"`), so an English answer on
 * the Arabic page reads left to right. A search the model offered
 * (`[[search: …]]`, read by `chatPieces`) is a link to NetLet's own results
 * page, so what is for sale is the shop's answer, never the model's. While
 * the answer is still arriving a marker half written is held back, and a
 * caret says more is coming. Every answer ends on the line saying it came
 * from a model — on the answer rather than once at the top, because a shopper
 * scrolling a conversation reads the sentence, not the header.
 */
import { Search } from "lucide-react";
import { Link } from "wouter";
import { chatPieces } from "@shared/ai/chatText";
import { searchPath } from "@shared/commerce/browse";
import { descriptionBlocks } from "@shared/commerce/productDetail";
import type { ChatMessage } from "@/hooks/useAIChat";
import { useTranslation } from "@/hooks/useTranslation";

export function ChatAnswer({ message, onSearch, note = "assistant.generated" }: {
  message: ChatMessage;
  /** Called as a search link is followed — the chat closes itself, say. */
  onSearch?: () => void;
  note?: "assistant.generated" | "help.askAnswerNote" | "shopChat.generated";
}) {
  const { t } = useTranslation();
  const streaming = message.state === "streaming";
  const pieces = chatPieces(message.text, { streaming });
  const searches = pieces.filter(piece => piece.kind === "search");
  return (
    <div className="w-fit max-w-[92%] rounded-2xl border border-[#d5dfeb] bg-white px-3.5 py-2.5">
      <div dir="auto" className="space-y-2 text-[14px] leading-6 text-[#2b3242]">
        {pieces.flatMap((piece, index) => piece.kind === "text"
          /* Paragraphs, and "- " lines as a list: what the gateway asks the model to write. */
          ? descriptionBlocks(piece.text).map((block, at) => block.kind === "paragraph"
            ? <p key={`${index}-${at}`} className="whitespace-pre-line">{block.text}</p>
            : (
              <ul key={`${index}-${at}`} className="list-disc space-y-1 ps-5 marker:text-[#0a285a]/50">
                {block.items.map((item, line) => <li key={line}>{item.label ? <><b className="font-bold">{item.label}:</b> {item.text}</> : item.text}</li>)}
              </ul>
            ))
          : [])}
      </div>
      {streaming ? <span aria-hidden className="ms-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-[#0a285a]/50" /> : null}
      {searches.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-2" aria-label={t("assistant.searchesLabel")}>
          {searches.map(piece => piece.kind === "search" ? (
            <li key={piece.term}>
              <Link
                href={searchPath(piece.term)}
                onClick={onSearch}
                className="tint-on-hover inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[#0a285a]/15 bg-[#f4f7fb] px-3.5 py-1.5 text-[13px] font-bold text-[#0a285a] pointer-fine:min-h-8"
              >
                <Search className="size-3.5 shrink-0" aria-hidden />
                <bdi dir="auto">{piece.term}</bdi>
              </Link>
            </li>
          ) : null)}
        </ul>
      ) : null}
      {message.state === "blocked" ? <p className="mt-1.5 text-[12px] font-semibold text-[#8c2f22]">{t("assistant.blocked")}</p> : null}
      {message.state === "stopped" ? <p className="mt-1.5 text-[12px] font-semibold ink-muted">{t("assistant.stopped")}</p> : null}
      {streaming ? null : <p className="mt-1.5 text-[12px] font-bold ink-muted">{t(note)}</p>}
    </div>
  );
}
