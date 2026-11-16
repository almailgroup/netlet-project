/**
 * Preview: pages and features that are designed but not connected yet —
 * booking, rates, locations, accounts, notifications, a courier's map, a photo
 * at the door, sample figures and quotes. They are drawn only where preview is
 * on, so the live site never shows a customer something that is not true
 * about their parcel or a form that sends nothing.
 *
 * Preview is on for a demo deployment (SHIPLEE_DEMO, `pnpm dev` with no
 * database) and on a device somebody turned it on for at /preview; it is kept
 * on that device alone. Everything shown in it says so.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import { useConfig } from "./hooks.js";
import { readStored, writeStored } from "./storage.js";
import { useLanguage } from "./i18n.js";
import { NotFound } from "./pages/NotFound.js";

const KEY = "shiplee:preview";

type Preview = {
  /** Preview is showing. */
  on: boolean;
  /** A demo deployment, where preview is always on and cannot be left. */
  demo: boolean;
  /** The server has answered, so `on` is final. */
  ready: boolean;
  setOn: (on: boolean) => void;
};

const PreviewContext = createContext<Preview | null>(null);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const [flag, setFlag] = useState(() => readStored(KEY) === "1");
  const setOn = useCallback((on: boolean) => {
    writeStored(KEY, on ? "1" : "0");
    setFlag(on);
  }, []);
  const demo = Boolean(config?.demo);
  const value = useMemo<Preview>(() => ({ on: demo || flag, demo, ready: config !== null, setOn }), [demo, flag, config, setOn]);
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview(): Preview {
  const value = useContext(PreviewContext);
  if (!value) throw new Error("usePreview outside PreviewProvider");
  return value;
}

/** A page that exists only in preview: anywhere else its address is a page not found. */
export function PreviewOnly({ children }: { children: ReactNode }) {
  const preview = usePreview();
  if (preview.on) return <>{children}</>;
  if (!preview.ready) return <div className="container"><div className="page-head" aria-busy="true" /></div>;
  return <NotFound />;
}

/** The mark on anything shown as a preview. */
export function PreviewTag({ label }: { label?: string }) {
  const { t } = useLanguage();
  return (
    <span className="badge preview">
      <Eye size={13} aria-hidden="true" />
      {label ?? t("preview.tag")}
    </span>
  );
}
