import { readLastAddressId, zoneFromAddressBook } from "@/lib/lastAddress";
import { readStored, readStoredList, removeStored, writeStored } from "@/lib/browserStore";
import { switchLanguage } from "@/lib/languageSwitch";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { kuwaitDeliveryZones } from "@shared/customer";
import { directionFor, type LocaleCode } from "@shared/i18n/dictionary";
import { useFeature } from "@/hooks/useFeature";
import { lazyPage } from "@/lib/lazyPage";
import { whenIdle } from "@/lib/idle";
import { createContext, type ReactNode, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/* The heart's question, fetched when the browser is idle after a sign-in. */
const WishChooser = lazyPage(async () => ({ default: (await import("@/components/wishlist/WishChooser")).WishChooser }));

const SAVED_STORAGE_KEY = "netlet:saved-product-ids";
const DELIVERY_STORAGE_KEY = "netlet:delivery-zone";
const LOCALE_STORAGE_KEY = "netlet:locale";

/*
 * Every access goes through `lib/browserStore`, which cannot throw.
 *
 * This provider reads the stored locale while it renders and sits near the root
 * of the tree, so an access that throws is not a lost preference — it is the
 * whole storefront replaced by "An unexpected error occurred", on every page,
 * for every visitor whose browser blocks site data. The list reader here was
 * already wrapped and the text reader beside it was not, which is how one of a
 * pair ends up carrying the rule and the other does not.
 */
/** The language this device last read the shop in — what the first page asks its data in. */
export function storedLocale(): LocaleCode {
  return readStored(LOCALE_STORAGE_KEY) === "ar" ? "ar" : "en";
}

function writeValue(key: string, value: string | string[] | null) {
  if (value === null) removeStored(key);
  else writeStored(key, Array.isArray(value) ? JSON.stringify(value) : value);
}

type CustomerContextValue = {
  locale: LocaleCode;
  isArabic: boolean;
  direction: "rtl" | "ltr";
  setLocale: (locale: LocaleCode) => void;
  toggleLocale: () => void;
  savedIds: string[];
  /**
   * The heart. Signed in, an empty heart *asks* — a private wishlist or a
   * public one (`WishChooser`, on the owner's word) — and the chooser says
   * what happened; a filled one comes out of Saved and off the shopper's
   * lists. Signed out it saves on this device, there being no lists without
   * an account. Answers which, so a page toasts only what it did itself.
   */
  toggleSaved: (productId: string) => SaveOutcome;
  deliveryZoneId: string | null;
  deliveryZone: (typeof kuwaitDeliveryZones)[number] | undefined;
  setDeliveryZoneId: (zoneId: string) => void;
  isSignedIn: boolean;
};

/** What the heart did: asked which list, saved on this device, or took it back — from the device, or from Saved and the account's lists. */
export type SaveOutcome = "asked" | "saved" | "removed" | "unwished";

const CustomerContext = createContext<CustomerContextValue | null>(null);

export function CustomerProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [guestSavedIds, setGuestSavedIds] = useState(() => readStoredList(SAVED_STORAGE_KEY));
  const [guestDeliveryZoneId, setGuestDeliveryZoneId] = useState(() => readStored(DELIVERY_STORAGE_KEY));
  const [locale, setLocaleState] = useState<LocaleCode>(storedLocale);
  const syncedGuestIds = useRef<string | null>(null);
  const profile = trpc.customer.profile.get.useQuery(undefined, { enabled: isAuthenticated });
  const saved = trpc.customer.saved.list.useQuery(undefined, { enabled: isAuthenticated });
  const updateProfile = trpc.customer.profile.update.useMutation({
    onSuccess: () => profile.refetch(),
  });
  const updateSaved = trpc.customer.saved.set.useMutation({
    onSuccess: () => saved.refetch(),
  });
  const unwish = trpc.wishlists.unwish.useMutation({
    onSuccess: () => saved.refetch(),
  });
  const wishlistsOn = useFeature("wishlists");
  const [asking, setAsking] = useState<string | null>(null);
  useEffect(() => {
    if (isAuthenticated && wishlistsOn) return whenIdle(() => void WishChooser.preload());
  }, [isAuthenticated, wishlistsOn]);

  // The one writer of <html lang/dir>. Direction is a document property, and
  // setting it here — above every page — is what makes the `ms-`/`me-`/
  // `start-`/`end-` utilities throughout the tree flip together. A layout
  // effect, so it lands before the first paint: as an ordinary effect the
  // Arabic page was painted left to right for a frame and then flipped, and
  // the whole page moving sideways measured 0.77 of layout shift on Home.
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionFor(locale);
  }, [locale]);

  /*
   * Adopt a stored language, but only a stored one.
   *
   * A shopper with no saved preference keeps the language they are already
   * reading, and it is written up so the choice exists from then on. The
   * previous version took the server's "en" default as an answer and flipped
   * an Arabic session to English on sign-in.
   */
  useEffect(() => {
    if (!isAuthenticated || !profile.data) return;
    if (profile.data.locale === null) {
      updateProfile.mutate({ locale });
      return;
    }
    if (profile.data.locale !== locale) setLocaleState(profile.data.locale);
  }, [isAuthenticated, locale, profile.data, updateProfile]);

  useEffect(() => {
    if (!isAuthenticated || !saved.data?.length) return;
    const guestKey = guestSavedIds.slice().sort().join("|");
    if (!guestKey || syncedGuestIds.current === guestKey) return;
    const serverIds = new Set(saved.data);
    const missing = guestSavedIds.filter(productId => !serverIds.has(productId));
    if (!missing.length) {
      syncedGuestIds.current = guestKey;
      return;
    }
    missing.forEach(productId => updateSaved.mutate({ productId, saved: true }));
    syncedGuestIds.current = guestKey;
  }, [guestSavedIds, isAuthenticated, saved.data, updateSaved]);

  const savedIds = isAuthenticated ? saved.data ?? guestSavedIds : guestSavedIds;
  const deliveryZoneId = isAuthenticated ? profile.data?.deliveryZoneId ?? guestDeliveryZoneId : guestDeliveryZoneId;
  const deliveryZone = kuwaitDeliveryZones.find(zone => zone.id === deliveryZoneId);

  /* A press on a language control fades from one language into the other
     (`lib/languageSwitch`), holding the old page until the new one's words
     have arrived. */
  const queryClient = useQueryClient();
  const setLocale = useCallback((nextLocale: LocaleCode) => {
    writeValue(LOCALE_STORAGE_KEY, nextLocale);
    if (isAuthenticated) updateProfile.mutate({ locale: nextLocale });
    switchLanguage(() => setLocaleState(nextLocale), () => queryClient.isFetching() > 0);
  }, [isAuthenticated, queryClient, updateProfile]);

  const toggleLocale = useCallback(() => setLocale(locale === "en" ? "ar" : "en"), [locale, setLocale]);

  const toggleSaved = useCallback((productId: string): SaveOutcome => {
    const nextSaved = !savedIds.includes(productId);
    if (isAuthenticated) {
      if (nextSaved && wishlistsOn) {
        setAsking(productId);
        return "asked";
      }
      if (nextSaved) {
        updateSaved.mutate({ productId, saved: true });
        return "saved";
      }
      unwish.mutate({ productId });
      return "unwished";
    }
    setGuestSavedIds(current => {
      const next = nextSaved ? Array.from(new Set([...current, productId])) : current.filter(id => id !== productId);
      writeValue(SAVED_STORAGE_KEY, next);
      return next;
    });
    return nextSaved ? "saved" : "removed";
  }, [isAuthenticated, savedIds, unwish, updateSaved, wishlistsOn]);

  const setDeliveryZoneId = useCallback((zoneId: string) => {
    if (!kuwaitDeliveryZones.some(zone => zone.id === zoneId)) return;
    setGuestDeliveryZoneId(zoneId);
    writeValue(DELIVERY_STORAGE_KEY, zoneId);
    // Carries the current language too: this call can be what creates the
    // row, and a row created without one takes the column's "en" default.
    if (isAuthenticated) updateProfile.mutate({ deliveryZoneId: zoneId, locale });
  }, [isAuthenticated, locale, updateProfile]);

  /*
   * A signed-in shopper who never chose an area but has an address book gets
   * the area of the address checkout would choose — the one used last on this
   * device, else the first. Only while nothing is chosen, here or on the
   * account: a choice is never overwritten by a guess, however good. Asked
   * once the profile has answered, so a choice stored on the account is not
   * raced by the book.
   */
  const needsArea = isAuthenticated && Boolean(profile.data) && !profile.data?.deliveryZoneId && !guestDeliveryZoneId;
  const book = trpc.customer.addresses.list.useQuery(undefined, { enabled: needsArea, staleTime: 5 * 60 * 1000 });
  const adoptedFromBook = useRef(false);
  useEffect(() => { if (!isAuthenticated) adoptedFromBook.current = false; }, [isAuthenticated]);
  useEffect(() => {
    if (!needsArea || !book.data || adoptedFromBook.current) return;
    adoptedFromBook.current = true;
    const zone = zoneFromAddressBook(book.data, readLastAddressId());
    if (zone) setDeliveryZoneId(zone);
  }, [book.data, needsArea, setDeliveryZoneId]);

  const value = useMemo<CustomerContextValue>(() => ({
    locale,
    isArabic: locale === "ar",
    direction: directionFor(locale),
    setLocale,
    toggleLocale,
    savedIds,
    toggleSaved,
    deliveryZoneId,
    deliveryZone,
    setDeliveryZoneId,
    isSignedIn: isAuthenticated,
  }), [deliveryZone, deliveryZoneId, isAuthenticated, locale, savedIds, setDeliveryZoneId, setLocale, toggleLocale, toggleSaved]);

  return (
    <CustomerContext.Provider value={value}>
      {children}
      {asking && isAuthenticated ? (
        <Suspense fallback={null}>
          <WishChooser productId={asking} onClose={() => setAsking(null)} />
        </Suspense>
      ) : null}
    </CustomerContext.Provider>
  );
}

export function useCustomer() {
  const context = useContext(CustomerContext);
  if (!context) throw new Error("useCustomer must be used inside CustomerProvider");
  return context;
}
