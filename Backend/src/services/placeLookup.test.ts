import { afterEach, describe, expect, it } from "vitest";
import { hintsFromApple, placeAt, usePlaceServices, type Transport } from "./placeLookup";

/* Real Nominatim answers, read at these points by the Live check workflow
   (this sandbox cannot reach the service). */
const SALMIYA_EN = { address: { road: "Hamad Al-Mubarak Street", neighbourhood: "Salmiya - Block 5", suburb: "Salmiya", county: "Salmiya", state: "Hawalli Governorate", "ISO3166-2-lvl4": "KW-HA", postcode: "20004", country: "Kuwait", country_code: "kw" } };
const RUMAITHIYA_AR = { address: { house_number: "6A", road: "شارع 52", neighbourhood: "قطعة 5", suburb: "الرميثية", county: "الرميثية", state: "محافظة حولي", "ISO3166-2-lvl4": "KW-HA", country: "الكويت", country_code: "kw" } };
const HAWALLI_EN = { address: { neighbourhood: "Hawally - Block 5", suburb: "Hawally", state: "Hawalli Governorate", "ISO3166-2-lvl4": "KW-HA", country: "Kuwait", country_code: "kw" } };

type Asked = { url: string; headers: Record<string, string> };

function standIn(answer: (url: string) => unknown, asked: Asked[] = []): Transport {
  return async (url, init) => {
    asked.push({ url, headers: init.headers });
    const body = answer(url);
    if (body instanceof Error) throw body;
    if (typeof body === "number") return { ok: false, status: body, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
}

afterEach(() => usePlaceServices(null));

describe("placeAt", () => {
  it("reads Nominatim's answer in the page's language and names itself", async () => {
    const asked: Asked[] = [];
    usePlaceServices({ nominatim: standIn(() => SALMIYA_EN, asked), apple: async () => null, spacingMs: 0 });
    const answer = await placeAt({ lat: 29.3375, lng: 48.0763 }, "en");
    expect(answer).toEqual({ parts: { area: "Salmiya", block: "5", street: "Hamad Al-Mubarak" }, governorate: "hawalli", source: "osm" });
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toContain("accept-language=en");
    expect(asked[0].url).toContain("lat=29.3375");
    expect(asked[0].headers["User-Agent"]).toMatch(/^NetLet address lookup/);
  });

  it("reads an Arabic answer, house and all", async () => {
    usePlaceServices({ nominatim: standIn(() => RUMAITHIYA_AR), apple: async () => null, spacingMs: 0 });
    const answer = await placeAt({ lat: 29.3115, lng: 48.0819 }, "ar");
    expect(answer?.parts).toEqual({ area: "Rumaithiya", block: "5", street: "52", building: "6A" });
  });

  it("keeps an answer, so the same spot is not asked twice", async () => {
    const asked: Asked[] = [];
    usePlaceServices({ nominatim: standIn(() => SALMIYA_EN, asked), apple: async () => null, spacingMs: 0 });
    await placeAt({ lat: 29.33751, lng: 48.07632 }, "en");
    await placeAt({ lat: 29.33749, lng: 48.07628 }, "en");
    expect(asked).toHaveLength(1);
  });

  it("asks again in Arabic when the English spelling is one the list does not know", async () => {
    const asked: Asked[] = [];
    usePlaceServices({
      nominatim: standIn(url => url.includes("accept-language=ar")
        ? { address: { road: "شارع 52", neighbourhood: "قطعة 5", suburb: "الرميثية", "ISO3166-2-lvl4": "KW-HA", country_code: "kw" } }
        : { address: { road: "Street 52", neighbourhood: "Block 5", suburb: "Residential Zone 5", "ISO3166-2-lvl4": "KW-HA", country_code: "kw" } }, asked),
      apple: async () => null,
      spacingMs: 0,
    });
    const answer = await placeAt({ lat: 29.3115, lng: 48.0819 }, "en");
    expect(answer?.parts).toEqual({ area: "Rumaithiya", block: "5", street: "52" });
    expect(asked.map(item => item.url.match(/accept-language=(\w+)/)?.[1])).toEqual(["en", "ar"]);
  });

  it("asks Apple for a street Nominatim did not have", async () => {
    const paths: string[] = [];
    usePlaceServices({
      nominatim: standIn(() => HAWALLI_EN),
      apple: async path => {
        paths.push(path);
        return { results: [{ countryCode: "KW", structuredAddress: { thoroughfare: "Street 4", locality: "Hawalli", administrativeArea: "Hawalli" } }] };
      },
      spacingMs: 0,
    });
    const answer = await placeAt({ lat: 29.3417, lng: 48.0283 }, "en");
    expect(answer?.parts).toEqual({ area: "Hawalli", block: "5", street: "4" });
    expect(answer?.source).toBe("osm");
    expect(paths[0]).toMatch(/^\/reverseGeocode\?loc=29\.3417,48\.0283&lang=en-US$/);
  });

  it("answers nothing when every service is down, and asks again later rather than a day later", async () => {
    let calls = 0;
    usePlaceServices({ nominatim: standIn(() => { calls += 1; return 503; }), apple: async () => null, spacingMs: 0 });
    expect(await placeAt({ lat: 29.3375, lng: 48.0763 }, "en", 1_000_000)).toBeNull();
    expect(await placeAt({ lat: 29.3375, lng: 48.0763 }, "en", 1_000_000 + 60_000)).toBeNull();
    expect(calls).toBe(1);
    await placeAt({ lat: 29.3375, lng: 48.0763 }, "en", 1_000_000 + 6 * 60_000);
    expect(calls).toBe(2);
  });

  it("refuses a point outside Kuwait without asking anybody", async () => {
    const asked: Asked[] = [];
    usePlaceServices({ nominatim: standIn(() => SALMIYA_EN, asked), apple: async () => null, spacingMs: 0 });
    expect(await placeAt({ lat: 30.5, lng: 47.8 }, "en")).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it("ignores an answer from another country", async () => {
    usePlaceServices({ nominatim: standIn(() => ({ address: { suburb: "Basra", country_code: "iq" } })), apple: async () => null, spacingMs: 0 });
    expect(await placeAt({ lat: 29.95, lng: 47.9 }, "en")).toBeNull();
  });

  it("spaces requests to Nominatim a second apart", async () => {
    const times: number[] = [];
    usePlaceServices({ nominatim: standIn(() => { times.push(Date.now()); return SALMIYA_EN; }), apple: async () => null, spacingMs: 300 });
    await placeAt({ lat: 29.3375, lng: 48.0763 }, "en");
    await placeAt({ lat: 29.3197, lng: 48.0247 }, "en");
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(280);
  });
});

describe("hintsFromApple", () => {
  it("reads the structured address, its area code as Kuwait's", () => {
    expect(hintsFromApple({ results: [{ countryCode: "KW", structuredAddress: { subLocality: "Block 5", locality: "Salmiya", administrativeAreaCode: "HA", thoroughfare: "Street 52", subThoroughfare: "6" } }] }))
      .toEqual({ roads: ["Street 52"], blocks: ["Block 5"], areas: ["Block 5", "Salmiya"], governorates: ["KW-HA"], houses: ["6"] });
    expect(hintsFromApple({ results: [] })).toBeNull();
  });
});
