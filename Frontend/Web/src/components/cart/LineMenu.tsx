/**
 * What can be done with one line of the bag, behind its "⋯", on the owner's
 * word: keep it for later, move it to a wishlist, share it, open it, or take
 * it out.
 *
 * **Save for later moves the line out of the bag and into Saved** — the
 * hearts — where the cart page lists it under the bag ("Saved for later",
 * `SavedForLater`) with a way back. It is not a list of its own: Saved is
 * already the place a shopper keeps what they have not decided on, on this
 * device and on the account, and a second such place would be two answers to
 * "where did I put it". **Move to wishlist** asks the heart's own question —
 * a private list or a public one (`chooseWishlist`) — and takes the line out
 * only once it is on one; a guest has no lists, so it is not offered. Both
 * need the line's product (`productId`), which a bag read before it was sent
 * lacks, and then neither is offered.
 *
 * A plain line saved for later can be put straight back (Undo, in the
 * toast); a line carrying extras or priced as part of a set is not, since
 * adding it again would make a different line.
 *
 * Two shapes, one at a time. On a phone it is a sheet from the foot of the
 * screen, naming the product over the actions — the thumb's reach; from `sm`
 * a small menu under the button. Both are the WAI-ARIA menu: focus on the
 * first item as it opens, the arrows and Home/End between items, Escape back
 * to the button, Tab out. The menu is `position: fixed` against the button and
 * portalled into the nearest dialog or landmark, because the store card round
 * the line clips what overflows it.
 */
import { useMemberCode } from "@/hooks/useMemberCode";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { Thumb } from "@/components/product/Thumb";
import { shareProduct } from "@/components/product/ProductCard";
import { useAuth } from "@/hooks/useAuth";
import { useFeature } from "@/hooks/useFeature";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { navigateWhenReady } from "@/lib/readyNavigation";
import { appPath } from "@/lib/basePath";
import type { CartItem } from "@shared/commerce/types";
import { Bookmark, ExternalLink, Gift, MoreHorizontal, Share2, ShoppingBag, Trash2 } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

type Action = { key: string; icon: ReactNode; label: string; run: () => void; danger?: boolean };

