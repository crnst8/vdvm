#!/usr/bin/env bash
# macOS installers for the two editions. Both install the same plugin (same ID,
# same binary); the bundled one also installs a catalog as the factory library.
# Neither touches user libraries, presets or patterns.
#
#   plugin/package.sh unbundled
#   plugin/package.sh bundled [catalog dir]   # a folder holding catalog/index.json; default public/
#
# Output: plugin/build/packages/V.D.V.M-<version>-<edition>.pkg (VDVM_BUILD_DIR replaces plugin/build;
# plugin/dev release sets it to plugin/build-release).
# Signing: set VDVM_SIGN_APP ("Developer ID Application: ...") and VDVM_SIGN_INSTALLER
# ("Developer ID Installer: ...") to sign; notarise afterwards with `xcrun notarytool submit`.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
build="${VDVM_BUILD_DIR:-$here/build}"
artefacts="$build/Drums_artefacts/Release"
out="$build/packages"
stage="$build/package-stage"
version="$(node -p "require('$repo/package.json').version")"
edition="${1:-}"
catalog="$(cd "${2:-$repo/public}" 2>/dev/null && pwd || echo "${2:-$repo/public}")"

case "$edition" in
  unbundled|bundled) ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
for f in "$artefacts/VST3/V.D.V.M.vst3" "$artefacts/AU/V.D.V.M.component"; do
  [ -e "$f" ] || { echo "missing $f: run plugin/dev build"; exit 1; }
done

rm -rf "$stage"
mkdir -p "$out" "$stage/plugins/Library/Audio/Plug-Ins/VST3" "$stage/plugins/Library/Audio/Plug-Ins/Components"
# ditto without extended attributes or resource forks. macOS still records com.apple.provenance, which
# pkgbuild stores as AppleDouble entries; Installer restores them as attributes, not as ._ files.
ditto --norsrc --noextattr --noacl "$artefacts/VST3/V.D.V.M.vst3" "$stage/plugins/Library/Audio/Plug-Ins/VST3/V.D.V.M.vst3"
ditto --norsrc --noextattr --noacl "$artefacts/AU/V.D.V.M.component" "$stage/plugins/Library/Audio/Plug-Ins/Components/V.D.V.M.component"
if [ -n "${VDVM_SIGN_APP:-}" ]; then
  codesign --force --deep --options runtime --timestamp --sign "$VDVM_SIGN_APP" \
    "$stage/plugins/Library/Audio/Plug-Ins/VST3/V.D.V.M.vst3" "$stage/plugins/Library/Audio/Plug-Ins/Components/V.D.V.M.component"
fi
sign=()
[ -n "${VDVM_SIGN_INSTALLER:-}" ] && sign=(--sign "$VDVM_SIGN_INSTALLER")

chmod -R u+rwX,go+rX "$stage/plugins"
export COPYFILE_DISABLE=1
pkgbuild --root "$stage/plugins" --identifier one.re20.vdvm.plugin --version "$version" --install-location / \
  "$stage/plugin.pkg" >/dev/null

if [ "$edition" = unbundled ]; then
  productbuild --identifier one.re20.vdvm.unbundled --version "$version" --package "$stage/plugin.pkg" ${sign[@]+"${sign[@]}"} \
    "$out/V.D.V.M-$version-unbundled.pkg" >/dev/null
else
  [ -f "$catalog/catalog/index.json" ] || { echo "$catalog/catalog/index.json missing"; exit 1; }
  factory="$stage/factory/Library/Application Support/V.D.V.M/Factory"
  mkdir -p "$factory"
  # Only files the current index references (kits, credits, audio, logos, photos).
  python3 - "$catalog" > "$stage/factory-files.txt" <<'PY'
import json, sys, os
root = sys.argv[1]
index = json.load(open(os.path.join(root, 'catalog/index.json')))
files = {'catalog/index.json', index['creditsUrl']}
for m in index['machines']:
    for art in (m.get('logo'), m.get('photo')):
        if art: files.add(art['url'])
for k in index['kits']:
    files.add(k['url'])
    for s in json.load(open(os.path.join(root, k['url'])))['samples']:
        files.add(s['url'])
print('\n'.join(sorted(files)))
PY
  rsync -a --files-from="$stage/factory-files.txt" "$catalog/" "$factory/"
  # pkgbuild keeps staged modes and installs as root; some catalog media is 600, which the host could not read.
  chmod -R u+rwX,go+rX "$stage/factory"
  (cd "$repo" && npx tsx scripts/catalog/validate.ts --root "$factory")
  pkgbuild --root "$stage/factory" --identifier one.re20.vdvm.factory --version "$version" --install-location / \
    "$stage/factory.pkg" >/dev/null
  productbuild --identifier one.re20.vdvm.bundled --version "$version" \
    --package "$stage/plugin.pkg" --package "$stage/factory.pkg" ${sign[@]+"${sign[@]}"} \
    "$out/V.D.V.M-$version-bundled.pkg" >/dev/null
  echo "factory payload: $(du -sh "$factory" | cut -f1) ($(wc -l < "$stage/factory-files.txt" | tr -d ' ') files)"
fi
echo "plugin binaries: VST3 $(du -sh "$artefacts/VST3/V.D.V.M.vst3" | cut -f1), AU $(du -sh "$artefacts/AU/V.D.V.M.component" | cut -f1)"
ls -lh "$out"/V.D.V.M-"$version"-"$edition".pkg | awk '{print "installer: " $5 " " $9}'
rm -rf "$stage"
