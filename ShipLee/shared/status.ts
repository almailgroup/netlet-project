/**
 * Where a parcel can be, and what the tracking page draws for it.
 *
 * Four of the states are the road every parcel takes — picked up, in transit,
 * out for delivery, delivered — and are drawn as a progress line. The others
 * are what can go wrong on it, each said in words beside the line rather than
 * as a step of its own: an attempt that failed, a hold, a return to the
 * sender, a cancellation.
 */
export const STATUSES = [
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "attempted",
  "on_hold",
  "returned",
  "cancelled",
] as const;
export type Status = (typeof STATUSES)[number];

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export const MILESTONES = ["picked_up", "in_transit", "out_for_delivery", "delivered"] as const satisfies readonly Status[];

/** How a status reads: on its way, done, needs attention, or stopped for good. */
export type Tone = "waiting" | "moving" | "done" | "attention" | "stopped";

export function toneOf(status: Status): Tone {
  switch (status) {
    case "created":
      return "waiting";
    case "delivered":
      return "done";
    case "attempted":
    case "on_hold":
      return "attention";
    case "returned":
    case "cancelled":
      return "stopped";
    default:
      return "moving";
  }
}

/** No update is expected after these. */
export function isFinal(status: Status): boolean {
  return status === "delivered" || status === "returned" || status === "cancelled";
}

export type Progress = {
  /** How many of the four milestones the parcel has reached, 0 to 4. */
  reached: number;
  /** Whether the progress line is drawn at all: a parcel going back, or cancelled, is not on that road. */
  drawn: boolean;
};

/**
 * How far along the road a parcel is, from everything that has happened to it
 * rather than its latest status alone: a parcel on hold after leaving with a
 * driver has still been out for delivery, and a failed attempt means it went
 * out.
 */
export function progressOf(current: Status, history: readonly Status[]): Progress {
  let reached = 0;
  for (const status of [...history, current]) {
    const at = (MILESTONES as readonly Status[]).indexOf(status);
    if (at >= 0) reached = Math.max(reached, at + 1);
    if (status === "attempted") reached = Math.max(reached, 3);
  }
  return { reached, drawn: current !== "returned" && current !== "cancelled" };
}

/**
 * The staff desk's filters: statuses grouped the way the desk works through
 * them — booked and waiting for pickup, moving, with a driver, needing
 * somebody to act, delivered, and closed.
 */
export const STATUS_GROUPS = {
  waiting: ["created"],
  moving: ["picked_up", "in_transit"],
  out: ["out_for_delivery"],
  attention: ["attempted", "on_hold"],
  delivered: ["delivered"],
  closed: ["returned", "cancelled"],
} as const satisfies Record<string, readonly Status[]>;
export type StatusGroup = keyof typeof STATUS_GROUPS;
export const GROUP_ORDER = Object.keys(STATUS_GROUPS) as StatusGroup[];

export function isStatusGroup(value: unknown): value is StatusGroup {
  return typeof value === "string" && (GROUP_ORDER as readonly string[]).includes(value);
}

export function groupOf(status: Status): StatusGroup {
  return GROUP_ORDER.find(group => (STATUS_GROUPS[group] as readonly Status[]).includes(status))!;
}
