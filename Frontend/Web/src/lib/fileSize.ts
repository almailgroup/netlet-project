import { useTranslation } from "@/hooks/useTranslation";

/**
 * A file's size as people read it: "2.4 MB", "640 KB" — a megabyte being a
 * million bytes, as a phone and a Mac count it. Latin digits on the Arabic
 * page too, as its dates and counts are: "1 كيلوبايت" beside "11 نوفمبر 2026".
 * One copy for the documents, the store's papers and a product's catalogues.
 */
export function useFileSize() {
  const { t, locale } = useTranslation();
  return (bytes: number) => {
    const megabytes = bytes >= 1_000_000;
    const value = megabytes ? bytes / 1_000_000 : Math.max(1, Math.round(bytes / 1000));
    const size = new Intl.NumberFormat(locale === "ar" ? "ar-KW-u-nu-latn" : "en", { maximumFractionDigits: megabytes ? 1 : 0 }).format(value);
    return t(megabytes ? "documents.sizeMb" : "documents.sizeKb", { size });
  };
}
