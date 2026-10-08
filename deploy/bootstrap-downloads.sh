#!/usr/bin/env bash
# One-time (idempotent) setup for the download host that the downloads
# workflow publishes to. Run from the repo root:
#
#   deploy/bootstrap-downloads.sh
#
# Needs: ssh vpsau2, gh logged in with admin on the repo.
#   1. installs deploy/downloads.sh on the host as ~/bin/vdvm-downloads (rerun after changing it)
#   2. CI key: generated here, installed with a forced command (vdvm-downloads only),
#      stored as GitHub secrets DL_SSH_KEY and DL_KNOWN_HOSTS; the local copy is deleted

set -euo pipefail

host=${VDVM_DL_HOST:-vpsau2}
repo=${VDVM_REPO:-crnst8/vdvm}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ok() { printf '✓ %s\n' "$*"; }

gh auth status >/dev/null 2>&1 || { echo "gh is not logged in" >&2; exit 1; }
user=$(ssh "$host" id -un)
home=$(ssh "$host" 'echo $HOME')

ssh "$host" 'mkdir -p ~/bin && cat > ~/bin/vdvm-downloads.new && chmod 755 ~/bin/vdvm-downloads.new && mv ~/bin/vdvm-downloads.new ~/bin/vdvm-downloads' < "$root/deploy/downloads.sh"
ok "~/bin/vdvm-downloads on $host"

if gh secret list -R "$repo" | grep -q '^DL_SSH_KEY'; then
    ok "DL_SSH_KEY already set (delete the secret and the 'vdvm-dl-ci' line in authorized_keys to rotate)"
else
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    ssh-keygen -q -t ed25519 -N '' -C 'vdvm-dl-ci' -f "$tmp/ci"
    entry="command=\"$home/bin/vdvm-downloads\",restrict $(cat "$tmp/ci.pub")"
    ssh "$host" "grep -v ' vdvm-dl-ci\$' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.new || true; printf '%s\n' '$entry' >> ~/.ssh/authorized_keys.new; chmod 600 ~/.ssh/authorized_keys.new; mv ~/.ssh/authorized_keys.new ~/.ssh/authorized_keys"
    gh secret set DL_SSH_KEY -R "$repo" < "$tmp/ci"
    # GitHub runners reach the host on its public address, not the ssh alias's (which may be a tailnet IP).
    hostname=$(ssh "$host" 'curl -fsS -4 https://ifconfig.me'); port=$(ssh -G "$host" | awk '/^port /{print $2}')
    ssh-keyscan -q -p "$port" "$hostname" | gh secret set DL_KNOWN_HOSTS -R "$repo"
    gh variable set DL_HOST -R "$repo" --body "$hostname"
    gh variable set DL_PORT -R "$repo" --body "$port"
    gh variable set DL_USER -R "$repo" --body "$user"
    ok "CI key installed (forced command) and stored as DL_SSH_KEY; local copy deleted"
fi
