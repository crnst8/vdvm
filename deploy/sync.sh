#!/usr/bin/env bash
# Drums: compare what this machine has against production, and push what git
# does not carry. Git carries code and system files (GitHub Actions deploys
# them). This script carries the rest:
#
#   data    release/catalog + release/media  → vpsau3:/opt/drums/data
#           (built from samples/ and catalog/ by the production catalog build)
#   config  deploy/server.env (git-ignored)  → vpsau3:/opt/drums/server.env
#
# Usage:
#   deploy/sync.sh status [--no-build]   report differences; change nothing
#   deploy/sync.sh push   [--no-build] [--yes]
#                                        rebuild, validate, then upload
#
# --no-build  skip the production catalog build and compare release/ as it is.
# --yes       do not ask before uploading.
#
# Environment: DRUMS_HOST (default vpsau3), DRUMS_REMOTE (default /opt/drums),
# DRUMS_MIN_FREE_GB (default 16; vpsau3 is a failover standby that refuses to
# activate under 15 GB free, so uploads stop before crossing that).
#
# Upload order keeps the live site consistent: media first, then revisioned
# catalog files, then the top-level catalog JSON that points at them, and only
# then deletion of files nothing references any more.
#
# Written for bash 3.2 and macOS openrsync as well as GNU rsync.

set -euo pipefail

host=${DRUMS_HOST:-vpsau3}
remote=${DRUMS_REMOTE:-/opt/drums}
min_free_gb=${DRUMS_MIN_FREE_GB:-16}

if [ -t 1 ]; then
    bold=$'\033[1m'; dim=$'\033[2m'; red=$'\033[31m'; green=$'\033[32m'; yellow=$'\033[33m'; reset=$'\033[0m'
else
    bold=''; dim=''; red=''; green=''; yellow=''; reset=''
fi
say()   { printf '%s\n' "$*"; }
head_() { printf '\n%s%s%s\n' "$bold" "$*" "$reset"; }
ok()    { printf '%s✓%s %s\n' "$green" "$reset" "$*"; }
warn()  { printf '%s!%s %s\n' "$yellow" "$reset" "$*" >&2; }
die()   { printf '%serror:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }

usage() { sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; }

mode=${1:-}; [ $# -gt 0 ] && shift
build=1; assume_yes=0
while [ $# -gt 0 ]; do
    case $1 in
        --no-build) build=0 ;;
        --yes|-y) assume_yes=1 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; die "unknown option: $1" ;;
    esac
    shift
done
case $mode in
    status|push) ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage >&2; die "choose status or push" ;;
esac

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/drums-sync.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

# One multiplexed connection for every ssh, scp and rsync call; the host
# rate-limits bursts of new connections.
ssh_opts="-o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o ControlPath=/tmp/drums-ssh-%C -o ControlPersist=120"
rssh() { ssh $ssh_opts "$host" "$@"; }
trap 'ssh $ssh_opts -O exit "$host" 2>/dev/null; rm -rf "$tmp"' EXIT
rssh true 2>/dev/null || die "cannot ssh to $host"

# ---------------------------------------------------------------------------
# 1. Git: code and system files, deployed by GitHub Actions on push to main
# ---------------------------------------------------------------------------
head_ "1. Git (code and system files; deployed by pushing main)"
git fetch -q origin main 2>/dev/null || warn "could not fetch origin"
changes=$(git status --porcelain)
ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')
behind=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')
deployed=$(rssh "git -C '$remote/app' rev-parse --short HEAD 2>/dev/null" || true)
say "  local HEAD $(git rev-parse --short HEAD) · origin/main $(git rev-parse --short origin/main 2>/dev/null || echo '?') · server ${deployed:-not deployed}"
say "  $ahead commit(s) not pushed, $behind commit(s) not pulled"
if [ -n "$changes" ]; then
    say "  uncommitted:"
    printf '%s\n' "$changes" | sed -n '1,20s/^/    /p'
    n=$(printf '%s\n' "$changes" | wc -l | tr -d ' ')
    [ "$n" -gt 20 ] && say "    ${dim}... and $((n - 20)) more${reset}"
else
    say "  working tree clean"
fi

