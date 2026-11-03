/**
 * The help centre's self-service, the server half (`Shared/commerce/selfService.ts`
 * is the rule): the order's facts built from the same answer the order page
 * reads, and the resolution for an issue the shopper named.
 *
 * Scoped by account in the query, like every order read: another shopper's
 * reference is "not found", and an item that is not on this order is no item.
 */
import { blocksNewReturn } from "../../../Shared/commerce/returnRequests.js";
import { resolveIssue, shortDayIn, type HelpIssue, type HelpResolution, type IssueFacts } from "../../../Shared/commerce/selfService.js";
import { featureOn } from "./features.js";
import { orderDetailForShopper, type ShopperOrderDetail } from "./orderDetail.js";

/** A claim that is still being dealt with: waiting on the store, being repaired, or on its way back. */
const OPEN_CLAIM = new Set(["waiting", "repairing", "returning"]);

/** The order's facts as the self-service rule reads them. */
export function issueFactsFrom(detail: ShopperOrderDetail, returnsOn: boolean): IssueFacts {
  const parcelOf = new Map(detail.steps.parcels.flatMap(parcel => parcel.lineIds.map(id => [id, parcel] as const)));
  return {
    cancelled: detail.steps.cancelled,
    cancellable: detail.cancel.cancellable,
    addressChangeable: detail.changeAddress.changeable,
    paid: detail.order.status === "paid" || detail.order.status === "refunded",
    owed: `${detail.order.currency} ${detail.owedNow}`,
    returnWindowDays: detail.windowDays,
    lines: detail.lines.map(line => {
      const requests = detail.returns.filter(request => request.orderItemId === line.id);
      return {
        id: line.id,
        title: line.productTitle,
        fulfilment: line.fulfilment,
        returnable: returnsOn && line.returnState.returnable && !requests.some(request => blocksNewReturn(request.status)),
        returnStatus: requests[0]?.status ?? null,
        warranty: returnsOn && line.warrantyEligibility.allowed,
        claimOpen: detail.warranty.some(claim => claim.orderItemId === line.id && OPEN_CLAIM.has(claim.stage)),
        changeable: detail.change.changeable && line.changeable,
        rebuyable: line.variantId !== null,
        reviewable: line.reviewEligibility.allowed,
        promise: parcelOf.get(line.id)?.promise ?? null,
      };
    }),
  };
}

export type SelfHelpAnswer = HelpResolution & {
  /** The order's items, for the page that has not opened it: the item an issue is about is chosen from these. */
  items: { id: number; title: string; variant: string | null; photo: string | null; fulfilment: string; variantId: number | null; quantity: number }[];
};

/** The answer to an issue, or null when the order is not this shopper's. */
export async function selfHelpFor(
  userId: number,
  input: { issue: HelpIssue; reference: string | null; lineId: number | null; locale: "en" | "ar" },
): Promise<SelfHelpAnswer | null> {
  const day = shortDayIn(input.locale);
  if (!input.reference) return { ...resolveIssue(input.issue, null, null, day), items: [] };
  const detail = await orderDetailForShopper(userId, input.reference);
  if (!detail) return null;
  const facts = issueFactsFrom(detail, await featureOn("returns"));
  return {
    ...resolveIssue(input.issue, facts, input.lineId, day),
    items: detail.lines.map(line => ({
      id: line.id,
      title: line.productTitle,
      variant: line.variantTitle && line.variantTitle !== "Default" ? line.variantTitle : null,
      photo: line.photo ?? null,
      fulfilment: line.fulfilment,
      variantId: line.variantId,
      quantity: line.quantity,
    })),
  };
}

