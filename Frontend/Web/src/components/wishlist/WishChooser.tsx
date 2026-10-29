/**
 * The heart's question, on the owner's word: **a private wishlist or a public
 * one?** Asked whenever a signed-in shopper fills a heart, so nothing goes on
 * a list anybody else can read without the shopper having chosen that.
 *
 * Each choice says in words who will see it — the state is never a colour
 * alone — and names the list it lands on, or says one is made if there is
 * none (`wishlists.wish` makes it, under the title here, in the page's
 * language). A public list with no phone number on the account is still
 * shared by its link, and the choice says the number is what lets family find
 * it by typing.
 *
 * A sheet from the foot of a phone's screen, a card in the middle of a wide
 * one, and `useOverlay`'s three: Escape closes, focus returns to the heart,
 * the page stops scrolling. Mounted once, by `CustomerProvider`.
 */
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic, refusedHaptic } from "@/lib/haptics";
import { appPath } from "@/lib/basePath";
import { navigateWhenReady } from "@/lib/readyNavigation";
import { isolate } from "@/lib/isolate";
import { trpc } from "@/lib/trpc";
import type { Visibility } from "@shared/commerce/wishlist";
import { isMessageKey } from "@shared/i18n/dictionary";
import { Gift, LoaderCircle, Lock, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

export function WishChooser({ productId, onClose, onWished }: { productId: string; onClose: () => void; onWished?: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);
  const utils = trpc.useUtils();
  const lists = trpc.wishlists.mine.useQuery();
  const phone = trpc.wishlists.phone.useQuery();
  const wish = trpc.wishlists.wish.useMutation();
  const [choosing, setChoosing] = useState<Visibility | null>(null);

  useOverlay(true, onClose);
  useEffect(() => {
    const timer = window.setTimeout(() => firstRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const existing = (visibility: Visibility) => lists.data?.find(list => list.visibility === visibility) ?? null;

  const choose = (visibility: Visibility) => {
    pressHaptic();
    setChoosing(visibility);
    wish.mutate(
      { productId, visibility, title: t(visibility === "public" ? "wish.defaultPublic" : "wish.defaultPrivate") },
      {
        onSuccess: answer => {
          void utils.customer.saved.list.invalidate();
          void utils.wishlists.mine.invalidate();
          /* Before closing, which forgets what to do next. */
          onWished?.();
          onClose();
          toast.success(t(visibility === "public" ? "wish.addedPublic" : "wish.addedPrivate", { list: isolate(answer.title) }), {
            action: { label: t("wish.viewLists"), onClick: () => navigateWhenReady(appPath("/account/wishlists")) },
          });
        },
        onError: error => {
          refusedHaptic();
          setChoosing(null);
          toast.error(isMessageKey(error.message) ? t(error.message) : t("error.serverProblem"));
        },
      },
    );
  };

  const option = (visibility: Visibility) => {
    const list = existing(visibility);
    const isPublic = visibility === "public";
    const Icon = isPublic ? Gift : Lock;
    return (
      <button
        type="button"
        ref={isPublic ? undefined : firstRef}
        onClick={() => choose(visibility)}
        disabled={wish.isPending}
        className="pressable flex w-full items-start gap-3.5 rounded-2xl border border-[#d5dfeb] bg-white p-4 text-start transition-colors hover:bg-[#f0f2f5] disabled:opacity-60"
      >
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${isPublic ? "bg-[#d8ead8] text-[#2f5d33]" : "bg-[#e7edf5] text-[#0a285a]"}`}>
          {choosing === visibility ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Icon className="size-5" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-[#0a285a]">{t(isPublic ? "wish.publicChoice" : "wish.privateChoice")}</span>
          <span className="mt-0.5 block text-sm leading-5 ink-muted">{t(isPublic ? "wish.publicChoiceNote" : "wish.privateChoiceNote")}</span>
          <span className="mt-1.5 block text-[13px] font-semibold text-[#0a285a]">
            {list ? t("wish.goesOn", { list: isolate(list.title) }) : t("wish.makesNew", { list: t(isPublic ? "wish.defaultPublic" : "wish.defaultPrivate") })}
          </span>
          {isPublic && phone.data === null ? (
            <span className="mt-1 block text-[13px] leading-5 ink-accent">{t("wish.publicNoPhone")}</span>
          ) : null}
        </span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#061b3b]/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-t-3xl bg-[#fffdf9] px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 shadow-[0_24px_60px_rgba(10,40,90,.28)] sm:rounded-3xl sm:pb-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-extrabold text-[#0a285a]">{t("wish.chooseTitle")}</h2>
            <p className="mt-1 text-sm leading-5 ink-muted">{t("wish.chooseNote")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="pressable -me-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-[#0a285a]"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="mt-4 space-y-2.5">
          {option("private")}
          {option("public")}
        </div>
      </div>
    </div>
  );
}