# ---------------------------------------------------------------------------
# 2. Data: samples/ + catalog/ → release/ → server
# ---------------------------------------------------------------------------
head_ "2. Catalog and media (from samples/, not in git)"
if [ "$build" = 1 ]; then
    say "  building the production catalog (npm run catalog:build -- --mode full --production)"
    npm run -s catalog:build -- --mode full --production > "$tmp/build.log" 2>&1 \
        || { tail -20 "$tmp/build.log" >&2; die "catalog build failed; log above"; }
    tail -1 "$tmp/build.log" | sed 's/^/  /'
fi
[ -f release/catalog/index.json ] || die "release/catalog/index.json missing; run without --no-build"
npm run -s catalog:validate -- --mode full --root release > "$tmp/validate.log" 2>&1 \
    || { tail -20 "$tmp/validate.log" >&2; die "release/ failed validation"; }
ok "release/ validates"

rev() { python3 -c 'import json,sys; print(json.load(sys.stdin)["revision"])'; }
local_rev=$(rev < release/catalog/index.json)
remote_rev=$(rssh "cat '$remote/data/catalog/index.json' 2>/dev/null" | rev 2>/dev/null || echo none)
say "  catalog revision: local $local_rev · server $remote_rev"

# Content-addressed trees compare by name and size; fixed-name JSON by checksum.
# Some source WAVs are mode 600 and nginx in the container runs as another
# user, so modes are fixed on the server after each upload (macOS openrsync
# ignores --chmod).
rs_common=(-rlt --itemize-changes --exclude=.DS_Store -e "ssh $ssh_opts")
rs_addressed=(--size-only)
dest="$host:$remote/data"
rssh "test -d '$remote/data'" || die "$host:$remote/data does not exist; run deploy/bootstrap.sh first"
rssh "mkdir -p '$remote/data/catalog' '$remote/data/media'"

plan() {  # plan LABEL SRC DEST [rsync args...] → counts, list in $tmp/LABEL
    local label=$1 src=$2 dst=$3; shift 3
    rsync "${rs_common[@]}" "$@" --dry-run "$src" "$dst" > "$tmp/$label" 2>&1 || { cat "$tmp/$label" >&2; die "rsync dry run failed ($label)"; }
}
plan media release/media/ "$dest/media/" "${rs_addressed[@]}" --delete
plan catalog release/catalog/ "$dest/catalog/" --checksum --delete

summarise() {  # summarise LABEL
    local f=$tmp/$1 new changed deleted bytes
    new=$(grep -c '^[<>]f+' "$f" || true)
    changed=$(grep -E '^[<>]f' "$f" | grep -vc '^[<>]f+' || true)
    deleted=$(grep -c '^\*deleting' "$f" || true)
    bytes=$({ grep -E '^[<>]f' "$f" || true; } | python3 -c 'import os,sys; print(sum(os.path.getsize(os.path.join(sys.argv[1], l.split(" ",1)[1].rstrip("\n"))) for l in sys.stdin if " " in l))' "release/$1")
    say "  $1: $new new, $changed changed, $deleted to delete ($(awk -v b="$bytes" 'BEGIN{printf "%.1f MB", b/1048576}') to send)"
    { grep -E '^[<>]f|^\*deleting' "$f" || true; } | sed -n '1,8s/^/    /p'
    [ $((new + changed + deleted)) -gt 8 ] && say "    ${dim}...${reset}"
    echo $((new + changed + deleted)) > "$f.count"
    echo "$bytes" > "$f.bytes"
}
summarise media
summarise catalog
data_changes=$(( $(cat "$tmp/media.count") + $(cat "$tmp/catalog.count") ))
send_bytes=$(( $(cat "$tmp/media.bytes") + $(cat "$tmp/catalog.bytes") ))

free_kb=$(rssh "df -Pk '$remote' | awk 'NR==2 {print \$4}'")
free_after_gb=$(awk -v f="$free_kb" -v s="$send_bytes" 'BEGIN{printf "%.1f", (f*1024 - s)/1073741824}')
say "  server free space after upload: ${free_after_gb} GB (floor ${min_free_gb} GB)"
disk_ok=$(awk -v a="$free_after_gb" -v m="$min_free_gb" 'BEGIN{print (a >= m) ? 1 : 0}')
[ "$disk_ok" = 1 ] || warn "upload would leave less than ${min_free_gb} GB free on $host"

