#!/usr/bin/env bash
# Runs on vpsau2 as the forced command of the CI download key (installed by
# deploy/bootstrap-downloads.sh as ~/bin/vdvm-downloads). Serves
# dl.vdvm.crnst8.com from /var/www/vdvm-downloads and keeps one version there.
#
#   put <version> <bundled|unbundled>     installer bytes on stdin → .incoming/<version>/
#   publish <version> <sha256 bundled> <sha256 unbundled>
#                                         check hashes, move to <version>/, point latest/
#                                         at it, rewrite SHA256SUMS, delete every other version
#   status                                list what is served
#
# Layout after publish:
#   <version>/V.D.V.M-<version>-{bundled,unbundled}.pkg
#   latest/V.D.V.M-mac-with-samples.pkg -> ../<version>/V.D.V.M-<version>-bundled.pkg
#   latest/V.D.V.M-mac.pkg              -> ../<version>/V.D.V.M-<version>-unbundled.pkg
#   SHA256SUMS

# Parsed whole before it runs, so replacing this file mid-run is safe.
{
set -euo pipefail
umask 022

root=${VDVM_DL_ROOT:-/var/www/vdvm-downloads}
max_bytes=$((2 * 1024 * 1024 * 1024))
min_free_kb=$((5 * 1024 * 1024))

read -r -a req <<< "${SSH_ORIGINAL_COMMAND:-$*}"
die() { echo "error: $*" >&2; exit 1; }
version_ok() { [[ ${1:-} =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]]; }
pkg() { echo "V.D.V.M-$1-$2.pkg"; }

cd "$root"
exec 9>"$root/.lock"
flock -w 900 9 || die "another upload is running"

case ${req[0]:-} in
  put)
    v=${req[1]:-}; edition=${req[2]:-}
    version_ok "$v" || die "bad version: $v"
    [[ $edition == bundled || $edition == unbundled ]] || die "bad edition: $edition"
    free=$(df -Pk "$root" | awk 'NR==2 {print $4}')
    [ "$free" -gt "$min_free_kb" ] || die "less than 5 GB free"
    mkdir -p ".incoming/$v"
    part=".incoming/$v/$(pkg "$v" "$edition").part"
    head -c "$max_bytes" > "$part"
    mv "$part" ".incoming/$v/$(pkg "$v" "$edition")"
    echo "received $(pkg "$v" "$edition") ($(stat -c %s ".incoming/$v/$(pkg "$v" "$edition")") bytes)"
    ;;
  publish)
    v=${req[1]:-}; want_b=${req[2]:-}; want_u=${req[3]:-}
    version_ok "$v" || die "bad version: $v"
    for e in bundled unbundled; do
      want=$want_b; [ $e = unbundled ] && want=$want_u
      [[ $want =~ ^[0-9a-f]{64}$ ]] || die "bad sha256 for $e"
      f=".incoming/$v/$(pkg "$v" $e)"
      [ -f "$f" ] || die "missing $f"
      got=$(sha256sum "$f" | cut -d' ' -f1)
      [ "$got" = "$want" ] || die "$e hash mismatch: got $got"
    done
    chmod 755 ".incoming/$v"; chmod 644 ".incoming/$v"/*.pkg
    rm -rf "$v.new"; mv ".incoming/$v" "$v.new"
    rm -rf "$v.old"; [ -d "$v" ] && mv "$v" "$v.old"
    mv "$v.new" "$v"
    mkdir -p latest
    ln -sfn "../$v/$(pkg "$v" bundled)" latest/.b && mv -T latest/.b latest/V.D.V.M-mac-with-samples.pkg
    ln -sfn "../$v/$(pkg "$v" unbundled)" latest/.u && mv -T latest/.u latest/V.D.V.M-mac.pkg
    sha256sum "$v"/*.pkg > SHA256SUMS.new && chmod 644 SHA256SUMS.new && mv SHA256SUMS.new SHA256SUMS
    # One version on disk: remove every other version folder and leftovers.
    for d in */ .incoming/*/; do
      d=${d%/}; name=${d##*/}
      [ -d "$d" ] || continue
      if [ "$name" != "$v" ] && version_ok "$name" || [[ $name == *.old ]]; then
        rm -rf -- "$d"; echo "removed $d"
      fi
    done
    echo "published $v"
    ;;
  status)
    ls -l latest/ | sed 1d
    cat SHA256SUMS
    df -h "$root" | awk 'NR==2 {print $4 " free"}'
    ;;
  *) die "unknown request: ${req[*]:-}" ;;
esac
exit 0
}
