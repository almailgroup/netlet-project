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
 * The menu itself — a sheet on a phone, a small menu from `sm`, the WAI-ARIA
 * menu in both — is `LinePopover`, which the line's delivery button
 * (`LineDestination`) opens too.
 */
import { useMemberCode } from "@/hooks/useMemberCode";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { LinePopover, type LineAction } from "@/components/cart/LinePopover";
import { shareProduct } from "@/components/product/ProductCard";
import { useAuth } from "@/hooks/useAuth";
import { useFeature } from "@/hooks/useFeature";
import { useTranslation } from "@/hooks/useTranslation";
import { navigateWhenReady } from "@/lib/readyNavigation";
import { appPath } from "@/lib/basePath";
import type { CartItem } from "@shared/commerce/types";
import { Bookmark, ExternalLink, Gift, MoreHorizontal, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function LineMenu({ item, title }: { item: CartItem; title: string }) {
  const { t } = useTranslation();
  /* A member's Share carries their code, as the product page's does. */
  const memberCode = useMemberCode();
  const { removeItem, addItem, closeCart } = useCart();
  const { savedIds, saveForLater, chooseWishlist, unsave } = useCustomer();
  const { isAuthenticated } = useAuth();
  const wishlistsOn = useFeature("wishlists");

  const productId = item.productId;
  const plain = !item.addons?.length && !item.bundleName;
  /* After a line leaves the bag its button is gone, so the keyboard goes to
     the page rather than to `<body>`. */
  const toPage = () => window.setTimeout(() => document.getElementById("main")?.focus({ preventScroll: true }), 0);
  const drop = () => void removeItem(item.lineId).catch(() => toast.error(t("cart.updateFailed")));

  const actions: LineAction[] = [];
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

  return (
    <LinePopover
      item={item}
      title={title}
      label={t("cart.lineMenu", { name: title })}
      short={t("cart.lineMenuShort")}
      trigger={<MoreHorizontal className="size-5" aria-hidden />}
      actions={actions}
    />
  );
}
