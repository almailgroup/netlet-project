/**
 * What the account page's own search finds, on the owner's word ("the search
 * bar should only search for what's in the specific page … profile"): every
 * place on the account a shopper looks for — a section, a row of "Your
 * profile" or Preferences, a quick setting — by its name and the words it
 * answers to, in both languages through the dictionary, so typing "password"
 * on either page finds the password under "Your profile".
 *
 * One list for the web and the app (exported in `rules.json`), each drawing a
 * place where it lives on that platform; the rule that matches is
 * `textsMatch`, the shop's own folding and stemming.
 */
import { messages, type MessageKey } from "../i18n/dictionary.js";
import { textsMatch } from "./search.js";

export type AccountPlace = {
  id: string;
  /** What the place is called. */
  label: MessageKey;
  /** The page it is on, when it is part of another; null for a page of its own. */
  within: MessageKey | null;
  /** Other words it answers to — its hint, the parts it holds. */
  words: MessageKey[];
  /** A part of the account that has to exist for it to be offered, or null for every account. */
  needs: string | null;
};

const place = (id: string, label: MessageKey, within: MessageKey | null, words: MessageKey[] = [], needs: string | null = null): AccountPlace => ({ id, label, within, words, needs });

const PROFILE: MessageKey = "account.sectionProfile";
const PREFERENCES: MessageKey = "account.sectionPreferences";
const QUICK: MessageKey = "quick.settingsTitle";

/** In the order the results are listed: what a shopper opens most, first. */
export const ACCOUNT_PLACES: readonly AccountPlace[] = [
  place("orders", "account.myOrders", null, ["account.sectionOrders", "account.hint.orders", "orders.viewProcessing", "orders.viewOnTheWay", "orders.viewDelivered", "orders.viewCancelled"]),
  place("returns", "orders.viewReturns", "account.myOrders", ["account.hint.returns"]),
  place("reviews", "orders.viewReviews", "account.myOrders", ["account.hint.reviews"]),
  place("saved", "saved.andWishlists", null, ["account.hint.saved"]),
  place("wishlists", "saved.tabWishlists", "saved.andWishlists", ["account.hint.wishlists"]),
  place("frequent", "frequent.section", null, ["account.hint.frequent"], "frequent"),
  place("wallet", "account.wallet", null, ["account.hint.wallet"]),
  place("points", "account.points", "account.wallet"),
  place("cards", "payments.savedCards", "account.wallet"),
  place("notifications", "notices.title", null),
  place("profile", PROFILE, null, ["account.hint.details"]),
  place("name", "profile.nameTitle", PROFILE),
  place("email", "account.emailCard", PROFILE),
  place("phone", "profile.phoneTitle", PROFILE),
  place("password", "account.password", PROFILE),
  place("about", "profile.aboutTitle", PROFILE, ["profile.genderTitle", "profile.birthdayTitle"]),
  place("photo", "profilePhoto.title", PROFILE),
  place("deleteAccount", "account.deleteTitle", PROFILE),
  place("addresses", "address.book", null, ["account.hint.addresses"]),
  place("offers", "offers.mine", null, ["account.hint.offers"], "offers"),
  place("subscriptions", "subscriptions.section", null, ["account.hint.subscriptions"], "subscriptions"),
  place("country", "quick.country", QUICK),
  place("currency", "currency.title", QUICK),
  place("language", "account.language", QUICK),
  place("preferences", PREFERENCES, null, ["account.hint.preferences"]),
  place("noticeSettings", "notify.title", PREFERENCES),
  place("deliveryArea", "account.deliveryArea", PREFERENCES),
  place("storage", "storage.title", PREFERENCES, ["storage.clear"]),
  place("haptics", "haptics.title", PREFERENCES, [], "haptics"),
  place("history", "history.title", null, ["account.hint.history"]),
  place("help", "footer.helpCentre", null, ["account.hint.help"]),
  place("selling", "seller.becomeTitle", null, ["seller.cardTitle", "seller.open"]),
  place("affiliate", "affiliate.section", null, ["account.hint.affiliate"], "affiliate"),
  place("signOut", "header.signOut", null),
];

/**
 * The places on the account answering a search; `has` says which parts this
 * account has. A place whose own name answers comes before one found by the
 * page it is on or the words it answers to — "password" is the password, then
 * "Your profile", whose hint mentions it — and each keeps the list's order.
 */
export function accountPlacesMatching(term: string, has: (part: string) => boolean): AccountPlace[] {
  const found = ACCOUNT_PLACES.filter(entry => (!entry.needs || has(entry.needs)) && textsMatch(textsOf(entry), term));
  const named = (entry: AccountPlace) => textsMatch([messages.en[entry.label], messages.ar[entry.label]], term);
  return [...found.filter(named), ...found.filter(entry => !named(entry))];
}

/** A place's words in both languages: what it is called, the page it is on, the words it answers to. */
function textsOf(entry: AccountPlace): string[] {
  const keys = [entry.label, entry.within, ...entry.words].filter((key): key is MessageKey => key !== null);
  return keys.flatMap(key => [messages.en[key], messages.ar[key]]);
}
