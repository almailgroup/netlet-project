/**
 * What each size-guide measurement is called (3.1.20), for the seller's editor
 * and the shopper's guide alike — one list, so the column a seller fills in
 * and the field a shopper measures for cannot be named differently.
 */
import type { BodyMeasure } from "@shared/commerce/sizeGuide";
import type { MessageKey } from "@shared/i18n/dictionary";

export const MEASURE_LABEL: Record<BodyMeasure, MessageKey> = {
  chest: "sizeGuide.chest",
  waist: "sizeGuide.waist",
  hips: "sizeGuide.hips",
  inseam: "sizeGuide.inseam",
  footLength: "sizeGuide.footLength",
  height: "sizeGuide.height",
};
