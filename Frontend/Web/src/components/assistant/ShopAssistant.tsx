/**
 * The shop assistant's button, on every shopping page, on the owner's word:
 * in the end corner — above the tab bar on a phone, at the foot of the screen
 * on a wide one.
 *
 * **It is liquid glass round a navy mark**, the header's recipe at the search
 * panel's 70% (`.glass-panel`), so it reads as part of the same glass as the
 * bar and the conversation it opens. On a wide screen it carries its name,
 * "Ask NetLet AI", because a round icon in a corner is one people learn to
 * ignore; on a phone it is the mark alone, a thumb's size, and the name is
 * its accessible name and tooltip.
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
 * opened, so closing it and moving to another page loses nothing — and an
 * answer still arriving when it was closed puts the shop's pixel dot on the
 * button when it lands, until the panel is opened again.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { lazyPage } from "@/lib/lazyPage";
import { Sparkles } from "lucide-react";
import { PixelDot } from "@/components/ui/PixelBadge";
import type { ProductBrief } from "@shared/commerce/assistant";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";

const ShopChatPanel = lazyPage(async () => ({ default: (await import("@/components/assistant/ShopChatPanel")).ShopChatPanel }));

export function ShopAssistant({ product, department }: {
  product: { brief: ProductBrief; image: string | null } | null;
  department: string | null;
}) {
  const { t } = useTranslation();
  const available = trpc.ai.available.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [unread, setUnread] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  /*
   * Closing hands focus back to the button, once it is drawn again — it is
   * out of the page while the panel is open (merely invisible, its blur went
   * on drawing a ghost of the pill under the panel), and a phone never
   * focused it when it was tapped, so the overlay's own record of the opener
   * is the page itself.
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
        onPointerEnter={() => void ShopChatPanel.preload()}
        onTouchStart={() => void ShopChatPanel.preload()}
        onFocus={() => void ShopChatPanel.preload()}
        onClick={() => { setStarted(true); setOpen(true); setUnread(false); }}
        aria-label={unread ? `${t("shopChat.launch")} · ${t("shopChat.unread")}` : t("shopChat.launch")}
        title={t("shopChat.launch")}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`assistant-launcher glass-panel fixed end-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] z-30 items-center gap-2.5 rounded-full border border-white/70 p-1.5 shadow-[0_10px_30px_rgba(10,40,90,.22)] hover:shadow-[0_14px_36px_rgba(10,40,90,.3)] lg:bottom-6 lg:end-6 lg:pe-5 print:hidden ${open ? "hidden" : "flex"}`}
      >
        <span aria-hidden className="glass-bar-surface glass-bar-round">
          <span className="glass-bar-bend" />
          <span className="glass-bar-face" />
        </span>
        <span aria-hidden className="relative grid size-10 place-items-center rounded-full bg-[#0a285a] text-white lg:size-11">
          <Sparkles className="size-5" />
          {unread ? <PixelDot className="absolute -end-0.5 -top-0.5" /> : null}
        </span>
        <span aria-hidden className="hidden text-[15px] font-bold text-[#0a285a] lg:inline">{t("shopChat.launch")}</span>
      </button>
      {started ? (
        <Suspense fallback={null}>
          <ShopChatPanel
            open={open}
            onClose={back => { refocus.current = back; setOpen(false); }}
            onAnswered={() => setUnread(true)}
            product={product}
            department={department}
          />
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
