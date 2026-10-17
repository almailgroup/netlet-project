/**
 * The shop assistant's button, on every shopping page, on the owner's word:
 * round and navy in the end corner — above the tab bar on a phone, at the
 * foot of the screen on a wide one.
 *
 * **It is absent until the server says the assistant is there** (`ai.available`,
 * the gateway set up and the `ai` and `assistant` switches on), the rule every
 * optional service here follows: a chat button that can only apologise is
 * worse than none.
 *
 * **On a phone it steps aside for the page's own floating control** — the
 * product page's buy bar, the cart's Checkout, a department's corner Filters
 * — which say so with `useFloatingBar`; `.assistant-launcher` in index.css
 * fades it out while they show. The thing a page is for wins the corner.
 *
 * Only the button comes with the page. The conversation (`ShopChatPanel`) is
 * fetched when a pointer or a finger reaches the button, and kept once
 * opened, so closing it and moving to another page loses nothing.
 */
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import type { ProductBrief } from "@shared/commerce/assistant";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";

const loadPanel = () => import("@/components/assistant/ShopChatPanel");
const ShopChatPanel = lazy(() => loadPanel().then(module => ({ default: module.ShopChatPanel })));

export function ShopAssistant({ product }: { product: ProductBrief | null }) {
  const { t } = useTranslation();
  const available = trpc.ai.available.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  /*
   * Closing hands focus back to the button, once it is drawn again — it is
   * hidden while the panel is open, and a phone never focused it when it was
   * tapped, so the overlay's own record of the opener is the page itself.
   */
  const refocus = useRef(false);
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [open]);

  if (!available.data?.chat) return null;

  return (
    <>
      <button
        ref={button}
        type="button"
        onPointerEnter={() => void loadPanel()}
        onTouchStart={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        onClick={() => { setStarted(true); setOpen(true); }}
        aria-label={t("shopChat.open")}
        title={t("shopChat.open")}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`assistant-launcher glass glass-navy fixed end-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 grid size-13 place-items-center rounded-full shadow-[0_10px_30px_rgba(10,40,90,.25)] lg:bottom-6 lg:end-6 lg:size-14 print:hidden ${open ? "invisible" : ""}`}
      >
        <MessageCircle className="size-6" aria-hidden />
      </button>
      {started ? (
        <Suspense fallback={null}>
          <ShopChatPanel open={open} onClose={back => { refocus.current = back; setOpen(false); }} product={product} />
        </Suspense>
      ) : null}
    </>
  );
}

/** Whether the button is drawn, for the footer's room under it. */
export function useAssistantShown(): boolean {
  const available = trpc.ai.available.useQuery(undefined, { staleTime: 5 * 60_000 });
  return Boolean(available.data?.chat);
}
