/**
 * Drop a pin for an address (3.2.7), and have the address read from it.
 *
 * Optional, always, and the panel says so: a typed address is what an order
 * cannot exist without, and somebody who refuses location access, whose
 * connection never draws the tiles, or who would rather not say where they
 * live must still be able to buy something. The pin is what saves the driver's
 * phone call from the end of the road; it is never a gate.
 *
 * ## The map moves, the pin stays still — and lifts while it does
 *
 * The pin is drawn over the middle of the map and the shopper moves the map
 * under it, rather than dragging a marker. Dragging a 30px marker with a thumb
 * is the hard way on a phone, and a draggable marker has no keyboard story at
 * all — whereas a focused map already pans with the arrow keys and zooms with
 * plus and minus, so "move the map until the pin is on your door, then press
 * the button" is one instruction that works for a finger, a mouse and a
 * keyboard alike. A tap on the map brings that spot to the middle.
 *
 * **While the map moves the pin lifts off it, and when the map stops it drops
 * into place with a small bounce, a ring where it landed and a buzz** — on the
 * owner's word, the buzz at three quarters strength (`pinDropHaptic`). It is
 * how a shopper feels which spot was taken. Under reduced motion it neither
 * lifts nor bounces.
 *
 * ## The address is read where the pin drops
 *
 * Once the map has rested a moment, `maps.placeAt` reads the area, block,
 * street and house at the pin (`Shared/commerce/placeParts.ts`), and a bubble
 * over the pin says it — so the shopper sees the address the form is about to
 * be filled with before pressing anything. "Pin it here" hands the pin and
 * that address to the form, waiting a moment for an answer still on its way.
 * A service with no answer is said plainly, and the boxes are the shopper's to
 * fill, as they always were.
 *
 * ## Google's map or Apple's, as the shopper prefers
 *
 * People here use both, and the map you already know is the one you can find
 * your own roof on. So the picker offers whichever of the two is set up
 * (`maps.providers`), as two buttons over the map, opens on the one this device
 * chose last (or Apple's on an Apple device and Google's elsewhere), and a
 * switch keeps the spot and the zoom. With neither it is OpenStreetMap, which
 * needs no account. `engines.ts` draws all three behind one shape.
 *
 * ## Loaded when the map opens, not before
 *
 * A map's library is fetched the first time somebody opens it, not with the
 * page. A map that fails to load says the typed address is enough, and offers
 * the other map when there is one, rather than leaving a grey box.
 */
import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, LocateFixed, MapPin, Move, X } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { readStored, writeStored } from "@/lib/browserStore";
import { pinDropHaptic } from "@/lib/haptics";
import { centreFor, cleanPin, formatPin, mapsLink, pinProblem, type Pin } from "@shared/commerce/geo";
import { composeAddressLine } from "@shared/commerce/kuwaitAddress";
import type { PlaceAnswer } from "@shared/commerce/placeParts";
import type { MessageKey } from "@shared/i18n/dictionary";
import { mountMap, type MapEngine, type MapHandle } from "./engines";

/** Which of the two maps this device chose last. A convenience, so browser storage. */
const ENGINE_KEY = "netlet:mapEngine";
/** How long the map must rest before its address is asked for: a drag pauses, then goes on. */
const READ_AFTER_MS = 350;
/** How long "Pin it here" waits for an address still on its way, before going on without it. */
const PIN_WAIT_MS = 4000;

/** The map somebody probably knows: Apple's on an Apple device, Google's elsewhere. */
function preferredEngine(offered: MapEngine[]): MapEngine {
  const stored = readStored(ENGINE_KEY) as MapEngine | null;
  if (stored && offered.includes(stored)) return stored;
  const apple = typeof navigator !== "undefined" && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  if (apple && offered.includes("apple")) return "apple";
  return offered[0];
}

/**
 * Which map to draw: the shopper's choice, else the one they probably know,
 * else OpenStreetMap. Null until `maps.providers` has answered.
 */
export function useMapEngine(chosen: MapEngine | null = null) {
  /* A failed question is no maps of either kind, which is the OpenStreetMap
     fallback rather than no map at all. */
  const providers = trpc.maps.providers.useQuery(undefined, { staleTime: Infinity, retry: false });
  const settled = providers.isSuccess || providers.isError;
  const offered: MapEngine[] = providers.data
    ? [...(providers.data.google ? (["google"] as const) : []), ...(providers.data.apple ? (["apple"] as const) : [])]
    : [];
  const engine: MapEngine | null = !settled ? null : offered.length === 0 ? "osm" : chosen && offered.includes(chosen) ? chosen : preferredEngine(offered);
  return { engine, offered, googleKey: providers.data?.google ?? null };
}

