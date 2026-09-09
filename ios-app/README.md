# NetLet — iOS app

Everything for the iOS app lives in this one folder.

```
ios-app/
├── App.tsx          the app itself
├── src/             the contract with the web storefront
├── assets/          icon and splash artwork
├── ios/             the native Xcode project  ← open this in Xcode
├── app.json         Expo config: name, icon, splash, bundle identifier
└── package.json
```

## What the app is

A native shell around the NetLet storefront. It loads
`https://almailgroup.github.io/netlet-project/` in a `WKWebView` and adds the
things a website cannot do: a native tab bar, haptics, and the iOS glass effect.
`src/webStorefront.ts` holds the values shared with the web side — change a tab
label there and it must change on the web too, or that tab silently stops
working.

It does **not** need the Mac mini server running. It points at the published
site, so it shows real content the moment it launches.

## Run it

You need a Mac with Xcode, and CocoaPods (`brew install cocoapods`).

```sh
cd ios-app
npm install          # or pnpm install
npx expo run:ios
```

Install dependencies **before** anything CocoaPods-related: the Podfile shells
out to `node --print "require.resolve('react-native/package.json')"`, so
`pod install` fails outright without `node_modules`.

`.npmrc` pins pnpm to `node-linker=hoisted`. pnpm's default layout symlinks
every package into `.pnpm/`, and React Native's autolinking and Xcode build
scripts do not follow that reliably. Do not remove it.

That builds and opens the simulator. First run takes 5–15 minutes while it
compiles the native modules; after that it is fast.

To work in Xcode instead — for signing, device testing, or native debugging:

```sh
cd ios-app/ios
pod install
open NetLet.xcworkspace
```

Pick a simulator in the toolbar and press ▶.

**Open `NetLet.xcworkspace`, not `NetLet.xcodeproj`.** The `.xcodeproj` is
checked in; the `.xcworkspace` is written by `pod install` and is the one that
includes the pods. Opening the project directly gives a build full of
missing-module errors.

## Why not Expo Go

Expo Go only carries the native modules built into it. This app uses
`react-native-webview`, `expo-glass-effect` and `react-native-view-shot`, which
all ship their own native iOS code, so it has to be built — which is exactly
what `npx expo run:ios` does.

## What is committed, and what is not

`ios/` is committed so the project opens in Xcode straight from a clone.
`ios/Pods/`, `ios/*.xcworkspace` and `xcuserdata/` are not: CocoaPods and Xcode
regenerate them, and Pods alone is around 100MB of vendored source.

`ios/` is generated from `app.json` by `npx expo prebuild`. Editing the Xcode
project by hand works until someone re-runs prebuild, which overwrites it —
change `app.json` instead, and re-run:

```sh
npx expo prebuild --platform ios --clean
```

## On a real iPhone

Open the workspace, select the **NetLet** target → Signing & Capabilities, tick
*Automatically manage signing*, and pick your Apple ID under Team. A free
account works; the build expires after seven days and is reinstalled by running
again. Then choose your iPhone in the toolbar instead of a simulator.

## Checks

```sh
npm run check          # TypeScript
npm test               # unit tests
npx expo export --platform ios   # confirms the JS bundle builds
```
