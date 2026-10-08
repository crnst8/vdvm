#!/usr/bin/env bash
# One-time (idempotent) production setup for V.D.V.M on vpsau3. Run from the
# repo root on the machine that holds samples/ and release/:
#
#   deploy/bootstrap.sh
#
# Needs: ssh vpsau3 (with sudo), gh logged in with admin on the repo,
# deploy/server.env (copy deploy/server.env.example; TUNNEL_TOKEN from
# your password manager or the Cloudflare API).
#
# Steps, each skipped when already done:
#   1. /opt/drums/{app,data} owned by the ssh user
#   2. clone the public repository to /opt/drums/app
#   3. CI key: generated here, installed on the server with a forced command
#      (remote-deploy.sh only), stored as GitHub secrets; the local copy is deleted
#   4. /opt/drums/server.env from deploy/server.env (mode 0600)
#   5. catalog and media upload (deploy/sync.sh push), then start the stack

set -euo pipefail

host=${DRUMS_HOST:-vpsau3}
remote=${DRUMS_REMOTE:-/opt/drums}
repo=${DRUMS_REPO:-crnst8/vdvm}

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
# Reuse one connection for every ssh/scp call; the host rate-limits bursts of new connections.
mux="-o ControlMaster=auto -o ControlPath=/tmp/drums-ssh-%C -o ControlPersist=300"
ssh() { command ssh $mux "$@"; }
scp() { command scp $mux "$@"; }
ok()  { printf '✓ %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[ -f deploy/server.env ] || die "deploy/server.env missing (copy deploy/server.env.example and set TUNNEL_TOKEN)"
grep -q '^TUNNEL_TOKEN=.\+' deploy/server.env || die "TUNNEL_TOKEN is empty in deploy/server.env"
gh auth status >/dev/null 2>&1 || die "gh is not logged in"
ssh -o BatchMode=yes "$host" true || die "cannot ssh to $host"
user=$(ssh "$host" id -un)

# 1. Directories
ssh "$host" "sudo install -d -o '$user' -g '$user' '$remote' '$remote/data' '$remote/data/catalog' '$remote/data/media'"
ok "directories under $remote"

# 2. Checkout
ssh "$host" "test -d '$remote/app/.git' || git clone -q --branch main 'https://github.com/$repo.git' '$remote/app'; git -C '$remote/app' remote set-url origin 'https://github.com/$repo.git'; git -C '$remote/app' fetch -q origin main && git -C '$remote/app' reset -q --hard origin/main"
ok "checkout at $remote/app ($(ssh "$host" "git -C '$remote/app' rev-parse --short HEAD"))"

# 3. CI key with a forced command
if gh secret list -R "$repo" | grep -q '^VPS_SSH_KEY'; then
    ok "VPS_SSH_KEY already set (delete the secret and the 'drums-ci' line in authorized_keys to rotate)"
else
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    ssh-keygen -q -t ed25519 -N '' -C 'drums-ci' -f "$tmp/ci"
    entry="command=\"$remote/app/deploy/remote-deploy.sh\",restrict $(cat "$tmp/ci.pub")"
    ssh "$host" "grep -v ' drums-ci\$' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.new || true; printf '%s\n' '$entry' >> ~/.ssh/authorized_keys.new; chmod 600 ~/.ssh/authorized_keys.new; mv ~/.ssh/authorized_keys.new ~/.ssh/authorized_keys"
    gh secret set VPS_SSH_KEY -R "$repo" < "$tmp/ci"
    hostname=$(ssh -G "$host" | awk '/^hostname /{print $2}'); port=$(ssh -G "$host" | awk '/^port /{print $2}')
    ssh-keyscan -q -p "$port" "$hostname" | gh secret set VPS_KNOWN_HOSTS -R "$repo"
    gh variable set VPS_HOST -R "$repo" --body "$hostname"
    gh variable set VPS_PORT -R "$repo" --body "$port"
    gh variable set VPS_USER -R "$repo" --body "$user"
    ok "CI key installed (forced command) and stored as VPS_SSH_KEY; local copy deleted"
fi

# 4. Server env
scp -q deploy/server.env "$host:$remote/server.env.new"
ssh "$host" "chmod 600 '$remote/server.env.new' && mv '$remote/server.env.new' '$remote/server.env'"
ok "server.env installed"

# 5. Data, then the stack
deploy/sync.sh push --no-build --yes
ssh "$host" "'$remote/app/deploy/remote-deploy.sh' --no-pull"
ok "stack running; check https://media.re20.one/healthz and https://re20.one"
