/**
 * A chosen delivery day said one way everywhere (migration 0085): "Today,
 * Evening 4 – 9pm", "Wed 19 Nov, Morning 9am – 12pm" — the cart's row, its
 * sheet, checkout and the opened order. Kuwait's calendar, like every date.
 */
import { SHOP_TIME_ZONE } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { kuwaitDay } from "@shared/kuwaitDay";
import type { MessageKey } from "@shared/i18n/dictionary";

type Window = "morning" | "afternoon" | "evening";
const WINDOWS: Window[] = ["morning", "afternoon", "evening"];

export function useSlotWords() {
  const { t, isArabic } = useTranslation();
  const day = (date: string) => {
    const now = new Date();
    if (date === kuwaitDay(now)) return t("storeDelivery.today");
    if (date === kuwaitDay(new Date(now.getTime() + 86_400_000))) return t("storeDelivery.tomorrow");
    return new Date(`${date}T12:00:00+03:00`).toLocaleDateString(isArabic ? "ar-KW-u-nu-latn" : "en-GB", {
      weekday: "short", day: "numeric", month: "short", timeZone: SHOP_TIME_ZONE,
    });
  };
  const slot = (value: { date: string; window: string }) => {
    const window = (WINDOWS as string[]).includes(value.window) ? value.window as Window : "morning";
    return t("slot.line", { day: day(value.date), window: t(`slot.${window}` as MessageKey), hours: t(`slot.${window}Hours` as MessageKey) });
  };
  return { day, slot };
}

