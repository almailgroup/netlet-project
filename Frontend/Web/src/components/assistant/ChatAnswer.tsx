/**
 * One answer from the shop's assistant, as every conversation draws it — the
 * shop assistant, a product's "Ask about this product", the help page.
 *
 * The words are paragraphs and "- " lists, the Markdown the product page
 * draws (`descriptionBlocks`). **A search the model suggests (`[[search: …]]`,
 * read by `chatPieces`) becomes NetLet's own shelf for those words**: the
 * first few products the shop's search finds, each a link to its page, with
 * "See all" to the results. The model never names a product or a price; the
 * search does, from what is actually on sale, at what it actually costs. A
 * shelf is fetched once the answer is whole, not while it is still arriving.
 *
 * **A product on a shelf can go in the bag from there**, when there is
 * nothing to choose: one variant, in stock, added once a press, the count on
 * the disc as the receipt (the card's own rule — no toast, a polite live
 * region). A product with sizes or colours opens its page instead, because a
 * size has to be chosen before "add" means anything.
 *
 * The questions it offers next (`[[ask: …]]`) are not drawn here: a chat
 * draws them as the row above its box (`ChatSuggestions`, `nextQuestions`),
 * for the latest answer only. Drawn under the answer, inside the log, they
 * arrived after the log had scrolled and were cut off at its foot.
 *
 * Every answer carries the line saying a model wrote it, and a finished one a
 * Copy — somebody sending "what do I need for a car seat" to their partner
 * should not have to select a chat bubble on a phone.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, ImageOff, Plus, Search } from "lucide-react";
import { Link } from "wouter";
import { Thumb } from "@/components/product/Thumb";
import { useCart } from "@/contexts/CartContext";
import { chatPieces } from "@shared/ai/chatText";
import { searchPath } from "@shared/commerce/browse";
import { descriptionBlocks } from "@shared/commerce/productDetail";
import type { Product } from "@shared/commerce/types";
import type { ChatMessage } from "@/hooks/useAIChat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

/** How many of a search's products a shelf shows; "See all" is the rest. */
const SHELF = 4;

export function ChatAnswer({ message, onNavigate, note = "assistant.generated" }: {
  message: ChatMessage;
  /** Called as a link out of the answer is followed — the chat closes itself on a phone, say. */
  onNavigate?: () => void;
  note?: "assistant.generated" | "help.askAnswerNote" | "shopChat.generated";
}) {
  const { t } = useTranslation();
  const streaming = message.state === "streaming";
  const pieces = chatPieces(message.text, { streaming });
  const searches = pieces.flatMap(piece => (piece.kind === "search" ? [piece.term] : []));
  const words = pieces.flatMap(piece => (piece.kind === "text" ? [piece.text.trim()] : [])).filter(Boolean).join("\n\n");
  return (
    <div className="min-w-0 max-w-full rounded-[20px] rounded-ss-md bg-white px-4 py-3 shadow-[0_1px_2px_rgba(10,40,90,.06),0_6px_18px_rgba(10,40,90,.06)] ring-1 ring-[#0a285a]/[.07]">
      <div dir="auto" className="space-y-2 text-[14px] leading-6 text-[#1f2733]">
        {descriptionBlocks(words).map((block, at) => block.kind === "paragraph"
          ? <p key={at} className="whitespace-pre-line">{block.text}</p>
          : (
            /* Paragraphs, and "- " lines as a list: what the gateway asks the model to write. */
            <ul key={at} className="list-disc space-y-1 ps-5 marker:text-[#0a285a]/50">
              {block.items.map((item, line) => <li key={line}>{item.label ? <><b className="font-bold">{item.label}:</b> {item.text}</> : item.text}</li>)}
            </ul>
          ))}
        {streaming ? <span aria-hidden className="ms-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-[#0a285a]/50" /> : null}
      </div>
      {searches.length && !streaming ? (
        <ul className="mt-3 space-y-3" aria-label={t("assistant.searchesLabel")}>
          {searches.map(term => <li key={term}><SearchShelf term={term} onNavigate={onNavigate} /></li>)}
        </ul>
      ) : null}
      {message.state === "blocked" ? <p className="mt-2 text-[12px] font-semibold text-[#8c2f22]">{t("assistant.blocked")}</p> : null}
      {message.state === "stopped" ? <p className="mt-2 text-[12px] font-semibold ink-muted">{t("assistant.stopped")}</p> : null}
      {streaming ? null : (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold ink-muted">{t(note)}</p>
          {words ? <CopyButton text={words} /> : null}
        </div>
      )}
    </div>
  );
}

/**
 * The shop's own answer to a search the model suggested: the first products
 * NetLet's search finds for those words, in the page's language. While it is
 * asked the row holds its height, and with nothing found it is the search
 * alone, a link like any other.
 */
