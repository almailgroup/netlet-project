import type { MessageKey } from "./i18n/dictionary.js";

export type { LocaleCode } from "./i18n/dictionary.js";

export type DeliveryZone = {
  id: string;
  label: string;
  labelAr: string;
  configured: boolean;
  estimateLabel: string;
};

/**
 * These are real Kuwaiti governorate labels. Operational timing and pricing are
 * deliberately left unconfigured until NetLet provides its delivery policy.
 */
export const kuwaitDeliveryZones: DeliveryZone[] = [
  { id: "capital", label: "Capital (Al Asimah)", labelAr: "العاصمة", configured: false, estimateLabel: "Estimate awaiting setup" },
  { id: "hawalli", label: "Hawalli", labelAr: "حولي", configured: false, estimateLabel: "Estimate awaiting setup" },
  { id: "farwaniya", label: "Farwaniya", labelAr: "الفروانية", configured: false, estimateLabel: "Estimate awaiting setup" },
  { id: "ahmadi", label: "Ahmadi", labelAr: "الأحمدي", configured: false, estimateLabel: "Estimate awaiting setup" },
  { id: "jahra", label: "Jahra", labelAr: "الجهراء", configured: false, estimateLabel: "Estimate awaiting setup" },
  { id: "mubarak-al-kabeer", label: "Mubarak Al-Kabeer", labelAr: "مبارك الكبير", configured: false, estimateLabel: "Estimate awaiting setup" },
];

export const notificationKinds = ["price_drop", "bag_reminder", "new_arrival", "delivery_update"] as const;
export type NotificationKind = (typeof notificationKinds)[number];

/** Message keys, not sentences: the storefront ships in two languages. */
export const notificationLabelKeys: Record<NotificationKind, MessageKey> = {
  price_drop: "notification.priceDrop",
  bag_reminder: "notification.bagReminder",
  new_arrival: "notification.newArrival",
  delivery_update: "notification.deliveryUpdate",
};

export const defaultNotificationPreferences: Record<NotificationKind, boolean> = {
  price_drop: true,
  bag_reminder: false,
  new_arrival: true,
  delivery_update: true,
};
