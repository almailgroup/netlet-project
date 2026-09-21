/**
 * One setting, in the card the account page repeats down its length.
 *
 * Shared so the profile section and the preferences section cannot drift into
 * two slightly different cards — which is what happened when each had its own
 * copy, and is visible immediately when they sit one above the other.
 */
import type { ReactNode } from "react";

export function SettingPanel({ icon, title, note, children }: {
  icon: ReactNode;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5 sm:p-6">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e7edf5] text-[#0a285a]">{icon}</span>
        <div className="min-w-0">
          <h3 className="text-base font-extrabold text-[#0a285a]">{title}</h3>
          {note ? <p className="mt-1 text-[12px] leading-5 ink-muted">{note}</p> : null}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
