/**
 * Folds the shop assistant's button to its round mark while the page's own
 * floating pill shares the foot of a phone's screen with it — the department
 * and search pages' Sort | Filter, after the owner's reference, which sets a
 * pill beside a round button. The assistant stays, as the owner asked it to
 * on every page; only "Need help?" goes, the way it goes while the tab bar is
 * away. `data-assistant-mark` on `<html>`, read by `.assistant-launcher` in
 * index.css under the phone's width alone; written on the element directly,
 * so nothing re-renders for it.
 */
import { useEffect } from "react";

export function useAssistantMark(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    root.setAttribute("data-assistant-mark", "");
    return () => root.removeAttribute("data-assistant-mark");
  }, [on]);
}
