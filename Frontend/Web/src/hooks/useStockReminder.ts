/**
 * "Notify me when back in stock" — one reminder per product, the shopper's
 * own, on every sold-out product the shop draws: its page, its card, the
 * preview, Saved and Frequently bought.
 *
 * It is the follow row's `backInStock` and nothing else (`followFlags`): the
 * server already tells a follower the moment a product can be bought again
 * (`withProductAlerts`, the `back_in_stock` notice), in the inbox and by
 * email where the shop sends email and the account has it on. The toast says
 * which of the two the shopper will get (`customer.follows.reach`), because a
 * promise of an email that will never come is the one thing a reminder must
 * not make.
 *
 * A guest is asked to sign in where they are, and the reminder is set the
 * moment the session exists, so the press they made is the one that counts.
 * Every hook on a page shares the two reads by their query key, so a grid of
 * sold-out cards asks once.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic, refusedHaptic, successHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";

export type StockReminder = {
  /** The reminder is on for this product. */
  on: boolean;
  /** Being saved; the press is held until it lands. */
  pending: boolean;
  /** How many shoppers are waiting, for the line under the button. */
  waiting: number;
  /** Turns it on, or off if it is on. A guest signs in first. */
  press: () => void;
  /** The sign-in dialog is wanted over the page. */
  signingIn: boolean;
  closeSignIn: () => void;
};

export function useStockReminder({ productId, title }: { productId: string; title: string }, enabled = true): StockReminder {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const [signingIn, setSigningIn] = useState(false);
  /* The press a guest made, kept until the session exists. */
  const afterSignIn = useRef(false);

  const follows = trpc.customer.follows.list.useQuery(undefined, { enabled: enabled && isAuthenticated, staleTime: 30_000 });
  const reach = trpc.customer.follows.reach.useQuery(undefined, { enabled: enabled && isAuthenticated, staleTime: 5 * 60_000 });
  const demand = trpc.customer.follows.demand.useQuery({ productId }, { enabled, staleTime: 60_000 });

  const on = Boolean(follows.data?.find(entry => entry.productId === productId)?.backInStock);

  const save = trpc.customer.follows.set.useMutation({
    onSuccess: (_rows, input) => {
      void utils.customer.follows.list.invalidate();
      void utils.customer.follows.demand.invalidate({ productId });
      if (input.backInStock) {
        successHaptic();
        toast.success(t(reach.data?.email ? "remind.setEmail" : "remind.setInbox", { name: title }));
      } else {
        toast(t("remind.off", { name: title }));
      }
    },
    onError: () => {
      refusedHaptic();
      toast.error(t("follow.failed"));
    },
  });

  useEffect(() => {
    if (!isAuthenticated || !afterSignIn.current) return;
    afterSignIn.current = false;
    setSigningIn(false);
    save.mutate({ productId, backInStock: true });
    // `save` is a fresh object each render; the session arriving is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, productId]);

  const press = () => {
    pressHaptic();
    if (save.isPending) return;
    if (!isAuthenticated) {
      afterSignIn.current = true;
      setSigningIn(true);
      return;
    }
    save.mutate({ productId, backInStock: !on });
  };

  return {
    on,
    pending: save.isPending,
    waiting: demand.data ?? 0,
    press,
    signingIn,
    /* The dialog closes on success before the session is read (WishChooser's
       rule), so the press stands a moment longer; a guest who closed it
       without signing in has it forgotten then, and a later sign-in from the
       header does not set a reminder nobody asked for that time. */
    closeSignIn: () => {
      setSigningIn(false);
      window.setTimeout(() => { afterSignIn.current = false; }, 15_000);
    },
  };
}
