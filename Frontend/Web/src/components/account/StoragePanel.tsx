/**
 * What NetLet keeps on this device, and Clear cache (on the owner's word:
 * "app storage usage display, and clear cache where the operating system
 * permits"). The size is the browser's own estimate (`navigator.storage`),
 * said only where the browser gives one; clearing empties the remembered
 * shop shelves (`lib/shelfMemory.ts`) and the site's Cache Storage — never
 * the session, the cart, the language or the browsing history, which are a
 * shopper's and have their own controls.
 */
import { useEffect, useState } from "react";
import { HardDrive, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { SettingPanel } from "@/components/ui/SettingPanel";
import { useTranslation } from "@/hooks/useTranslation";
import { forgetShelves } from "@/lib/shelfMemory";

/** Bytes as a reader says them: 820 KB, 3.4 MB. */
export function storageSize(bytes: number, locale: "en" | "ar"): string {
  const units = locale === "ar" ? ["بايت", "ك.ب", "م.ب", "ج.ب"] : ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(Math.round(value)) : value.toLocaleString(locale === "ar" ? "ar-KW-u-nu-latn" : "en-GB", { maximumFractionDigits: value < 10 ? 1 : 0 });
  return `${shown} ${units[unit]}`;
}

async function estimate(): Promise<number | null> {
  try {
    const answer = await navigator.storage?.estimate?.();
    return typeof answer?.usage === "number" ? answer.usage : null;
  } catch {
    return null;
  }
}

export function StoragePanel() {
  const { t, locale } = useTranslation();
  const [usage, setUsage] = useState<number | null | undefined>(undefined);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let live = true;
    void estimate().then(bytes => { if (live) setUsage(bytes); });
    return () => { live = false; };
  }, []);

  const clear = async () => {
    setClearing(true);
    forgetShelves();
    try {
      if (typeof caches !== "undefined") for (const name of await caches.keys()) await caches.delete(name);
    } catch {
      /* A browser that refuses Cache Storage keeps it; the shelves are gone either way. */
    }
    setUsage(await estimate());
    setClearing(false);
    toast.success(t("storage.cleared"));
  };

  return (
    <SettingPanel icon={<HardDrive className="size-5" />} title={t("storage.title")} note={t("storage.note")}>
      <p role="status" className="text-sm text-[#1f2a44]">
        {usage === undefined ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : usage === null ? t("storage.unknown") : t("storage.used", { size: storageSize(usage, locale) })}
      </p>
      <button type="button" onClick={() => void clear()} disabled={clearing} className="glass type-control pressable mt-3 inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-60 pointer-fine:min-h-9">
        {clearing ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t(clearing ? "storage.clearing" : "storage.clear")}
      </button>
    </SettingPanel>
  );
}
