/**
 * What a shopper can be told, in the five groups they choose from (on the
 * owner's word: "notification management similar to Amazon … order and
 * delivery updates; deals, discounts and promotions; personalized offers;
 * product recommendations; account and security. Essential security and
 * transactional notifications should remain available").
 *
 * Pure and shared, and **no new switch**: each group is one of the four
 * preferences an account already keeps (`customer_notification_preferences`),
 * or none at all, and lists the notices it covers. What a group's switch
 * silences is exactly what `NOTICE_RULES` says that preference silences, and
 * what it never silences — an order's confirmation, a refund, a changed
 * password — is said beside it as always on. `noticeCategories.test.ts` holds
 * that every notice a shopper can be sent is in exactly one group.
 */
import type { MessageKey } from "../i18n/dictionary.js";
import type { NotificationKind } from "../customer.js";
import type { NoticeKind } from "./notices.js";

export type NoticeCategory = {
  id: "orders" | "deals" | "personal" | "recommendations" | "account";
  title: MessageKey;
  body: MessageKey;
  /** The account preference its switch is, or null when it is always on. */
  preference: NotificationKind | null;
  /** The notices that switch silences. */
  switched: readonly NoticeKind[];
  /** The notices in the group that always reach the shopper, and the sentence saying so. */
  always: readonly NoticeKind[];
  alwaysNote: MessageKey | null;
};

export const NOTICE_CATEGORIES: readonly NoticeCategory[] = [
  {
    id: "orders",
    title: "notify.cat.orders.title",
    body: "notify.cat.orders.body",
    preference: "delivery_update",
    switched: ["order_on_the_way", "order_delivered", "exchange_sent"],
    always: ["order_placed", "line_cancelled", "return_approved", "return_declined", "refund_done"],
    alwaysNote: "notify.cat.orders.always",
  },
  {
    id: "deals",
    title: "notify.cat.deals.title",
    body: "notify.cat.deals.body",
    preference: "price_drop",
    switched: ["price_drop"],
    always: ["back_in_stock"],
    alwaysNote: "notify.cat.deals.always",
  },
  {
    id: "personal",
    title: "notify.cat.personal.title",
    body: "notify.cat.personal.body",
    preference: "bag_reminder",
    switched: ["bag_reminder"],
    always: ["offer_answered"],
    alwaysNote: "notify.cat.personal.always",
  },
  {
    id: "recommendations",
    title: "notify.cat.recommendations.title",
    body: "notify.cat.recommendations.body",
    preference: "new_arrival",
    switched: ["new_arrival"],
    always: [],
    alwaysNote: null,
  },
  {
    id: "account",
    title: "notify.cat.account.title",
    body: "notify.cat.account.body",
    preference: null,
    switched: [],
    always: [
      "account_password_changed",
      "account_email_changed",
      "support_answered",
      "application_more_needed",
      "application_document_declined",
      "application_contract_sent",
      "application_approved",
      "application_rejected",
    ],
    alwaysNote: "notify.cat.account.always",
  },
];