export function LineMenu({ item, title }: { item: CartItem; title: string }) {
  const { t } = useTranslation();
  /* A member's Share carries their code, as the product page's does. */
  const memberCode = useMemberCode();
  const { removeItem, addItem, closeCart } = useCart();
  const { savedIds, saveForLater, chooseWishlist, unsave } = useCustomer();
  const { isAuthenticated } = useAuth();
  const wishlistsOn = useFeature("wishlists");
  const wide = useMediaQuery("(min-width: 640px)");
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [place, setPlace] = useState<{ top?: number; bottom?: number; end: number } | null>(null);

  const productId = item.productId;
  const plain = !item.addons?.length && !item.bundleName;
  /* After a line leaves the bag its button is gone, so the keyboard goes to
     the page rather than to `<body>`. */
  const toPage = () => window.setTimeout(() => document.getElementById("main")?.focus({ preventScroll: true }), 0);
  const drop = () => void removeItem(item.lineId).catch(() => undefined);

  const actions: Action[] = [];
  if (productId) {
    actions.push({
      key: "later",
      icon: <Bookmark className="size-[18px]" aria-hidden />,
      label: t("cart.saveForLater"),
      run: () => {
        const wasSaved = savedIds.includes(productId);
        saveForLater(productId);
        drop();
        toPage();
        toast.success(t("cart.savedForLater", { name: title }), plain ? {
          action: {
            label: t("cart.undo"),
            onClick: () => {
              if (!wasSaved) unsave(productId);
              void addItem(item.variantId, item.quantity, { reveal: false }).catch(() => toast.error(t("cart.addFailed")));
            },
          },
        } : undefined);
      },
    });
    if (isAuthenticated && wishlistsOn) {
      actions.push({
        key: "wish",
        icon: <Gift className="size-[18px]" aria-hidden />,
        label: t("cart.moveToWishlist"),
        run: () => chooseWishlist(productId, () => { drop(); toPage(); }),
      });
    }
  }
  actions.push({
    key: "share",
    icon: <Share2 className="size-[18px]" aria-hidden />,
    label: t("cart.shareItem"),
    run: () => void shareProduct({ handle: item.productHandle, title }, t, memberCode),
  });
  actions.push({
    key: "view",
    icon: <ExternalLink className="size-[18px] rtl:-scale-x-100" aria-hidden />,
    label: t("cart.viewProduct"),
    run: () => { closeCart(); navigateWhenReady(appPath(`/products/${encodeURIComponent(item.productHandle)}`)); },
  });
  actions.push({
    key: "remove",
    icon: <Trash2 className="size-[18px]" aria-hidden />,
    label: t("cart.removeFromCart"),
    danger: true,
    run: () => { drop(); toPage(); },
  });

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };
  const choose = (action: Action) => {
    pressHaptic();
    setOpen(false);
    action.run();
  };
  const focusItem = (index: number) => {
    const all = menu.current ? [...menu.current.querySelectorAll<HTMLElement>("[role=menuitem]")] : [];
    all[(index + all.length) % all.length]?.focus();
  };
  const onMenuKey = (event: React.KeyboardEvent) => {
    const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(at + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(at - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusItem(all.length - 1); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "Tab") close(false);
  };

  /* The small menu sits under the button, or over it when the screen has no
     room below, measured as it opens and again as the page moves — it
     follows its button while the button is on screen, and closes once it is
     not. Closing on any scroll shut it under a press made while a smooth
     scroll was still settling. */
  const measure = () => {
    const anchor = button.current;
    if (!anchor) return false;
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    const rtl = getComputedStyle(anchor).direction === "rtl";
    const end = rtl ? rect.left : window.innerWidth - rect.right;
    const roomBelow = window.innerHeight - rect.bottom;
    setPlace(roomBelow > 300 ? { top: rect.bottom + 6, end } : { bottom: window.innerHeight - rect.top + 6, end });
    return true;
  };
  useLayoutEffect(() => {
    if (open && wide) measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wide]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => focusItem(0), 0);
    if (!wide) return () => window.clearTimeout(timer);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const follow = () => { if (!measure()) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wide]);

  /* The sheet is a modal: Escape, the page held still, focus handed back. */
  useOverlay(open && !wide, () => setOpen(false));

  const row = (action: Action, big: boolean) => (
    <button
      key={action.key}
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => choose(action)}
      className={`flex w-full items-center gap-3 rounded-xl px-3 text-start font-bold hover:bg-[#0a285a]/[.06] focus-visible:bg-[#0a285a]/[.06] ${big ? "min-h-12 text-[15px]" : "min-h-10 text-[13px]"} ${action.danger ? "text-[#c2362a]" : "text-[#0a285a]"}`}
    >
      <span className={`grid size-5 shrink-0 place-items-center ${action.danger ? "" : "text-[#536b8c]"}`}>{action.icon}</span>
      <span className="min-w-0 flex-1">{action.label}</span>
    </button>
  );

  const host = typeof document === "undefined" ? null
    : (button.current?.closest<HTMLElement>("[role=dialog], main") ?? document.body);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => { pressHaptic(); setOpen(value => !value); }}
        onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("cart.lineMenu", { name: title })}
        title={t("cart.lineMenuShort")}
        className="tap-target -m-1 grid size-9 shrink-0 place-items-center rounded-full text-[#536b8c] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      {open && wide && place && host ? createPortal(
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={t("cart.lineMenu", { name: title })}
          onKeyDown={onMenuKey}
          style={{ top: place.top, bottom: place.bottom, insetInlineEnd: place.end }}
          className="fixed z-[80] w-60 rounded-2xl border border-[#d5dfeb] bg-white p-1.5 shadow-[0_18px_40px_rgba(10,40,90,.16)]"
        >
          {actions.map((action, index) => (
            <div key={action.key}>
              {action.danger && index > 0 ? <div role="separator" className="my-1 h-px bg-[#e6e9ef]" /> : null}
              {row(action, false)}
            </div>
          ))}
        </div>,
        host,
      ) : null}
      {open && !wide ? createPortal(
        <div className="fixed inset-0 z-[80] flex items-end bg-[#061b3b]/40" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("cart.lineMenu", { name: title })}
            onClick={event => event.stopPropagation()}
            className="sheet-rise w-full rounded-t-3xl bg-white px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_40px_rgba(10,40,90,.18)]"
          >
            <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-[#d5dfeb]" />
            {/* Which line this is about, so a sheet over the bag cannot be
                mistaken for the one under it. */}
            <div className="mb-2 flex items-center gap-3 border-b border-[#eef1f5] px-2 pb-3">
              <span className="size-12 shrink-0 overflow-hidden rounded-xl border border-[#eef1f5] bg-[#f4f6f9]">
                <Thumb src={item.image?.url} alt="" className="size-full object-cover" icon={<ShoppingBag className="size-4" />} />
              </span>
              <span dir="auto" className="line-clamp-2 min-w-0 text-[14px] font-extrabold leading-5 text-[#0a285a]">{title}</span>
            </div>
            <div ref={menu} id={menuId} role="menu" aria-label={t("cart.lineMenu", { name: title })} onKeyDown={onMenuKey}>
              {actions.map(action => row(action, true))}
            </div>
            <button
              type="button"
              onClick={() => close(true)}
              className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl bg-[#f0f2f5] text-[15px] font-bold text-[#0a285a]"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
