#!/usr/bin/env bash
# Runs on vpsau3. Brings /opt/drums/app to origin/main and (re)starts the
# container stack. GitHub Actions reaches it through a restricted SSH key whose
# authorized_keys entry forces this command; deploy/sync.sh calls it with
# --no-pull after changing server.env.
#
#   remote-deploy.sh            fetch origin/main, rebuild, restart, health check
#   remote-deploy.sh --no-pull  restart with the current checkout
#   remote-deploy.sh status     show the deployed commit and container state
#
# Layout: /opt/drums/app (git checkout), /opt/drums/data (rsynced catalog and
# media), /opt/drums/server.env (mode 0600: DRUMS_DATA, DRUMS_PORT,
# COMPOSE_PROFILES, TUNNEL_TOKEN).

# The whole script is parsed before it runs, so `git reset` replacing this
# file mid-run cannot change what executes.
{
set -euo pipefail

base=${DRUMS_REMOTE:-/opt/drums}
app=$base/app
env_file=$base/server.env

# A forced-command key passes the client's requested command here.
args=${SSH_ORIGINAL_COMMAND:-${*:-}}
action=deploy
case $args in
    ''|deploy) action=deploy ;;
    --no-pull) action=restart ;;
    status) action=status ;;
    *) echo "unknown request: $args" >&2; exit 2 ;;
esac

compose() { docker compose -f "$app/deploy/compose.yml" --env-file "$env_file" "$@"; }

[ -f "$env_file" ] || { echo "missing $env_file" >&2; exit 1; }

if [ "$action" = status ]; then
    git -C "$app" log -1 --format='%h %s (%cr)'
    compose ps
    exit 0
fi

exec 9>"$base/.deploy.lock"
flock -w 600 9 || { echo "another deploy is running" >&2; exit 1; }

if [ "$action" = deploy ]; then
    git -C "$app" fetch -q --prune origin main
    git -C "$app" reset -q --hard origin/main
fi
echo "deploying $(git -C "$app" log -1 --format='%h %s')"

compose up -d --build --remove-orphans --wait --wait-timeout 120
docker image prune -f >/dev/null

port=$(sed -n 's/^DRUMS_PORT=//p' "$env_file"); port=${port:-8080}
curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null
curl -fsS -o /dev/null "http://127.0.0.1:$port/catalog/index.json" || echo "warning: no catalog in data dir yet (run deploy/sync.sh push)" >&2
echo "ok: $(git -C "$app" rev-parse --short HEAD) live"
exit 0
}
