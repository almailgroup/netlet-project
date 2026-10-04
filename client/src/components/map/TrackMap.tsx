/**
 * The driver and the door, on one map (3.4.3).
 *
 * Two dots rather than pin images — navy for the driver, orange for the door —
 * because Leaflet's own marker icons are files a bundler loses, and a dot reads
 * as "here" without an icon to learn. Everything the map shows is also said in
 * words beside it, so the map is a region somebody can skip rather than the
 * only place the answer lives. Leaflet loads when the first map is drawn, as
 * the address picker's does.
 */
import { useEffect, useRef, useState } from "react";
import type { CircleMarker, Map as LeafletMap } from "leaflet";
import { useTranslation } from "@/hooks/useTranslation";
import { MAP_TILES, type Pin } from "@shared/commerce/geo";

export function TrackMap({ driver, door }: { driver: Pin; door: Pin | null }) {
  const { t } = useTranslation();
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const dots = useRef<{ driver: CircleMarker | null; door: CircleMarker | null }>({ driver: null, door: null });
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: L }] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
        if (cancelled || !node.current) return;
        const created = L.map(node.current, { zoomControl: false, keyboard: false, attributionControl: true });
        L.tileLayer(MAP_TILES, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(created);
        dots.current.driver = L.circleMarker([driver.lat, driver.lng], { radius: 9, color: "#ffffff", weight: 3, fillColor: "#0a285a", fillOpacity: 1 }).addTo(created);
        if (door) dots.current.door = L.circleMarker([door.lat, door.lng], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#f2683a", fillOpacity: 1 }).addTo(created);
        map.current = created;
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    /* Created once; the positions below move the dots rather than the map. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The driver moves between polls: move the dot and keep both in view. */
  useEffect(() => {
    const current = map.current;
    if (!ready || !current) return;
    dots.current.driver?.setLatLng([driver.lat, driver.lng]);
    if (door) dots.current.door?.setLatLng([door.lat, door.lng]);
    if (door) current.fitBounds([[driver.lat, driver.lng], [door.lat, door.lng]], { padding: [28, 28], maxZoom: 16 });
    else current.setView([driver.lat, driver.lng], 14);
  }, [ready, driver.lat, driver.lng, door?.lat, door?.lng, door]);

  return (
    <div className="relative isolate h-[220px] overflow-hidden rounded-xl bg-[#e7edf5]">
      <div ref={node} role="region" aria-label={t("tracking.mapLabel")} className="netlet-map size-full" />
      {!ready ? (
        <p className="absolute inset-0 grid place-items-center p-4 text-center text-[12px] font-bold text-[#0a285a]">
          {t(failed ? "tracking.mapFailed" : "pin.loading")}
        </p>
      ) : null}
    </div>
  );
}