# ---------------------------------------------------------------------------
# 3. Config: deploy/server.env (git-ignored) ↔ server
# ---------------------------------------------------------------------------
head_ "3. Server config (deploy/server.env, not in git)"
keys() { sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | sort; }
hash_env() { grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' | sort | shasum -a 256 | cut -c1-12; }
config_change=0
remote_env=$(rssh "cat '$remote/server.env' 2>/dev/null" || true)
if [ ! -f deploy/server.env ]; then
    if [ -n "$remote_env" ]; then say "  no local deploy/server.env; server copy is authoritative (keys: $(printf '%s\n' "$remote_env" | keys | tr '\n' ' '))"
    else warn "neither deploy/server.env nor the server copy exists; see deploy/server.env.example"; fi
elif [ "$(hash_env < deploy/server.env)" = "$(printf '%s\n' "$remote_env" | hash_env)" ]; then
    say "  identical"
else
    config_change=1
    say "  differs from the server copy; keys that differ (values not shown):"
    lk=$(grep -v '^[[:space:]]*#' deploy/server.env | sort); rk=$(printf '%s\n' "$remote_env" | grep -v '^[[:space:]]*#' | sort)
    comm -3 <(printf '%s\n' "$lk") <(printf '%s\n' "$rk") | sed 's/^[[:space:]]*//' | keys | uniq | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# 4. Push
# ---------------------------------------------------------------------------
head_ "Summary"
say "  data: $data_changes file change(s) · config: $([ $config_change = 1 ] && echo changed || echo unchanged)"
[ -n "$changes" ] || [ "$ahead" != 0 ] && say "  code: commit and push main to deploy it (GitHub Actions)"
[ "$mode" = push ] || exit 0
if [ "$data_changes" = 0 ] && [ "$config_change" = 0 ]; then ok "nothing to upload"; exit 0; fi
[ "$disk_ok" = 1 ] || die "refusing to upload: $host would drop under ${min_free_gb} GB free"
if [ "$assume_yes" = 0 ]; then
    [ -t 0 ] || die "no terminal to confirm; pass --yes"
    read -r -p "Upload to $host? [y/N]: " reply </dev/tty
    case $reply in [yY]|[yY][eE][sS]) ;; *) die "cancelled" ;; esac
fi

if [ "$data_changes" != 0 ]; then
    rsync "${rs_common[@]}" "${rs_addressed[@]}" release/media/ "$dest/media/" | grep -c '^[<>]f' | sed 's/^/  media files sent: /' || true
    rsync "${rs_common[@]}" "${rs_addressed[@]}" --exclude='/*.json' release/catalog/ "$dest/catalog/" | grep -c '^[<>]f' | sed 's/^/  catalog files sent: /' || true
    rsync "${rs_common[@]}" --checksum --include='/*.json' --exclude='*' release/catalog/ "$dest/catalog/" >/dev/null
    rsync "${rs_common[@]}" "${rs_addressed[@]}" --delete release/media/ "$dest/media/" | grep -c '^\*deleting' | sed 's/^/  media files deleted: /' || true
    rsync "${rs_common[@]}" --checksum --delete release/catalog/ "$dest/catalog/" | grep -c '^\*deleting' | sed 's/^/  catalog files deleted: /' || true
    rssh "find '$remote/data' -type f ! -perm -o=r -exec chmod 644 {} + ; find '$remote/data' -type d ! -perm -o=rx -exec chmod 755 {} +"
    ok "data uploaded; catalog revision $local_rev is live"
fi

if [ "$config_change" = 1 ]; then
    scp -q $ssh_opts deploy/server.env "$host:$remote/server.env.new"
    rssh "chmod 600 '$remote/server.env.new' && mv '$remote/server.env.new' '$remote/server.env' && '$remote/app/deploy/remote-deploy.sh' --no-pull"
    ok "server.env updated and stack restarted"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "https://media.re20.one/catalog/index.json" || true)
[ "$code" = 200 ] && ok "https://media.re20.one/catalog/index.json → 200" || warn "https://media.re20.one/catalog/index.json → $code"
