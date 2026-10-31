#!/bin/sh
# Build a Type-2 AppImage from repository sources; runtime and squashfs tools are external.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME=${RUNTIME_X86_64:?Set RUNTIME_X86_64 to an AppImage Type-2 x86_64 runtime}
MKSQUASHFS=${MKSQUASHFS:-mksquashfs}
OUT=${1:-"$ROOT/downloads/Material-Chat-x86_64.AppImage"}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/AppDir"
cp "$ROOT/linux-app/AppRun" "$ROOT/linux-app/launcher.py" "$ROOT/linux-app/material-chat.desktop" "$tmp/AppDir/"
cp "$ROOT/variant-b.html" "$tmp/AppDir/variant-b.html"
cp "$ROOT/android-app/app/src/main/res/drawable-nodpi/app_icon.png" "$tmp/AppDir/material-chat.png"
cp "$tmp/AppDir/material-chat.png" "$tmp/AppDir/.DirIcon"
cp "$ROOT/linux-app/LICENSE-appimage-runtime" "$tmp/AppDir/"
chmod 755 "$tmp/AppDir/AppRun" "$tmp/AppDir/launcher.py"
"$MKSQUASHFS" "$tmp/AppDir" "$tmp/filesystem.squashfs" -noappend -all-root -no-progress -processors 1 >/dev/null
cat "$RUNTIME" "$tmp/filesystem.squashfs" > "$OUT"
chmod 755 "$OUT"
echo "Built $OUT"
