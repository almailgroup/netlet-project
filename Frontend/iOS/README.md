# NetLet for iOS

The native app: SwiftUI, iOS 17 and up, bundle identifier
`com.netlet.marketplace`. It talks to the same tRPC API the web storefront
does and holds no catalogue, prices or rules of its own.

## Running it

Open `NetLet.xcodeproj` in Xcode 26 or later and run the **NetLet** scheme on a
simulator. Nothing needs installing first: there are no packages.

The app talks to the server named by `NETLET_API_BASE_URL` in
`Config/Shared.xcconfig`, which is the Vercel deployment. The scheme carries
two launch arguments, off by default, under *Edit Scheme → Run → Arguments*:

- `-NetLetDemo YES` answers every call from the recordings in
  `NetLet/Resources/Demo/`, so the app runs with no server and no network.
- `-NetLetAPIBaseURL http://localhost:3000` points a simulator at `pnpm dev`
  on the same Mac. A real phone needs the Mac's address on the network instead.

Two more, for development and screenshots, in Debug builds only:

- `-NetLetDemoAs shopper` makes the demo a signed-in shopper who also runs a
  store, so the bag, checkout, orders and the Sell tab have something in them.
- `-NetLetOpen <screen>` starts on one screen: `department:grocery`,
  `product:<handle>`, `search:<words>`, `cart`, `checkout`, `account`,
  `orders`, `order:<reference>`, `profile`, `sell`, `newListing`.
- `-netlet.language ar` starts in Arabic.

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
this folder, then installs the app on the simulator and photographs eleven
screens in English and Arabic from the demo recordings. Without a Mac, that is
the preview: the **ios-previews** artifact on the workflow run, under the
repository's Actions tab. Running the workflow by hand (*Actions → iOS → Run
workflow*) with **share** ticked also posts small copies as "iOS preview"
checks on the commit.

## TestFlight

`.github/workflows/testflight.yml` archives the Release build, has Apple sign
it and uploads it to App Store Connect, from which TestFlight puts it on a
phone. It runs only when pressed (*Actions → TestFlight → Run workflow*), and
the build number is the workflow's run number, so every run is a new build.
No certificate or provisioning profile is kept anywhere: an App Store Connect
API key lets `xcodebuild` make the distribution identity in Apple's cloud.
App Store Connect accepts only builds made with the current SDK, so both this
workflow and `ios.yml` build with the newest released Xcode 26 on the runner
(`scripts/select-xcode.sh`) rather than its default; on a Mac of your own,
build with Xcode 26 too.

Once, in Apple's portals (a paid Apple Developer Program membership):

1. **Register the App ID.** [Certificates, Identifiers & Profiles →
   Identifiers](https://developer.apple.com/account/resources/identifiers/list)
   → **+** → App IDs → App, explicit bundle ID `com.netlet.marketplace`, no
   capabilities. If that identifier is taken, pick another and set it as the
   repository variable `IOS_BUNDLE_ID`.
2. **Create the app.** [App Store Connect → Apps](https://appstoreconnect.apple.com/apps)
   → **+** → New App: iOS, a name nobody else on the App Store has, primary
   language, the bundle ID from step 1, any SKU (`netlet-ios`). Full access.
3. **Make an API key.** App Store Connect → Users and Access → Integrations →
   App Store Connect API → Team Keys → **+**, access **Admin** (cloud signing
   needs it). Download the `.p8` — Apple offers it once — and note the
   **Key ID** beside it and the **Issuer ID** above the list.
4. **Find the Team ID**: [Membership details](https://developer.apple.com/account#MembershipDetailsCard),
   ten characters.

Then in GitHub, *Settings → Secrets and variables → Actions → New repository
secret*, four secrets:

| Secret                        | Value                                                  |
| ----------------------------- | ------------------------------------------------------ |
| `APP_STORE_CONNECT_KEY_ID`    | the Key ID                                             |
| `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID                                          |
| `APP_STORE_CONNECT_KEY`       | the whole `.p8` file, its BEGIN and END lines included |
| `APPLE_TEAM_ID`               | the Team ID                                            |

The repository variable `NETLET_API_BASE_URL` (under *Variables*) points the
build at another server than the xcconfig's; unset, it is the Vercel
deployment.

A run takes about fifteen minutes and names any secret that is missing. Apple
then processes the build for ten to thirty minutes. In App Store Connect →
the app → TestFlight → Internal Testing, add a group with yourself in it and
the build; install the **TestFlight** app from the App Store on the iPhone,
signed in with the same Apple Account, and NetLet is there. A build expires
after ninety days; run the workflow again for a new one.

## Recording the demo again

The files in `Resources/Demo/` are answers captured from a NetLet server with
the development seed, one per procedure (`demo.<procedure>.json`). A procedure
with no recording answers "not found", so a screen shows its failure state
rather than invented data. They are also the contract test: a change to the
API that breaks a recording's decoding fails `FixtureDecodingTests`.
