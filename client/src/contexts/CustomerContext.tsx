import { readStored, readStoredList, removeStored, writeStored } from "@/lib/browserStore";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { kuwaitDeliveryZones } from "@shared/customer";
import { directionFor, type LocaleCode } from "@shared/i18n/dictionary";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

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
  toggleSaved: (productId: string) => void;
  deliveryZoneId: string | null;
  deliveryZone: (typeof kuwaitDeliveryZones)[number] | undefined;
  setDeliveryZoneId: (zoneId: string) => void;
  isSignedIn: boolean;
};

const CustomerContext = createContext<CustomerContextValue | null>(null);

export function CustomerProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [guestSavedIds, setGuestSavedIds] = useState(() => readStoredList(SAVED_STORAGE_KEY));
  const [guestDeliveryZoneId, setGuestDeliveryZoneId] = useState(() => readStored(DELIVERY_STORAGE_KEY));
  const [locale, setLocaleState] = useState<LocaleCode>(() => readStored(LOCALE_STORAGE_KEY) === "ar" ? "ar" : "en");
  const syncedGuestIds = useRef<string | null>(null);
  const profile = trpc.customer.profile.get.useQuery(undefined, { enabled: isAuthenticated });
  const saved = trpc.customer.saved.list.useQuery(undefined, { enabled: isAuthenticated });
  const updateProfile = trpc.customer.profile.update.useMutation({
    onSuccess: () => profile.refetch(),
  });
  const updateSaved = trpc.customer.saved.set.useMutation({
    onSuccess: () => saved.refetch(),
  });

  // The one writer of <html lang/dir>. Direction is a document property, and
  // setting it here — above every page — is what makes the `ms-`/`me-`/
  // `start-`/`end-` utilities throughout the tree flip together.
  useEffect(() => {
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

  const setLocale = useCallback((nextLocale: LocaleCode) => {
    setLocaleState(nextLocale);
    writeValue(LOCALE_STORAGE_KEY, nextLocale);
    if (isAuthenticated) updateProfile.mutate({ locale: nextLocale });
  }, [isAuthenticated, updateProfile]);

  const toggleLocale = useCallback(() => setLocale(locale === "en" ? "ar" : "en"), [locale, setLocale]);

  const toggleSaved = useCallback((productId: string) => {
    const nextSaved = !savedIds.includes(productId);
    if (isAuthenticated) {
      updateSaved.mutate({ productId, saved: nextSaved });
      return;
    }
    setGuestSavedIds(current => {
      const next = nextSaved ? Array.from(new Set([...current, productId])) : current.filter(id => id !== productId);
      writeValue(SAVED_STORAGE_KEY, next);
      return next;
    });
  }, [isAuthenticated, savedIds, updateSaved]);

  const setDeliveryZoneId = useCallback((zoneId: string) => {
    if (!kuwaitDeliveryZones.some(zone => zone.id === zoneId)) return;
    setGuestDeliveryZoneId(zoneId);
    writeValue(DELIVERY_STORAGE_KEY, zoneId);
    // Carries the current language too: this call can be what creates the
    // row, and a row created without one takes the column's "en" default.
    if (isAuthenticated) updateProfile.mutate({ deliveryZoneId: zoneId, locale });
  }, [isAuthenticated, locale, updateProfile]);

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

  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}

export function useCustomer() {
  const context = useContext(CustomerContext);
  if (!context) throw new Error("useCustomer must be used inside CustomerProvider");
  return context;
}
