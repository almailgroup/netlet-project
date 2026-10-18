#!/bin/bash
# Points the rest of a GitHub Actions job at the newest released Xcode of the
# major version App Store Connect asks for, so the app is tested with the SDK
# it ships with. App Store Connect refuses an upload built with an older SDK
# ("This app was built with the iOS 18.5 SDK. All iOS and iPadOS apps must be
# built with the iOS 26 SDK or later"), and a beta or release candidate is
# skipped because it refuses those too.
#
# The runner image carries several Xcodes side by side as
# /Applications/Xcode_<version>.app; DEVELOPER_DIR picks one for every later
# step without needing sudo for xcode-select.
set -euo pipefail

major="${1:-26}"

installed=$(ls -d /Applications/Xcode_*.app 2>/dev/null || true)
newest=$(printf '%s\n' "$installed" | python3 -c '
import re, sys
major = sys.argv[1]
found = []
for path in sys.stdin.read().split():
    match = re.fullmatch(r"/Applications/Xcode_(" + major + r"(?:\.\d+)*)\.app", path)
    if match:
        found.append((tuple(int(part) for part in match.group(1).split(".")), path))
print(max(found)[1] if found else "")
' "$major")

if [ -z "$newest" ]; then
  echo "::error title=No Xcode ${major}::This runner has no released Xcode ${major}. It has:"
  ls -d /Applications/Xcode*.app || true
  exit 1
fi

echo "DEVELOPER_DIR=$newest/Contents/Developer" >> "$GITHUB_ENV"
DEVELOPER_DIR="$newest/Contents/Developer" xcodebuild -version
