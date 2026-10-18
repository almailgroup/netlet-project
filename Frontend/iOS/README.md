# NetLet for iOS

The native app: SwiftUI, iOS 17 and up, bundle identifier
`com.netlet.marketplace`. It talks to the same tRPC API the web storefront
does and holds no catalogue, prices or rules of its own.

## Running it

Open `NetLet.xcodeproj` in Xcode 16 or later and run the **NetLet** scheme on a
simulator. Nothing needs installing first: there are no packages.

The app talks to the server named by `NETLET_API_BASE_URL` in
`Config/Shared.xcconfig`, which is the Vercel deployment. The scheme carries
two launch arguments, off by default, under *Edit Scheme → Run → Arguments*:

- `-NetLetDemo YES` answers every call from the recordings in
  `NetLet/Resources/Demo/`, so the app runs with no server and no network.
- `-NetLetAPIBaseURL http://localhost:5001` points a simulator at `pnpm dev`
  on the same Mac. A real phone needs the Mac's address on the network instead.

Signing in sets NetLet's httpOnly session cookie in the system's cookie store,
the way a browser keeps it; the app never holds a token or a password.

## Layout

```
NetLet/
  App/           the entry point and the tabs
  Models/        the API's shapes, decoded — Product, Cart, Order, Money (in fils)
  Services/      one service per area over a typed tRPC client (Networking/)
  ViewModels/    @Observable state for each screen, async/await throughout
  Views/         SwiftUI screens, by area, and the components they share
  Utilities/     the dictionary, the theme, form rules, photo preparation
  Resources/     the asset catalogue, Generated/ and Demo/
NetLetTests/     unit tests: the wire format, every recording decoding, the view models
Config/          Info.plist and the build settings
scripts/         exportShared.ts, which writes Resources/Generated/
```

## What comes from `Shared/`

Swift cannot import TypeScript, so `Resources/Generated/` holds JSON written
from the modules the web and the server import: the dictionary in both
languages and its plural forms, the departments, Kuwait's governorates and
areas, and the form limits. After changing any of those, run

```
pnpm ios:resources
```

and commit the result. `scripts/exportShared.test.ts` runs in `pnpm test` and
fails while a committed file is stale, or while the Swift asks for a dictionary
key that does not exist.

Every word the app shows is a dictionary key, so the Arabic is the web's
Arabic. A sentence only the app needs is an `ios.*` key in
`Shared/i18n/dictionary.ts`, in both languages.

## Tests

```
xcodebuild test -project NetLet.xcodeproj -scheme NetLet \
  -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO
```

`.github/workflows/ios.yml` runs the same on macOS for every push that touches
this folder.

## Recording the demo again

The files in `Resources/Demo/` are answers captured from a NetLet server with
the development seed, one per procedure (`demo.<procedure>.json`). A procedure
with no recording answers "not found", so a screen shows its failure state
rather than invented data. They are also the contract test: a change to the
API that breaks a recording's decoding fails `FixtureDecodingTests`.
