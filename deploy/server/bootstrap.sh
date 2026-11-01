#!/usr/bin/env bash
# One-time setup as `runner` (no sudo). Re-running is safe: secrets are generated only once.
#   bash bootstrap.sh   (run from the directory holding deploy.sh and compose.production.yaml)
set -euo pipefail
umask 077
here=$(cd "$(dirname "$0")" && pwd)
root=/home/runner/frontdesk
install -d -m 700 "$root" "$root/bin"
install -m 700 "$here/deploy.sh" "$root/bin/deploy.sh"
install -m 600 "$here/compose.production.yaml" "$root/compose.yaml"
for f in setup-host.sh reclaim-system.sh teardown-demos.sh; do
  [[ -f "$here/$f" ]] && install -m 700 "$here/$f" "$root/bin/$f"
done
if [[ ! -f "$root/.env" ]]; then
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
    echo "REDIS_PASSWORD=$(openssl rand -hex 32)"
  } > "$root/.env"
  echo "Generated $root/.env (mode 600)."
else
  echo "Kept existing $root/.env."
fi
chmod 600 "$root/.env"
touch "$root/deployments.log"
echo "Bootstrap complete."
