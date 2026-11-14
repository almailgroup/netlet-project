import { useEffect, useState } from "react";
import type { Config } from "./api.js";
import { loadConfig } from "./api.js";

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function useConfig(): Config | null {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    let live = true;
    void loadConfig().then(value => {
      if (live) setConfig(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return config;
}
