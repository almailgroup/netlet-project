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

/* One empty list, so a guest's `wishedIds` is the same array every render. */
const NONE: string[] = [];

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
  /** Saved — the products kept to come back to — and nothing on a wishlist. */
  savedIds: string[];
  /**
   * What fills a heart: Saved and every product on the shopper's wishlists,
   * which are two things now (`wishlists.wishedIds`).
   */
  heartedIds: string[];
  /** What is on the shopper's wishlists, once each; empty for a guest. */
  wishedIds: string[];
  /**
   * The heart. An empty one *asks*, on the owner's word — **Saved items or a
   * wishlist?** (`WishChooser`), and for a wishlist which one — because the
   * two are different things; the chooser says what happened. A filled one
   * comes out of Saved and off the shopper's lists. A guest is asked too:
   * Saved is kept on this device, and a wishlist needs signing in. With the
   * `wishlists` switch off it saves and asks nothing. Answers which, so a
   * page toasts only what it did itself.
   */
  toggleSaved: (productId: string) => SaveOutcome;
  /**
   * Into Saved without the heart's question — the bag's "Save for later",
   * which keeps something for later rather than putting it on a list. A
   * product already saved stays saved.
   */
  saveForLater: (productId: string) => void;
  /**
   * The heart's second question asked outright — which list, private or
   * public — for the bag's "Move to wishlist". `onWished` runs once the
   * shopper has chosen one and it is on it, never when they close it.
   */
  chooseWishlist: (productId: string, onWished?: () => void) => void;
  /** Out of Saved alone — "Move to cart" — leaving any list it is on alone. */
  unsave: (productId: string) => void;
  deliveryZoneId: string | null;
  deliveryZone: (typeof kuwaitDeliveryZones)[number] | undefined;
  setDeliveryZoneId: (zoneId: string) => void;
  isSignedIn: boolean;
};

/** What the heart did: asked where it goes, saved it, or took it back — from Saved alone, or from Saved and the account's lists. */
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
  const wishlistsOn = useFeature("wishlists");
  const wished = trpc.wishlists.wishedIds.useQuery(undefined, { enabled: isAuthenticated && wishlistsOn });
  const unwish = trpc.wishlists.unwish.useMutation({
    onSuccess: () => { void saved.refetch(); void wished.refetch(); },
  });
  const [asking, setAsking] = useState<{ productId: string; start: "choose" | "lists" } | null>(null);
  /* What to do once the question asked by `chooseWishlist` has an answer. */
  const afterWish = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (wishlistsOn) return whenIdle(() => void WishChooser.preload());
  }, [wishlistsOn]);

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
  const wishedIds = isAuthenticated ? wished.data : undefined;
  const heartedIds = useMemo(
    () => (wishedIds?.length ? Array.from(new Set([...savedIds, ...wishedIds])) : savedIds),
    [savedIds, wishedIds],
  );
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
    const hearted = heartedIds.includes(productId);
    if (!hearted && wishlistsOn) {
      setAsking({ productId, start: "choose" });
      return "asked";
    }
    if (isAuthenticated) {
      if (!hearted) {
        updateSaved.mutate({ productId, saved: true });
        return "saved";
      }
      if (wishedIds?.includes(productId)) {
        unwish.mutate({ productId });
        return "unwished";
      }
      updateSaved.mutate({ productId, saved: false });
      return "removed";
    }
    setGuestSavedIds(current => {
      const next = hearted ? current.filter(id => id !== productId) : Array.from(new Set([...current, productId]));
      writeValue(SAVED_STORAGE_KEY, next);
      return next;
    });
    return hearted ? "removed" : "saved";
  }, [heartedIds, isAuthenticated, unwish, updateSaved, wishedIds, wishlistsOn]);

  const saveForLater = useCallback((productId: string) => {
    if (savedIds.includes(productId)) return;
    if (isAuthenticated) {
      updateSaved.mutate({ productId, saved: true });
      return;
    }
    setGuestSavedIds(current => {
      const next = Array.from(new Set([...current, productId]));
      writeValue(SAVED_STORAGE_KEY, next);
      return next;
    });
  }, [isAuthenticated, savedIds, updateSaved]);

  const unsave = useCallback((productId: string) => {
    if (isAuthenticated) {
      updateSaved.mutate({ productId, saved: false });
      return;
    }
    setGuestSavedIds(current => {
      const next = current.filter(id => id !== productId);
      writeValue(SAVED_STORAGE_KEY, next);
      return next;
    });
  }, [isAuthenticated, updateSaved]);

  const chooseWishlist = useCallback((productId: string, onWished?: () => void) => {
    if (!isAuthenticated) return;
    afterWish.current = onWished ?? null;
    setAsking({ productId, start: "lists" });
  }, [isAuthenticated]);

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
    heartedIds,
    wishedIds: wishedIds ?? NONE,
    toggleSaved,
    saveForLater,
    chooseWishlist,
    unsave,
    deliveryZoneId,
    deliveryZone,
    setDeliveryZoneId,
    isSignedIn: isAuthenticated,
  }), [chooseWishlist, deliveryZone, deliveryZoneId, heartedIds, isAuthenticated, locale, saveForLater, savedIds, setDeliveryZoneId, setLocale, toggleLocale, toggleSaved, unsave, wishedIds]);

  return (
    <CustomerContext.Provider value={value}>
      {children}
      {asking ? (
        <Suspense fallback={null}>
          <WishChooser
            productId={asking.productId}
            start={asking.start}
            signedIn={isAuthenticated}
            onSave={() => saveForLater(asking.productId)}
            onWished={() => { const then = afterWish.current; afterWish.current = null; then?.(); void wished.refetch(); }}
            onClose={() => { afterWish.current = null; setAsking(null); }}
          />
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
