/**
 * What a plus says when there is no more to add.
 *
 * On the owner's report that "the plus doesn't let me add more": every
 * stepper stops at what the shelf holds (`cardCeiling`, `lineCeiling`,
 * `roomFor`), and it did so by greying its plus — and most of the live shop's
 * pieces are one of a kind, so the plus went grey after one, without a word,
 * which read as a broken button. A plus at the limit stays pressable now, is
 * drawn faint, and pressed it buzzes as a refusal and says the limit: what
 * there is, or the line's ceiling, each as what it is — the typed box's own
 * words. One toast id, so pressing again does not stack them.
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { MAX_LINE_QUANTITY } from "@shared/commerce/types";
import { useTranslation } from "@/hooks/useTranslation";
import { refusedHaptic } from "@/lib/haptics";

export function useStockLimit(): (ceiling: number) => void {
  const { t } = useTranslation();
  return useCallback((ceiling: number) => {
    refusedHaptic();
    toast(
      ceiling < MAX_LINE_QUANTITY ? t("cart.onlyAvailable", { count: ceiling }) : t("cart.atMost", { count: String(MAX_LINE_QUANTITY) }),
      { id: "stock-limit" },
    );
  }, [t]);
}
