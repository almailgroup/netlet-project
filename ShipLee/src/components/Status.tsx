import { CircleCheckBig, CirclePause, CircleX, ClipboardList, DoorClosed, Package, Route, Truck, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Status } from "../../shared/status.js";
import { toneOf } from "../../shared/status.js";
import { useLanguage } from "../i18n.js";

export const STATUS_ICONS: Record<Status, LucideIcon> = {
  created: ClipboardList,
  picked_up: Package,
  in_transit: Route,
  out_for_delivery: Truck,
  delivered: CircleCheckBig,
  attempted: DoorClosed,
  on_hold: CirclePause,
  returned: Undo2,
  cancelled: CircleX,
};

/** A status as a small label: its icon and its name, never colour alone. */
export function StatusPill({ status }: { status: Status }) {
  const { t } = useLanguage();
  const Icon = STATUS_ICONS[status];
  return (
    <span className={`pill tone-${toneOf(status)}`}>
      <Icon size={14} aria-hidden="true" />
      {t(`status.${status}`)}
    </span>
  );
}