function SearchShelf({ term, onNavigate }: { term: string; onNavigate?: () => void }) {
  const { t, locale } = useTranslation();
  const money = useMoney();
  const found = trpc.search.products.useQuery({ q: term, locale, limit: SHELF }, { staleTime: 5 * 60_000 });
  const products = found.data?.products ?? [];
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={searchPath(term)}
          onClick={onNavigate}
          className="inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-full bg-[#eef2f8] px-3 text-[13px] font-bold text-[#0a285a] tint-on-hover pointer-fine:min-h-8"
        >
          <Search className="size-3.5 shrink-0" aria-hidden />
          <bdi dir="auto" className="truncate">{term}</bdi>
        </Link>
        {products.length ? (
          <Link href={searchPath(term)} onClick={onNavigate} className="shrink-0 text-[13px] font-bold ink-accent">
            {t("shopChat.seeAll")}
          </Link>
        ) : null}
      </div>
      {found.isLoading ? (
        <div aria-hidden className="mt-2 flex gap-2 overflow-hidden">
          {[0, 1, 2].map(slot => <span key={slot} className="h-[186px] w-[136px] shrink-0 animate-pulse rounded-2xl bg-[#eef2f8]" />)}
        </div>
      ) : products.length ? (
        <ul className="-mx-1 mt-2 flex snap-x gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 [scrollbar-width:thin]">
          {products.map(product => (
            <li key={product.id} className="relative w-[136px] shrink-0 snap-start">
              <Link
                href={`/products/${product.handle}`}
                onClick={onNavigate}
                className="block h-full overflow-hidden rounded-2xl bg-white ring-1 ring-[#0a285a]/10 transition-shadow hover:shadow-[0_6px_16px_rgba(10,40,90,.12)]"
              >
                <span className="block aspect-square bg-[#f4f6f9]">
                  <Thumb
                    src={product.images[0]?.url}
                    alt={product.images[0]?.altText || product.title}
                    className="size-full object-cover"
                    icon={<ImageOff className="size-5 text-[#536b8c]" />}
                  />
                </span>
                <span className="block p-2">
                  <span dir="auto" className="line-clamp-2 text-[12px] leading-4 font-semibold text-[#1f2733]">{product.title}</span>
                  <span className="mt-1 block text-[13px] font-bold text-[#0a285a]">{money(product.priceRange.min)}</span>
                </span>
              </Link>
              <ShelfAdd product={product} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The shelf card's Add: on the photo's corner, a white disc with a plus, and
 * once the item is in the bag a navy one carrying how many — pressed again,
 * one more. Only for a product with nothing to choose (`CardAction`'s plain
 * line: the variant alone, no extras or bundle), so the count is the line the
 * press changes.
 */
function ShelfAdd({ product }: { product: Product }) {
  const { t } = useTranslation();
  const { cart, addItem } = useCart();
  const [said, setSaid] = useState("");
  const variant = product.variants.length === 1 ? product.variants[0] : null;
  if (!variant?.availableForSale) return null;
  const line = cart?.items.find(item => item.variantId === variant.id && !item.addons?.length && !item.bundleName);
  const name = product.title;
  const label = line
    ? `${t("card.addName", { name })} · ${t("card.inCart", { count: String(line.quantity) })}`
    : t("card.addName", { name });
  return (
    <>
      <button
        type="button"
        /* The disc changes on the press (the bag draws it ahead); a refusal toasts. */
        onClick={() => {
          setSaid(t("cart.added", { name }));
          addItem(variant.id, 1, { reveal: false, product }).catch(() => toast.error(t("cart.addFailed")));
        }}
        aria-label={label}
        title={label}
        className={`tap-target absolute end-1.5 top-1.5 grid size-8 place-items-center rounded-full text-[13px] font-extrabold shadow-[0_2px_8px_rgba(10,40,90,.25)] ${line
          ? "bg-[#0a285a] text-white hover:bg-[#0d3372]"
          : "bg-white text-[#0a285a] ring-1 ring-[#0a285a]/10 hover:bg-[#f0f2f5]"}`}
      >
        {line ? <span aria-hidden>{line.quantity > 99 ? "99+" : line.quantity}</span>
          : <Plus aria-hidden className="size-4" strokeWidth={2.5} />}
      </button>
      <span aria-live="polite" className="sr-only">{said}</span>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined);
      }}
      aria-label={t(copied ? "shopChat.copied" : "shopChat.copy")}
      title={t(copied ? "shopChat.copied" : "shopChat.copy")}
      className="tap-target grid size-7 shrink-0 place-items-center rounded-full text-[#0a285a]/70 hover:text-[#0a285a]"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span aria-live="polite" className="sr-only">{copied ? t("shopChat.copied") : ""}</span>
    </button>
  );
}
