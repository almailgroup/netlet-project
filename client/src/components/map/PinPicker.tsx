/**
 * Drop a pin for an address (3.2.7).
 *
 * Optional, always, and the panel says so: a typed address is what an order
 * cannot exist without, and somebody who refuses location access, whose
 * connection never draws the tiles, or who would rather not say where they
 * live must still be able to buy something. The pin is what saves the driver's
 * phone call from the end of the road; it is never a gate.
 *
 * ## The map moves, the pin stays still
 *
 * The pin is drawn over the middle of the map and the shopper moves the map
 * under it, rather than dragging a marker. Dragging a 30px marker with a thumb
 * is the hard way on a phone, and a draggable marker has no keyboard story at
 * all — whereas a focused map already pans with the arrow keys and zooms with
 * plus and minus, so "move the map until the pin is on your door, then press
 * the button" is one instruction that works for a finger, a mouse and a
 * keyboard alike. A tap on the map brings that spot to the middle, which is
 * what somebody who taps their own roof expects.
 *
 * ## Leaflet is loaded when the map opens, not before
 *
 * The picker is closed on nearly every visit to checkout — most shoppers pick a
 * saved address or never touch it — so the library and its stylesheet are
 * fetched the first time somebody opens it, not with the page. A failed fetch
 * says the typed address is enough rather than leaving a grey box.
 *
 * The tiles are OpenStreetMap's, credited on the map as their terms ask.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { LocateFixed, MapPin, X } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { KUWAIT_BOUNDS, MAP_TILES, centreFor, cleanPin, formatPin, mapsLink, pinProblem, type Pin } from "@shared/commerce/geo";
import type { MessageKey } from "@shared/i18n/dictionary";

export function PinPicker({ value, onChange, governorate }: {
  value: Pin | null;
  onChange: (pin: Pin | null) => void;
  /** Where to open the map when there is no pin yet. */
  governorate?: string | null;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /*
   * Every press here replaces the control that was pressed — the map closes,
   * the pin is removed — so focus would otherwise fall to `<body>` and a
   * keyboard would start again from the top of checkout. Whatever the summary
   * shows next takes it instead.
   */
  const summary = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!open && refocus.current) {
      refocus.current = false;
      summary.current?.focus();
    }
  });
  const close = () => { refocus.current = true; setOpen(false); };

  if (open) {
    return (
      <PinMap
        start={value ?? centreFor(governorate)}
        zoom={value ? 17 : 12}
        onPin={pin => { onChange(pin); close(); }}
        onCancel={close}
      />
    );
  }

  return (
    <div className="rounded-2xl border border-[#d5dfeb] bg-white p-4">
      {value ? (
        <>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-extrabold text-[#0a285a]">
            <MapPin className="size-4 ink-accent" aria-hidden />
            {t("pin.pinned")}
            <bdi dir="ltr" className="text-[12px] font-bold ink-muted">{formatPin(value)}</bdi>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button ref={summary} type="button" onClick={() => setOpen(true)} className="glass pressable type-control rounded-full px-4 py-2">
              {t("pin.move")}
            </button>
            <button type="button" onClick={() => { refocus.current = true; onChange(null); }} className="glass pressable type-control rounded-full px-4 py-2">
              {t("pin.remove")}
            </button>
            <a href={mapsLink(value)} target="_blank" rel="noopener noreferrer" className="text-[12px] font-extrabold ink-accent underline underline-offset-2">
              {t("pin.check")}
            </a>
          </div>
        </>
      ) : (
        <>
          <button ref={summary} type="button" onClick={() => setOpen(true)} className="glass pressable type-control inline-flex items-center gap-2 rounded-full px-4 py-2">
            <MapPin className="size-4" aria-hidden />
            {t("pin.drop")}
          </button>
          <p className="mt-2 text-[11px] leading-5 ink-muted">{t("pin.why")}</p>
        </>
      )}
    </div>
  );
}

type Status = { key: MessageKey; tone: "info" | "problem" } | null;

