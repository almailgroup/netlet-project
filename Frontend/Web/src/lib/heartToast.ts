/**
 * What a page says after its heart was pressed — one rule for every page that
 * draws one, so the words follow what the heart did.
 *
 * Nothing when the heart asked: the chooser says where the product went once
 * the shopper has answered (`WishChooser`). A signed-in heart taken back
 * leaves Saved and the shopper's wishlists too, and says so.
 */
import type { SaveOutcome } from "@/contexts/CustomerContext";
import type { Translate } from "@/hooks/useTranslation";
import { isolate } from "@/lib/isolate";
import { toast } from "sonner";

export function toastHeart(outcome: SaveOutcome, name: string, t: Translate): void {
  if (outcome === "asked") return;
  const key = outcome === "saved" ? "saved.savedForLater" : outcome === "unwished" ? "wish.unwished" : "saved.removed";
  // A product title is the seller's, in either script: isolated, so an
  // English one in an Arabic sentence keeps its punctuation in place.
  toast(t(key, { name: isolate(name) }));
}
