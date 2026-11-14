/**
 * Sample parcels for trying ShipLee with no database: a local `pnpm dev`, or a
 * deployment that sets SHIPLEE_DEMO=1 on purpose. Never on a real deployment
 * by accident — with no database and no SHIPLEE_DEMO, tracking says it is not
 * available rather than answering from invented parcels.
 *
 * The numbers are fixed so the home page can offer them, and each carries a
 * real check digit. The times are counted back from now, so "out for
 * delivery" is today whenever somebody looks.
 */
import { checkDigit, PREFIX } from "./tracking.js";
import type { Status } from "./status.js";
import type { Governorate } from "./kuwait.js";
import { kuwaitDay } from "./kuwait.js";
import { dayAfter } from "./format.js";

const number = (body: string) => PREFIX + body + String(checkDigit(body));

export type DemoParcel = {
  trackingNumber: string;
  senderName: string;
  recipientName: string;
  recipientPhone: string;
  governorate: Governorate;
  area: string;
  address: string;
  pieces: number;
  codFils: number | null;
  expectedOn: string | null;
  /** Hours before now, oldest first. */
  events: { status: Status; hoursAgo: number; location: string | null; note?: string }[];
};

export function demoParcels(now: Date = new Date()): DemoParcel[] {
  const today = kuwaitDay(now);
  return [
    {
      trackingNumber: number("482061937"),
      senderName: "Dar Home",
      recipientName: "Fatima Al-Enezi",
      recipientPhone: "55123456",
      governorate: "hawalli",
      area: "Salmiya",
      address: "Block 10, Street 4, House 12",
      pieces: 2,
      codFils: 12_500,
      expectedOn: today,
      events: [
        { status: "created", hoursAgo: 30, location: null },
        { status: "picked_up", hoursAgo: 26, location: "Shuwaikh" },
        { status: "in_transit", hoursAgo: 20, location: "Shuwaikh hub" },
        { status: "out_for_delivery", hoursAgo: 2, location: "Salmiya" },
      ],
    },
    {
      trackingNumber: number("731502846"),
      senderName: "Gadget Hub",
      recipientName: "Omar Al-Mutairi",
      recipientPhone: "99887766",
      governorate: "capital",
      area: "Sharq",
      address: "Block 2, Ahmad Al-Jaber Street, Tower 5",
      pieces: 1,
      codFils: null,
      expectedOn: null,
      events: [
        { status: "created", hoursAgo: 52, location: null },
        { status: "picked_up", hoursAgo: 49, location: "Al-Rai" },
        { status: "in_transit", hoursAgo: 44, location: "Shuwaikh hub" },
        { status: "out_for_delivery", hoursAgo: 28, location: "Sharq" },
        { status: "delivered", hoursAgo: 25, location: "Sharq", note: "Received at reception." },
      ],
    },
    {
      trackingNumber: number("265819470"),
      senderName: "Al-Waha Market",
      recipientName: "Noura Al-Sabah",
      recipientPhone: "66554433",
      governorate: "ahmadi",
      area: "Fintas",
      address: "Block 4, Street 18, House 7",
      pieces: 3,
      codFils: 4_250,
      expectedOn: dayAfter(today),
      events: [
        { status: "created", hoursAgo: 40, location: null },
        { status: "picked_up", hoursAgo: 36, location: "Shuwaikh" },
        { status: "in_transit", hoursAgo: 30, location: "Shuwaikh hub" },
        { status: "out_for_delivery", hoursAgo: 8, location: "Fintas" },
        { status: "attempted", hoursAgo: 5, location: "Fintas", note: "Nobody was home. We'll try again tomorrow." },
      ],
    },
    {
      trackingNumber: number("917340258"),
      senderName: "Bloom Flowers",
      recipientName: "Hessa Al-Rashidi",
      recipientPhone: "51234567",
      governorate: "jahra",
      area: "Saad Al-Abdullah",
      address: "Block 6, Street 3, House 21",
      pieces: 1,
      codFils: null,
      expectedOn: dayAfter(today),
      events: [
        { status: "created", hoursAgo: 6, location: null },
        { status: "picked_up", hoursAgo: 3, location: "Ardiya" },
      ],
    },
  ];
}