function PinMap({ start, zoom, onPin, onCancel }: {
  start: Pin;
  zoom: number;
  onPin: (pin: Pin) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const [centre, setCentre] = useState<Pin>(start);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [status, setStatus] = useState<Status>(null);
  const canLocate = typeof navigator !== "undefined" && "geolocation" in navigator;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: L }] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
        if (cancelled || !node.current) return;
        const { south, north, west, east } = KUWAIT_BOUNDS;
        const created = L.map(node.current, {
          center: [start.lat, start.lng],
          zoom,
          minZoom: 8,
          /* A little past the border, so a pin at the edge of the country is
             still in the middle of the map rather than pressed into a corner. */
          maxBounds: L.latLngBounds([south - 0.3, west - 0.3], [north + 0.3, east + 0.3]),
        });
        L.tileLayer(MAP_TILES, {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(created);
        created.on("move", () => {
          const at = created.getCenter();
          setCentre({ lat: at.lat, lng: at.lng });
        });
        created.on("click", event => created.panTo(event.latlng));
        map.current = created;
        setState("ready");
        /* The button that opened this is gone, so the map takes focus: it is
           what the keyboard came here to move, and its label says how. */
        node.current.focus();
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    /* Opened once per showing; the start is where it opens, not a binding. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locate = () => {
    setStatus({ key: "pin.locating", tone: "info" });
    navigator.geolocation.getCurrentPosition(
      position => {
        const here = { lat: position.coords.latitude, lng: position.coords.longitude };
        /* Somebody abroad asking for their own location gets told why the map
           did not go there, rather than a map that silently refuses to move. */
        if (pinProblem(here)) {
          setStatus({ key: "address.pinOutsideKuwait", tone: "problem" });
          return;
        }
        map.current?.setView([here.lat, here.lng], 18);
        setStatus(null);
      },
      error => setStatus({ key: error.code === error.PERMISSION_DENIED ? "pin.denied" : "pin.notFound", tone: "problem" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const confirm = () => {
    const problem = pinProblem(centre);
    if (problem) {
      setStatus({ key: problem, tone: "problem" });
      return;
    }
    onPin(cleanPin(centre));
  };

  return (
    <div className="rounded-2xl border border-[#d5dfeb] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p id={hintId} className="text-[12px] leading-5 text-[#0a285a]">{t("pin.howTo")}</p>
        <button type="button" onClick={onCancel} aria-label={t("pin.cancel")} className="glass pressable grid size-9 shrink-0 place-items-center rounded-full">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* `isolate`, because Leaflet's panes and controls carry z-indexes up to
          a thousand and would otherwise draw over the sticky header. */}
      <div className="relative isolate mt-3 h-[280px] overflow-hidden rounded-xl bg-[#e7edf5]">
        <div
          ref={node}
          role="application"
          aria-label={t("pin.mapLabel")}
          aria-describedby={hintId}
          className="netlet-map size-full"
        />
        {state === "ready" ? (
          /* The pin is the middle of the map; its point, not its body, marks
             the spot, so it sits a full height above the centre. */
          <MapPin
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 z-[500] size-9 -translate-x-1/2 -translate-y-full fill-[#f2683a] text-[#0a285a] drop-shadow"
          />
        ) : (
          <p role="status" className="absolute inset-0 grid place-items-center p-6 text-center text-[12px] font-bold text-[#0a285a]">
            {t(state === "loading" ? "pin.loading" : "pin.failed")}
          </p>
        )}
      </div>

      <p className="mt-2 text-[11px] ink-muted">
        <bdi dir="ltr">{formatPin(centre)}</bdi>
      </p>

      {status ? (
        <p role={status.tone === "problem" ? "alert" : "status"} className={`mt-2 text-[12px] font-bold ${status.tone === "problem" ? "text-[#8c2f22]" : "text-[#0a285a]"}`}>
          {t(status.key)}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={confirm} disabled={state !== "ready"} className="glass-navy pressable type-control rounded-full px-5 py-2 disabled:opacity-50">
          {t("pin.confirm")}
        </button>
        {canLocate ? (
          <button type="button" onClick={locate} disabled={state !== "ready"} className="glass pressable type-control inline-flex items-center gap-2 rounded-full px-4 py-2 disabled:opacity-50">
            <LocateFixed className="size-4" aria-hidden />
            {t("pin.useLocation")}
          </button>
        ) : null}
        <button type="button" onClick={onCancel} className="glass pressable type-control rounded-full px-4 py-2">
          {t("pin.cancel")}
        </button>
      </div>
    </div>
  );
}