/** The address a place answer names, as one line in the page's language. */
export function placeLine(place: PlaceAnswer | null | undefined, arabic: boolean): string {
  return place ? composeAddressLine(place.parts, arabic) : "";
}

/**
 * The pin itself: the orange map pin whose point marks the spot, its shadow,
 * and a ring where it lands. Positioned by its point at the middle of whatever box
 * holds it.
 */
export function PinMark({ lifted = false, drop = 0 }: { lifted?: boolean; drop?: number }) {
  return (
    <span aria-hidden className="map-pin" data-lifted={lifted || undefined} data-dropped={drop > 0 || undefined}>
      <span className="map-pin-shadow" />
      {drop > 0 ? <span key={`ring-${drop}`} className="map-pin-ring" /> : null}
      {/* The pin as it was before it learnt to lift and drop, on the owner's
          word: the orange map pin with the navy line. */}
      <span key={`body-${drop}`} className="map-pin-body">
        <MapPin className="size-9 fill-[#f2683a] text-[#0a285a]" />
      </span>
    </span>
  );
}

export function PinPicker({ value, place, onChange, governorate }: {
  value: Pin | null;
  /** What was read at the pin, when it was dropped here. */
  place?: PlaceAnswer | null;
  /** The pin, and what was read there (null when nothing could be). */
  onChange: (pin: Pin | null, place: PlaceAnswer | null) => void;
  /** Where to open the map when there is no pin yet. */
  governorate?: string | null;
}) {
  const { t, isArabic } = useTranslation();
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
        locateOnOpen={!value}
        onPin={(pin, read) => { onChange(pin, read); close(); }}
        onCancel={close}
      />
    );
  }

  const line = placeLine(place, isArabic);
  return (
    <div className="rounded-2xl border border-[#d5dfeb] bg-white p-4">
      {value ? (
        <>
          {/* Where the address was saved, on a still map — on the owner's
              word — and a press on it opens the map at the pin to move it.
              The press is for the eye and the finger: "Move the pin" below is
              the same act for a keyboard and a screen reader, the card
              photo's rule, so the map adds no second stop. */}
          <div className="relative mb-3">
            <StillMap pin={value} className="h-44 sm:h-48" />
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => setOpen(true)}
              className="map-preview-press absolute inset-0 rounded-2xl"
            >
              <span className="absolute inset-x-2 top-2 flex justify-center">
                <span className="map-preview-hint inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-center text-[12px] font-extrabold leading-4 text-[#0a285a] shadow-[0_2px_10px_rgba(10,40,90,0.18)]">
                  <Move className="size-3.5 shrink-0" aria-hidden />
                  {t("pin.tapToMove")}
                </span>
              </span>
            </button>
          </div>
          <p className="flex items-start gap-2 text-[13px] font-extrabold text-[#0a285a]">
            <MapPin className="mt-0.5 size-4 shrink-0 ink-accent" aria-hidden />
            {line ? (
              <span>{t("pin.pinnedAt", { place: `\u2068${line}\u2069` })}</span>
            ) : (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {t("pin.pinned")}
                <bdi dir="ltr" className="text-[12px] font-bold ink-muted">{formatPin(value)}</bdi>
              </span>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button ref={summary} type="button" onClick={() => setOpen(true)} className="glass pressable type-control rounded-full px-4 py-2">
              {t("pin.move")}
            </button>
            <button type="button" onClick={() => { refocus.current = true; onChange(null, null); }} className="glass pressable type-control rounded-full px-4 py-2">
              {t("pin.remove")}
            </button>
            <a href={mapsLink(value)} target="_blank" rel="noopener noreferrer" className="text-[12px] font-extrabold ink-accent underline underline-offset-2">
              {t("pin.check")}
            </a>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#fdeee7]">
            <MapPin className="size-5 ink-accent" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-extrabold text-[#0a285a]">{t("pin.findTitle")}</p>
            <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t("pin.findNote")}</p>
            <button ref={summary} type="button" onClick={() => setOpen(true)} className="glass-navy pressable type-control mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2">
              <MapPin className="size-4" aria-hidden />
              {t("pin.drop")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Status = { key: MessageKey; tone: "info" | "problem" } | null;
type Reading =
  | { key: string; state: "reading" }
  | { key: string; state: "read"; place: PlaceAnswer | null }
  | { key: string; state: "failed"; message: MessageKey };

const keyOf = (pin: Pin) => formatPin(cleanPin(pin));

function PinMap({ start, zoom, locateOnOpen = false, onPin, onCancel }: {
  start: Pin;
  zoom: number;
  /** Ask for the shopper's location as the map opens — a new pin, never one being moved. */
  locateOnOpen?: boolean;
  onPin: (pin: Pin, place: PlaceAnswer | null) => void;
  onCancel: () => void;
}) {
  const { t, locale, isArabic } = useTranslation();
  const utils = trpc.useUtils();
  const hintId = useId();
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<MapHandle | null>(null);
  /* Where the map is, kept outside React's state too, so a switch from one
     map to the other opens on the same spot at the same zoom. */
  const view = useRef({ centre: start, zoom });
  const [centre, setCentre] = useState<Pin>(start);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [status, setStatus] = useState<Status>(null);
  const [lifted, setLifted] = useState(false);
  const [drop, setDrop] = useState(0);
  const [reading, setReading] = useState<Reading | null>(null);
  const [pinning, setPinning] = useState(false);
  const readyAt = useRef(0);
  const readTimer = useRef<number | undefined>(undefined);
  const canLocate = typeof navigator !== "undefined" && "geolocation" in navigator;

  const [chosen, setChosen] = useState<MapEngine | null>(null);
  const { engine, offered, googleKey } = useMapEngine(chosen);

  /** The address at `pin`, asked once per spot; the cache answers a repeat. */
  const read = (pin: Pin): Promise<PlaceAnswer | null> => {
    const clean = cleanPin(pin);
    return utils.maps.placeAt.fetch({ lat: clean.lat, lng: clean.lng, locale }, { staleTime: Infinity, retry: false });
  };

  const readAt = (pin: Pin) => {
    const key = keyOf(pin);
    setReading({ key, state: "reading" });
    read(pin)
      .then(place => setReading(now => (now?.key === key ? { key, state: "read", place } : now)))
      .catch((error: unknown) => {
        const message: MessageKey = error instanceof Error && error.message === "pin.lookupTooMany" ? "pin.lookupTooMany" : "pin.lookupFailed";
        setReading(now => (now?.key === key ? { key, state: "failed", message } : now));
      });
  };

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
      onMoveStart: () => {
        window.clearTimeout(readTimer.current);
        setLifted(true);
      },
      onSettle: at => {
        view.current.centre = at;
        setCentre(at);
        setLifted(false);
        setDrop(count => count + 1);
        /* A map settling as it first draws is not a drop the shopper made. */
        if (readyAt.current && Date.now() - readyAt.current > 400) pinDropHaptic();
        window.clearTimeout(readTimer.current);
        readTimer.current = window.setTimeout(() => readAt(at), READ_AFTER_MS);
      },
      onBroken: () => { if (!cancelled) setState("failed"); },
    }, googleKey)
      .then(handle => {
        if (cancelled) { handle.destroy(); return; }
        mounted = handle;
        map.current = handle;
        readyAt.current = Date.now();
        setState("ready");
        /* The spot it opens on is read too: a pin being moved starts from its address. */
        readAt(view.current.centre);
        /* The button that opened this is gone, so the map takes focus: it is
           what the keyboard came here to move, and its label says how. Google
           and Apple draw their own focusable surface a moment after mounting. */
        window.setTimeout(() => { if (!cancelled) handle.focusTarget()?.focus(); }, 300);
      })
      .catch(() => { if (!cancelled) setState("failed"); });
    return () => {
      cancelled = true;
      window.clearTimeout(readTimer.current);
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

  /*
   * A new pin starts where the shopper is, on the owner's word: the map asks
   * for the location once, as soon as it has drawn, so the browser's own
   * question comes with the map rather than behind a button. A pin being
   * moved opens on itself and asks nothing — jumping to wherever the shopper
   * happens to be would carry it away from the address. Refused, it says so
   * and the map stays where it opened; "Use my location" asks again.
   */
  const askedOnOpen = useRef(false);
  useEffect(() => {
    if (state !== "ready" || !locateOnOpen || !canLocate || askedOnOpen.current) return;
    askedOnOpen.current = true;
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const confirm = async () => {
    const problem = pinProblem(centre);
    if (problem) {
      setStatus({ key: problem, tone: "problem" });
      return;
    }
    const pin = cleanPin(centre);
    if (reading?.key === keyOf(pin) && reading.state === "read") {
      onPin(pin, reading.place);
      return;
    }
    if (reading?.key === keyOf(pin) && reading.state === "failed") {
      onPin(pin, null);
      return;
    }
    /* The address for this spot is still on its way: wait a moment for it
       rather than hand the form a pin with nothing read. */
    setPinning(true);
    const place = await Promise.race([
      read(pin).catch(() => null),
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), PIN_WAIT_MS)),
    ]);
    setPinning(false);
    onPin(pin, place);
  };

  const here = keyOf(centre);
  const current = reading && reading.key === here ? reading : null;
  const found = current?.state === "read" ? current.place : null;
  const line = placeLine(found, isArabic);
  const bubble: { text: string; busy?: boolean; muted?: boolean } | null = lifted || state !== "ready"
    ? null
    : !current || current.state === "reading"
      ? { text: t("pin.finding"), busy: true }
      : current.state === "failed"
        ? { text: t(current.message), muted: true }
        : line
          ? { text: line }
          : { text: t("pin.nothingHere"), muted: true };

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
      <div className="relative isolate mt-3 h-[300px] overflow-hidden rounded-xl bg-[#e7edf5] sm:h-[340px]">
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
          <>
            <PinMark lifted={lifted} drop={drop} />
            {/* What is at the pin, over it. Hidden while the map moves, since
                it would name a spot the pin has already left. */}
            <div
              role="status"
              className={`map-pin-bubble ${bubble ? "" : "opacity-0"}`}
            >
              {bubble ? (
                <span className={`flex items-center gap-2 ${bubble.muted ? "font-semibold text-[#536b8c]" : "font-extrabold text-[#0a285a]"}`}>
                  {bubble.busy ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
                  <bdi className="line-clamp-2">{bubble.text}</bdi>
                </span>
              ) : null}
            </div>
          </>
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

      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] ink-muted">
        {found ? <span>{t(found.source === "apple" ? "pin.fromApple" : "pin.fromOsm")}</span> : null}
        {found ? <span aria-hidden>·</span> : null}
        <bdi dir="ltr">{formatPin(centre)}</bdi>
      </p>

      {status ? (
        <p role={status.tone === "problem" ? "alert" : "status"} className={`mt-2 text-[12px] font-bold ${status.tone === "problem" ? "text-[#8c2f22]" : "text-[#0a285a]"}`}>
          {t(status.key)}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={confirm} disabled={state !== "ready" || pinning || lifted} className="glass-navy pressable type-control inline-flex items-center gap-2 rounded-full px-5 py-2 disabled:opacity-50">
          {pinning ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t(pinning ? "pin.pinning" : "pin.confirm")}
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

/**
 * The pin on a map that does not move — what "Is this your address?" shows.
 * A named group rather than one picture, because the map carries its makers'
 * credit as links, and a picture may hold no link.
 */
export function StillMap({ pin, className = "" }: { pin: Pin; className?: string }) {
  const { t, locale } = useTranslation();
  const { lat, lng } = pin;
  const node = useRef<HTMLDivElement>(null);
  const { engine, googleKey } = useMapEngine();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!engine || !node.current) return;
    let cancelled = false;
    let mounted: MapHandle | null = null;
    mountMap(engine, { node: node.current, start: { lat, lng }, zoom: 17, locale, still: true, onMove: () => {}, onBroken: () => {} }, googleKey)
      .then(handle => {
        if (cancelled) { handle.destroy(); return; }
        mounted = handle;
        setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      mounted?.destroy();
    };
  }, [engine, googleKey, locale, lat, lng]);

  return (
    <div role="group" aria-label={t("address.confirmMap")} className={`relative isolate overflow-hidden rounded-2xl bg-[#e7edf5] ${className}`}>
      <div key={engine ?? "none"} ref={node} className="netlet-map size-full" />
      {ready ? <PinMark /> : null}
    </div>
  );
}
