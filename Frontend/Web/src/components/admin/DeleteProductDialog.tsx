/**
 * "Delete this product for good?" — with what goes with it, and the name typed.
 *
 * `ConfirmDialog` asks for one press, which is right for signing out and wrong
 * here: a delete cannot be taken back, and the list it is pressed from is a
 * column of near-identical rows where the wrong one is one row away. Typing the
 * name is what proves the person is looking at the product they mean — the
 * friction is the point, and it is spent only on the one act that cannot be
 * undone. Matching ignores case and the spaces at either end, because the test
 * is "is this the one you mean", not "can you type".
 *
 * The counts come from the server before anybody confirms, so "3 shoppers saved
 * it" is read before it happens rather than discovered after. Anything that
 * stops a delete — a placement still being paid for, stock NetLet holds — is
 * said in place of the field, with nothing to press but Cancel.
 */
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { buttonClass, fieldClass, isolate } from "./ui";

export function DeleteProductDialog({ product, onClose, onDeleted }: {
  /** The product to delete, or null when the dialog is closed. */
  product: { id: number; title: string } | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const open = product !== null;
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");
  const utils = trpc.useUtils();

  const check = trpc.inventory.products.deletionCheck.useQuery(
    { id: product?.id ?? 0 },
    /* Asked fresh each time it opens: a count from five minutes ago is the
       answer to a different question. */
    { enabled: open, staleTime: 0, gcTime: 0, retry: false },
  );
  const remove = trpc.inventory.products.delete.useMutation({
    onSuccess: result => {
      toast.success(t("admin.deleted", { title: isolate(result.title) }));
      void utils.inventory.products.list.invalidate();
      void utils.inventory.overview.invalidate();
      utils.inventory.products.get.setData({ id: result.id }, undefined);
      onDeleted();
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed")),
  });

  useOverlay(open, () => { if (!remove.isPending) onClose(); });
  useEffect(() => {
    if (!open) return;
    setTyped("");
    window.setTimeout(() => cancelRef.current?.focus(), 40);
  }, [open, product?.id]);

  if (!product) return null;

  const matches = typed.trim().toLowerCase() === product.title.trim().toLowerCase();
  const data = check.data;
  const blocked = data ? data.blockers.length > 0 : false;
  const counts: { key: MessageKey; value: number }[] = data
    ? ([
        { key: "admin.deleteCountVariants", value: data.variants },
        { key: "admin.deleteCountPhotos", value: data.images },
        { key: "admin.deleteCountUnits", value: data.unitsOnHand },
        { key: "admin.deleteCountCarts", value: data.inCarts },
        { key: "admin.deleteCountSaved", value: data.savedBy },
        { key: "admin.deleteCountBundles", value: data.bundles },
        { key: "admin.deleteCountSubscriptions", value: data.subscriptions },
      ] satisfies { key: MessageKey; value: number }[]).filter(row => row.value > 0)
    : [];

  /* Portalled, for the reason every overlay opened from inside a sticky or
     transformed ancestor is: `position: fixed` resolves against that ancestor. */
  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-[#061b3b]/50 p-4" onClick={() => { if (!remove.isPending) onClose(); }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={event => event.stopPropagation()}
        className="w-full max-w-[460px] rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div className="grid size-11 place-items-center rounded-xl bg-[#fdeceb] text-[#8c2f22]">
          <Trash2 className="size-5" aria-hidden />
        </div>
        <h2 id={titleId} className="mt-4 text-[18px] leading-7 font-extrabold break-words text-[#0a285a]">
          {t("admin.deleteTitle", { title: isolate(product.title) })}
        </h2>
        <p id={bodyId} className="mt-2 text-[14px] leading-6 text-[#536b8c]">{t("admin.deleteBody")}</p>

        <div aria-live="polite" className="mt-4">
          {check.isLoading ? (
            <p className="flex items-center gap-2 text-[13px] ink-muted">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />{t("admin.deleteChecking")}
            </p>
          ) : check.isError ? (
            <p className="rounded-xl bg-[#fdeceb] px-3.5 py-3 text-[13px] font-semibold text-[#8c2f22]">
              {isMessageKey(check.error.message) ? t(check.error.message) : t("admin.loadFailed")}
            </p>
          ) : data ? (
            <>
              {counts.length ? (
                <>
                  <h3 className="text-[13px] font-semibold text-[#0a285a]">{t("admin.deleteGoesWith")}</h3>
                  <dl className="mt-2 divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
                    {counts.map(row => (
                      <div key={row.key} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]">
                        <dt className="text-[#536b8c]">{t(row.key)}</dt>
                        <dd className="font-bold text-[#0a285a] tabular-nums">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
              {data.openOrderLines > 0 ? (
                <p className="mt-3 text-[13px] leading-5 text-[#536b8c]">{t("admin.deleteOpenOrders", { count: data.openOrderLines })}</p>
              ) : null}
              {blocked ? (
                <div className="mt-3 rounded-xl border border-[#f2b69e] bg-[#fdeceb] px-3.5 py-3 text-[13px] leading-5 text-[#8c2f22]">
                  <p className="flex items-center gap-2 font-bold"><AlertTriangle className="size-4 shrink-0" aria-hidden />{t("admin.deleteBlockedHeading")}</p>
                  <ul className="mt-1.5 space-y-1">
                    {data.blockers.map(blocker => <li key={blocker}>{t(blocker)}</li>)}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-[13px] leading-5 text-[#536b8c]">{t("admin.deleteUnpublishInstead")}</p>
              )}
            </>
          ) : null}
        </div>

        {data && !blocked ? (
          <form
            id={`${titleId}-form`}
            className="mt-4"
            onSubmit={event => {
              event.preventDefault();
              if (matches && !remove.isPending) remove.mutate({ id: product.id });
            }}
          >
            <label htmlFor={`${titleId}-name`} className="block text-[13px] leading-5 font-semibold text-[#0a285a]">
              {t("admin.deleteTypeName")}
            </label>
            {/* The name to copy, drawn where it can be read: `bdi`, because a
                Latin title on the Arabic page keeps its own direction. */}
            <p className="mt-1 rounded-lg bg-[#f4f6f9] px-3 py-1.5 text-[13px] font-bold break-words text-[#0a285a]"><bdi>{product.title}</bdi></p>
            <input
              id={`${titleId}-name`}
              dir="auto"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={event => setTyped(event.target.value)}
              className={`${fieldClass} mt-2`}
            />
          </form>
        ) : null}

        {/* One Cancel for every state, so the focus put on it when the dialog
            opens is not dropped when the counts arrive and the form appears. */}
        <div className="mt-5 flex flex-wrap gap-2.5">
          {data && !blocked ? (
            <button type="submit" form={`${titleId}-form`} disabled={!matches || remove.isPending} className={`${buttonClass.danger} flex-1`}>
              {remove.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
              {t(remove.isPending ? "admin.deleteDeleting" : "admin.deleteConfirm")}
            </button>
          ) : null}
          <button ref={cancelRef} type="button" onClick={onClose} disabled={remove.isPending} className={`${buttonClass.secondary} flex-1`}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
