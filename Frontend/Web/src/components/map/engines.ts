/// <reference types="google.maps" />
/**
 * The three maps the pin picker can draw, behind one small shape.
 *
 * Google's and Apple's are the two a shopper chooses between (each only while
 * its keys are set, `maps.providers`); OpenStreetMap is the fallback when
 * neither is, so the pin works before either account exists. The picker never
 * knows which it has: it mounts one, hears where the middle of the map is as
 * it moves, and moves it — the same three things for all of them, which is what
 * keeps "move the map until the pin is on your door" one instruction whatever
 * the map.
 *
 * Every library is fetched the first time a map of its kind opens, not with
 * the page: the picker is closed on nearly every visit to checkout.
 */
import type { Map as LeafletMap } from "leaflet";
import { KUWAIT_BOUNDS, MAP_TILES, type Pin } from "@shared/commerce/geo";
import { appPath } from "@/lib/basePath";

export type MapEngine = "google" | "apple" | "osm";

export type MapHandle = {
  /** Moves the map so `pin` is in the middle, at roughly this zoom. */
  setView: (pin: Pin, zoom: number) => void;
  /** The zoom it is at now, as a web-map zoom level, so a switch keeps it. */
  zoom: () => number;
  /** What the keyboard should land on: the map's own focusable surface. */
  focusTarget: () => HTMLElement | null;
  destroy: () => void;
};

export type MountOptions = {
  node: HTMLElement;
  start: Pin;
  zoom: number;
  locale: "en" | "ar";
  /** The middle of the map, as it moves. */
  onMove: (centre: Pin) => void;
  /** The map has started to move — a drag, a zoom, the keyboard, or `setView`. The pin lifts. */
  onMoveStart?: () => void;
  /** The map has come to rest with this in the middle. The pin drops, and the address is read. */
  onSettle?: (centre: Pin) => void;
  /** The provider refused after drawing — a key it does not accept. */
  onBroken: () => void;
  /** A picture of the spot that does not move: no gestures, no controls, no keyboard stop. */
  still?: boolean;
};

/* A little past the border, so a pin at the edge of the country is still in
   the middle of the map rather than pressed into a corner. */
const MARGIN = 0.3;
const BOUNDS = {
  south: KUWAIT_BOUNDS.south - MARGIN,
  north: KUWAIT_BOUNDS.north + MARGIN,
  west: KUWAIT_BOUNDS.west - MARGIN,
  east: KUWAIT_BOUNDS.east + MARGIN,
};
const MIN_ZOOM = 8;

/** One script tag per library, shared by every picker that opens. */
function loadScript(src: string, attributes: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`${src} did not load`));
    };
    document.head.appendChild(script);
  });
}

const firstFocusable = (node: HTMLElement) =>
  node.querySelector<HTMLElement>('[tabindex="0"]') ?? node;

/* ------------------------------------------------------------- Google --- */

let googleLoading: Promise<void> | null = null;
const googleBroken = new Set<() => void>();

