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
 * ## Google's map or Apple's, as the shopper prefers
 *
 * People here use both — an iPhone opens Apple Maps for an address, most
 * Android phones open Google's — and the map you already know is the one you
 * can find your own roof on. So the picker offers whichever of the two is set
 * up (`maps.providers`), as two buttons over the map, opens on the one this
 * device chose last (or Apple's on an Apple device and Google's elsewhere), and
 * a switch keeps the spot and the zoom. With neither set up it is
 * OpenStreetMap, which needs no account, so the pin works before either does.
 * `engines.ts` draws all three behind one shape.
 *
 * ## Loaded when the map opens, not before
 *
 * The picker is closed on nearly every visit to checkout — most shoppers pick a
 * saved address or never touch it — so a map's library is fetched the first
 * time somebody opens it, not with the page. A map that fails to load says the
 * typed address is enough, and offers the other map when there is one, rather
 * than leaving a grey box.
 */
import { useEffect, useId, useRef, useState } from "react";
import { LocateFixed, MapPin, X } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { readStored, writeStored } from "@/lib/browserStore";
import { centreFor, cleanPin, formatPin, mapsLink, pinProblem, type Pin } from "@shared/commerce/geo";
import type { MessageKey } from "@shared/i18n/dictionary";
import { mountMap, type MapEngine, type MapHandle } from "./engines";

/** Which of the two maps this device chose last. A convenience, so browser storage. */
const ENGINE_KEY = "netlet:mapEngine";

/** The map somebody probably knows: Apple's on an Apple device, Google's elsewhere. */
function preferredEngine(offered: MapEngine[]): MapEngine {
  const stored = readStored(ENGINE_KEY) as MapEngine | null;
  if (stored && offered.includes(stored)) return stored;
  const apple = typeof navigator !== "undefined" && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  if (apple && offered.includes("apple")) return "apple";
  return offered[0];
}

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
  const { t, locale } = useTranslation();
  const hintId = useId();
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<MapHandle | null>(null);
  /* Where the map is, kept outside React's state too, so a switch from one
     map to the other opens on the same spot at the same zoom. */
  const view = useRef({ centre: start, zoom });
  const [centre, setCentre] = useState<Pin>(start);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [status, setStatus] = useState<Status>(null);
  const canLocate = typeof navigator !== "undefined" && "geolocation" in navigator;

  /* What can be offered. A failed question is no maps of either kind, which
     is the OpenStreetMap fallback rather than no map at all. */
  const providers = trpc.maps.providers.useQuery(undefined, { staleTime: Infinity, retry: false });
  const settled = providers.isSuccess || providers.isError;
  const offered: MapEngine[] = providers.data
    ? [...(providers.data.google ? (["google"] as const) : []), ...(providers.data.apple ? (["apple"] as const) : [])]
    : [];
  const [chosen, setChosen] = useState<MapEngine | null>(null);
  const engine: MapEngine | null = !settled ? null : offered.length === 0 ? "osm" : chosen && offered.includes(chosen) ? chosen : preferredEngine(offered);
  const googleKey = providers.data?.google ?? null;

  useEffect(() => {
    if (!engine || !node.current) return;
    let cancelled = false;
    let mounted: MapHandle | null = null;
    setState("loading");
    setStatus(null);
    mountMap(engine, {
      node: node.current,
      start: view.current.centre,
      zoom: view.current.zoom,
      locale,
      onMove: at => {
        view.current.centre = at;
        setCentre(at);
      },
      onBroken: () => { if (!cancelled) setState("failed"); },
    }, googleKey)
      .then(handle => {
        if (cancelled) { handle.destroy(); return; }
        mounted = handle;
        map.current = handle;
        setState("ready");
        /* The button that opened this is gone, so the map takes focus: it is
           what the keyboard came here to move, and its label says how. Google
           and Apple draw their own focusable surface a moment after mounting. */
        window.setTimeout(() => { if (!cancelled) handle.focusTarget()?.focus(); }, 300);
      })
      .catch(() => { if (!cancelled) setState("failed"); });
    return () => {
      cancelled = true;
      if (mounted) view.current.zoom = mounted.zoom();
      mounted?.destroy();
      map.current = null;
    };
    /* Mounted once per map; where it opens is read from `view`, not watched. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  /* A map that will not load leaves nothing to focus where it was: the way
     out takes it — the other map if there is one, else closing. */
  const recovery = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (state === "failed") (recovery.current ?? closeButton.current)?.focus();
  }, [state]);

  const choose = (next: MapEngine) => {
    writeStored(ENGINE_KEY, next);
    setChosen(next);
  };
  const other = offered.find(name => name !== engine);

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
        map.current?.setView(here, 18);
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
        <button ref={closeButton} type="button" onClick={onCancel} aria-label={t("pin.cancel")} className="glass pressable grid size-9 shrink-0 place-items-center rounded-full">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* The two maps, when there are two to choose between. A switch, not a
          tab list: it changes how the one map is drawn. */}
      {offered.length > 1 ? (
        <div role="group" aria-label={t("pin.mapChoice")} className="mt-3 inline-flex rounded-full border border-[#d5dfeb] bg-[#f6f7f9] p-1">
          {offered.map(name => (
            <button
              key={name}
              type="button"
              aria-pressed={engine === name}
              onClick={() => choose(name)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-bold transition ${engine === name ? "bg-[#0a285a] text-white" : "text-[#0a285a] hover:bg-[#0a285a]/[.06]"}`}
            >
              {t(name === "google" ? "pin.google" : "pin.apple")}
            </button>
          ))}
        </div>
      ) : null}

      {/* `isolate`, because Leaflet's panes and controls carry z-indexes up to
          a thousand and would otherwise draw over the sticky header. */}
      <div className="relative isolate mt-3 h-[280px] overflow-hidden rounded-xl bg-[#e7edf5]">
        {/* Keyed by the map, so a switch starts from an empty box rather
            than one the last library still holds. */}
        <div
          key={engine ?? "none"}
          ref={node}
          role={engine === "osm" ? "application" : "group"}
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
          <div role="status" className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <p className="text-[12px] font-bold text-[#0a285a]">{t(state === "loading" ? "pin.loading" : "pin.failed")}</p>
              {state === "failed" && other ? (
                <button ref={recovery} type="button" onClick={() => choose(other)} className="glass pressable type-control mt-3 rounded-full px-4 py-2">
                  {t(other === "google" ? "pin.tryGoogle" : "pin.tryApple")}
                </button>
              ) : null}
            </div>
          </div>
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
