# The maps behind "Drop a pin"

An address can carry a pin, so the driver finds the door rather than the end
of the street. The pin picker draws **Google Maps** or **Apple Maps**, and the
shopper chooses between them with two buttons above the map — people here use
both, and the map somebody already knows is the one they can find their own
roof on. It opens on the one this device chose last, or Apple's on an iPhone,
iPad or Mac and Google's everywhere else.

Each appears only once its key is set. With neither, the picker draws
**OpenStreetMap**, which needs no account — so pins work before either is set
up. `pnpm preflight` says which are on.

The pin is always optional and the typed address is always required, whichever
map is used.

---

## Google Maps — one value

1. Go to **console.cloud.google.com**, create (or choose) a project, and turn on
   billing for it. Google's map loads are free up to a monthly allowance; a
   checkout pin is a light use.
2. **APIs & Services → Library → Maps JavaScript API → Enable.**
3. **APIs & Services → Credentials → Create credentials → API key.**
4. Open the key and restrict it — this is what makes a public key safe:
   - **Application restrictions → Websites**, and add NetLet's addresses, e.g.
     `https://netlet.com/*` and `https://www.netlet.com/*` (and the Vercel
     preview address if you test there).
   - **API restrictions → Restrict key → Maps JavaScript API.**
5. In Vercel, set `GOOGLE_MAPS_API_KEY` to the key, and redeploy.

The key is sent to the browser, because Google's map is drawn there and asks for
it by name. That is how Google designs it; the website restriction in step 4 is
what stops anybody else using it.

## Apple Maps — one value, or three

Needs an Apple Developer account (the yearly membership).

**The simple way — a ready-made token:**

1. **developer.apple.com → Certificates, Identifiers & Profiles → Keys**, create
   a key with **MapKit JS** ticked (or use **Maps tokens**, where Apple offers
   it, to make a MapKit JS token directly).
2. Create a **MapKit JS token** restricted to NetLet's domain, with a long
   expiry.
3. In Vercel, set `APPLE_MAPKIT_TOKEN` to it, and redeploy. Renew it before it
   expires.

**The no-renewal way — let NetLet sign its own tokens:**

1. Create the MapKit JS key as above and download the `.p8` file (Apple lets
   you download it once).
2. In Vercel, set:
   - `APPLE_MAPKIT_TEAM_ID` — your Team ID (top right of the developer site)
   - `APPLE_MAPKIT_KEY_ID` — the key's ID
   - `APPLE_MAPKIT_PRIVATE_KEY` — the whole contents of the `.p8` file,
     including the `BEGIN` and `END` lines. If the box wants one line, write
     each line break as `\n`.
3. Redeploy.

NetLet's server then signs a token for each map that opens, good for half an
hour and only for NetLet's own address. The private key never leaves the
server. If `APPLE_MAPKIT_TOKEN` is also set, it is used instead.

---

## What the shopper sees

- Two buttons over the map, **Google Maps** and **Apple Maps** (in Arabic,
  خرائط Google and خرائط Apple), when both are set up; just the one map when
  only one is.
- The pin stays in the middle and the map moves under it — by finger, mouse or
  arrow keys — whichever map it is. Switching keeps the spot and the zoom.
- If a map will not load (a key the provider refuses, a blocked network), the
  box says the typed address is enough and offers the other map.
