/**
 * "Remove this?", asked before anything a shopper keeps is taken away, on the
 * owner's word ("for removing anything, first it should ask you if you are
 * sure you want to remove this, like removing products from cart").
 *
 * One dialog for the whole app, mounted once in `App`, and a hook every
 * removal awaits: `const sure = await confirmRemoval({ title, body })`, then
 * the removal only when `sure`. It is `ConfirmDialog` in its danger tone —
 * the verb on the button, Cancel focused on opening so a stray Enter keeps
 * the thing, Escape and a press on the dim answering no — portalled to
 * `<body>` above every drawer and sheet, because the bin pressed may be
 * inside the bag drawer, a line's menu or the product preview, and a hovered
 * card's lift is a transform that would otherwise hold a fixed dialog
 * inside the card. A second question while one is open answers the first
 * no.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useTranslation } from "@/hooks/useTranslation";
import { isolate } from "@/lib/isolate";
import { useCustomer } from "@/contexts/CustomerContext";

export type RemovalQuestion = {
  title: string;
  body: string;
  /** The verb on the button; "Remove" when not given. */
  confirmLabel?: string;
};

type Ask = (question: RemovalQuestion) => Promise<boolean>;

/* Outside the provider (a component drawn alone in a test) nothing asks. */
const AskContext = createContext<Ask>(async () => true);

export function ConfirmRemovalProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState<RemovalQuestion | null>(null);
  const waiting = useRef<((sure: boolean) => void) | null>(null);

  const ask = useCallback<Ask>(next => new Promise<boolean>(resolve => {
    waiting.current?.(false);
    waiting.current = resolve;
    setQuestion(next);
  }), []);

  const answer = (sure: boolean) => {
    const resolve = waiting.current;
    waiting.current = null;
    setQuestion(null);
    resolve?.(sure);
  };

  return (
    <AskContext.Provider value={ask}>
      {children}
      {question && typeof document !== "undefined"
        ? createPortal(
          <div className="relative z-[100]">
            <ConfirmDialog
              open
              tone="danger"
              icon={<Trash2 className="size-5" aria-hidden />}
              title={question.title}
              body={question.body}
              confirmLabel={question.confirmLabel ?? t("remove.confirm")}
              onConfirm={() => answer(true)}
              onClose={() => answer(false)}
            />
          </div>,
          document.body,
        )
        : null}
    </AskContext.Provider>
  );
}

/** Asks "Remove this?" and answers whether the shopper is sure. */
export function useConfirmRemoval(): Ask {
  return useContext(AskContext);
}

/**
 * The bag's own question, asked by every way a line leaves it — the bin, the
 * minus at one, a typed zero, "Remove from cart" in the line's menu, the
 * card's and the photo's steppers, the product page's and the preview's —
 * so all of them say the same thing. The product's name is isolated, so a
 * Latin name keeps its place in the Arabic sentence.
 */
export function useAskRemoveFromCart(): (name: string) => Promise<boolean> {
  const ask = useConfirmRemoval();
  const { t } = useTranslation();
  return useCallback(
    (name: string) => ask({ title: t("remove.cartTitle"), body: t("remove.cartBody", { name: isolate(name) }) }),
    [ask, t],
  );
}

/**
 * A filled heart's question: what pressing it takes away is Saved, or — for
 * something on a wishlist — every list it is on as well, and the sentence
 * says which (`wishedIds`, the rule `toggleSaved` follows).
 */
export function useAskUnheart(): (productId: string, name: string) => Promise<boolean> {
  const ask = useConfirmRemoval();
  const { t } = useTranslation();
  const { wishedIds } = useCustomer();
  return useCallback(
    (productId: string, name: string) => ask({
      title: t("remove.savedTitle"),
      body: t(wishedIds.includes(productId) ? "remove.heartWishedBody" : "remove.savedBody", { name: isolate(name) }),
    }),
    [ask, t, wishedIds],
  );
}
