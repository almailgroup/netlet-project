/**
 * Haptic feedback, on the owner's word ("an option in the preferences that
 * will allow the user to fully disable haptic feedback"): one switch, kept on
 * this device, that `lib/haptics.ts` reads before every buzz. Drawn only where
 * the browser can buzz at all (Android's Chrome): Safari on an iPhone and a
 * computer cannot, and a switch that changes nothing is not a control.
 */
import { useState } from "react";
import { Vibrate } from "lucide-react";
import { SettingPanel } from "@/components/ui/SettingPanel";
import { useTranslation } from "@/hooks/useTranslation";
import { canBuzz, hapticsOn, pressHaptic, setHapticsOn } from "@/lib/haptics";

export function HapticsPanel() {
  const { t } = useTranslation();
  const [on, setOn] = useState(hapticsOn);
  if (!canBuzz()) return null;
  return (
    <SettingPanel icon={<Vibrate className="size-5" />} title={t("haptics.title")} note={t("haptics.note")}>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[#d5dfeb] bg-[#f8f9fc] px-4 py-3">
        <label htmlFor="haptics-switch" className="text-sm font-bold text-[#0a285a]">{t("haptics.switch")}</label>
        <input
          id="haptics-switch"
          type="checkbox"
          role="switch"
          checked={on}
          onChange={event => {
            setHapticsOn(event.target.checked);
            setOn(event.target.checked);
            /* Turned back on, it says so the way it will from now on. */
            if (event.target.checked) pressHaptic();
          }}
          className="size-5 shrink-0 accent-[#0a285a]"
        />
      </div>
    </SettingPanel>
  );
}