function loadGoogle(key: string, locale: string): Promise<void> {
  if (typeof (window as { google?: { maps?: { importLibrary?: unknown } } }).google?.maps?.importLibrary === "function") return Promise.resolve();
  if (googleLoading) return googleLoading;
  const w = window as unknown as Record<string, unknown>;
  /* Google calls this when it refuses the key — after the script has loaded
     and the map has drawn its grey "can't load" box. */
  w.gm_authFailure = () => googleBroken.forEach(report => report());
  googleLoading = new Promise<void>((resolve, reject) => {
    w.__netletGoogleMaps = () => resolve();
    loadScript(
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=${locale}&region=KW&loading=async&callback=__netletGoogleMaps`,
    ).catch(error => {
      googleLoading = null;
      reject(error);
    });
  });
  return googleLoading;
}

export async function mountGoogle(options: MountOptions, key: string): Promise<MapHandle> {
  await loadGoogle(key, options.locale);
  const { Map } = (await google.maps.importLibrary("maps")) as google.maps.MapsLibrary;
  googleBroken.add(options.onBroken);

  const map = new Map(options.node, {
    center: options.start,
    zoom: options.zoom,
    minZoom: MIN_ZOOM,
    restriction: { latLngBounds: BOUNDS, strictBounds: false },
    /* One finger moves it, as the other two maps do: this box is the map and
       nothing else, so there is no page to scroll by mistake inside it. */
    gestureHandling: options.still ? "none" : "greedy",
    clickableIcons: false,
    streetViewControl: false,
    fullscreenControl: false,
    disableDefaultUI: options.still,
    /* The satellite view is how somebody finds their own roof. */
    mapTypeControl: !options.still,
    mapTypeControlOptions: { mapTypeIds: ["roadmap", "hybrid"] },
    keyboardShortcuts: !options.still,
  });
  /* Google says "idle" once a move of any kind is over, and nothing when one
     starts but the centre changing — so the first change after a rest is the start. */
  let moving = false;
  map.addListener("center_changed", () => {
    const centre = map.getCenter();
    if (!centre) return;
    if (!moving) {
      moving = true;
      options.onMoveStart?.();
    }
    options.onMove({ lat: centre.lat(), lng: centre.lng() });
  });
  map.addListener("zoom_changed", () => {
    if (!moving) {
      moving = true;
      options.onMoveStart?.();
    }
  });
  map.addListener("idle", () => {
    const centre = map.getCenter();
    if (!moving || !centre) return;
    moving = false;
    options.onSettle?.({ lat: centre.lat(), lng: centre.lng() });
  });
  map.addListener("click", (event: google.maps.MapMouseEvent) => {
    if (event.latLng && !options.still) map.panTo(event.latLng);
  });

  return {
    setView: (pin, zoom) => { map.setCenter(pin); map.setZoom(zoom); },
    zoom: () => map.getZoom() ?? options.zoom,
    focusTarget: () => firstFocusable(options.node),
    destroy: () => {
      googleBroken.delete(options.onBroken);
      google.maps.event.clearInstanceListeners(map);
      options.node.replaceChildren();
    },
  };
}

/* -------------------------------------------------------------- Apple --- */

/* The handful of MapKit JS this uses. There is no published type package. */
type MapKitCoordinate = { latitude: number; longitude: number };
type MapKitRegion = { center: MapKitCoordinate; span: { latitudeDelta: number; longitudeDelta: number } };
type MapKitMap = {
  center: MapKitCoordinate;
  region: MapKitRegion;
  setRegionAnimated: (region: MapKitRegion, animate?: boolean) => void;
  setCenterAnimated: (centre: MapKitCoordinate, animate?: boolean) => void;
  convertPointOnPageToCoordinate: (point: unknown) => MapKitCoordinate;
  addEventListener: (type: string, listener: (event: { pointOnPage?: unknown }) => void) => void;
  destroy: () => void;
};
type MapKit = {
  init: (options: { authorizationCallback: (done: (token: string) => void) => void; language?: string }) => void;
  language: string;
  addEventListener: (type: string, listener: (event: { status?: string }) => void) => void;
  Map: new (node: HTMLElement, options: Record<string, unknown>) => MapKitMap;
  Coordinate: new (latitude: number, longitude: number) => MapKitCoordinate;
  CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => MapKitRegion["span"];
  CoordinateRegion: new (center: MapKitCoordinate, span: MapKitRegion["span"]) => MapKitRegion;
  FeatureVisibility: { Hidden: string; Visible: string; Adaptive: string };
  MapType: { Standard: string; Hybrid: string };
};

let appleLoading: Promise<MapKit> | null = null;
const appleBroken = new Set<() => void>();

function loadApple(locale: string): Promise<MapKit> {
  const w = window as unknown as { mapkit?: MapKit; __netletMapKit?: () => void };
  if (appleLoading) {
    return appleLoading.then(mapkit => {
      mapkit.language = locale;
      return mapkit;
    });
  }
  appleLoading = new Promise<MapKit>((resolve, reject) => {
    w.__netletMapKit = () => {
      const mapkit = w.mapkit!;
      mapkit.init({
        /* The token is signed by NetLet's server for this origin, so Apple's
           private key never comes near the page. */
        authorizationCallback: done => {
          fetch(appPath("/api/maps/apple-token"), { credentials: "same-origin" })
            .then(response => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
            .then(done)
            .catch(() => appleBroken.forEach(report => report()));
        },
        language: locale,
      });
      mapkit.addEventListener("error", () => appleBroken.forEach(report => report()));
      resolve(mapkit);
    };
    loadScript("https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.core.js", {
      crossorigin: "anonymous",
      "data-callback": "__netletMapKit",
      "data-libraries": "map",
    }).catch(error => {
      appleLoading = null;
      reject(error);
    });
  });
  return appleLoading;
}

/*
 * MapKit speaks in regions rather than zoom levels. On a web map one 256px
 * tile spans 360 / 2^zoom degrees of longitude, so a box `width` pixels across
 * spans that many tiles' worth, and back again.
 */
function regionFor(mapkit: MapKit, pin: Pin, zoom: number, node: HTMLElement): MapKitRegion {
  const width = node.clientWidth || 400;
  const height = node.clientHeight || 280;
  const longitudeDelta = (360 / 2 ** zoom) * (width / 256);
  const latitudeDelta = longitudeDelta * (height / width) * Math.cos((pin.lat * Math.PI) / 180);
  return new mapkit.CoordinateRegion(new mapkit.Coordinate(pin.lat, pin.lng), new mapkit.CoordinateSpan(latitudeDelta, longitudeDelta));
}

function zoomOf(region: MapKitRegion, node: HTMLElement): number {
  const width = node.clientWidth || 400;
  return Math.log2((360 * width) / 256 / region.span.longitudeDelta);
}

export async function mountApple(options: MountOptions): Promise<MapHandle> {
  const mapkit = await loadApple(options.locale);
  appleBroken.add(options.onBroken);

  const boundary = new mapkit.CoordinateRegion(
    new mapkit.Coordinate((BOUNDS.north + BOUNDS.south) / 2, (BOUNDS.east + BOUNDS.west) / 2),
    new mapkit.CoordinateSpan(BOUNDS.north - BOUNDS.south, BOUNDS.east - BOUNDS.west),
  );
  const map = new mapkit.Map(options.node, {
    region: regionFor(mapkit, options.start, options.zoom, options.node),
    cameraBoundary: boundary,
    isRotationEnabled: false,
    isScrollEnabled: !options.still,
    isZoomEnabled: !options.still,
    showsCompass: mapkit.FeatureVisibility.Hidden,
    showsMapTypeControl: !options.still,
    showsZoomControl: !options.still,
    showsUserLocationControl: false,
  });
  const here = () => ({ lat: map.center.latitude, lng: map.center.longitude });
  map.addEventListener("region-change-start", () => options.onMoveStart?.());
  map.addEventListener("region-change-end", () => {
    options.onMove(here());
    options.onSettle?.(here());
  });
  map.addEventListener("single-tap", event => {
    if (event.pointOnPage && !options.still) map.setCenterAnimated(map.convertPointOnPageToCoordinate(event.pointOnPage));
  });

  return {
    setView: (pin, zoom) => map.setRegionAnimated(regionFor(mapkit, pin, zoom, options.node)),
    zoom: () => zoomOf(map.region, options.node),
    focusTarget: () => firstFocusable(options.node),
    destroy: () => {
      appleBroken.delete(options.onBroken);
      map.destroy();
    },
  };
}

/* ------------------------------------------------------ OpenStreetMap --- */

export async function mountOsm(options: MountOptions): Promise<MapHandle> {
  const [{ default: L }] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
  const map: LeafletMap = L.map(options.node, {
    center: [options.start.lat, options.start.lng],
    zoom: options.zoom,
    minZoom: MIN_ZOOM,
    maxBounds: L.latLngBounds([BOUNDS.south, BOUNDS.west], [BOUNDS.north, BOUNDS.east]),
    ...(options.still
      ? { dragging: false, zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }
      : {}),
  });
  L.tileLayer(MAP_TILES, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.on("movestart", () => options.onMoveStart?.());
  map.on("move", () => {
    const at = map.getCenter();
    options.onMove({ lat: at.lat, lng: at.lng });
  });
  map.on("moveend", () => {
    const at = map.getCenter();
    options.onSettle?.({ lat: at.lat, lng: at.lng });
  });
  map.on("click", event => { if (!options.still) map.panTo(event.latlng); });

  return {
    setView: (pin, zoom) => map.setView([pin.lat, pin.lng], zoom),
    zoom: () => map.getZoom(),
    /* Leaflet makes the box itself focusable, and it pans on the arrow keys. */
    focusTarget: () => options.node,
    destroy: () => map.remove(),
  };
}

export function mountMap(engine: MapEngine, options: MountOptions, googleKey: string | null): Promise<MapHandle> {
  if (engine === "google" && googleKey) return mountGoogle(options, googleKey);
  if (engine === "apple") return mountApple(options);
  return mountOsm(options);
}
