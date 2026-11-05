#!/usr/bin/env bash
# Forced-command target for the CI deploy key. authorized_keys entry:
#   restrict,command="/home/runner/frontdesk/bin/deploy.sh" ssh-ed25519 AAAA... frontdesk-deploy
# The key can run only this script, with one of:
#   deploy <40-hex sha>   gzip'd `docker save` of frontdesk-api:<sha> on stdin
#   status <40-hex sha>   prints /readyz; exits 0 only if that sha is live and ready
set -euo pipefail
umask 077
root=/home/runner/frontdesk
log="$root/deployments.log"
say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$log" >&2; }

read -r action sha extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
[[ -z "${extra:-}" ]] || { say "refused: extra arguments"; exit 2; }
[[ "${sha:-}" =~ ^[a-f0-9]{40}$ ]] || { say "refused: invalid sha"; exit 2; }

ready() { curl -fsS --max-time 3 http://127.0.0.1:3110/readyz; }

case "${action:-}" in
  status)
    body=$(ready) || { echo "not ready"; exit 1; }
    echo "$body"
    [[ "$body" == *"\"release\":\"$sha\""* ]] || { echo "live release differs"; exit 1; }
    exit 0 ;;
  deploy) ;;
  *) say "refused: unknown action"; exit 2 ;;
esac

exec 9>"$root/.deploy.lock"
flock -n 9 || { say "refused: another deploy is running"; exit 3; }

image="frontdesk-api:$sha"
say "deploy $sha: loading image"
# Cap the compressed stream at 400 MB and the unpacked tar at 1.5 GB.
head -c 400000000 | gunzip | head -c 1500000000 | docker load >/dev/null
docker image inspect "$image" >/dev/null 2>&1 || { say "refused: $image not in stream"; exit 4; }
label=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$label" == "$sha" ]] || { say "refused: revision label $label != $sha"; docker image rm "$image" >/dev/null; exit 4; }

previous=$(cat "$root/current-sha" 2>/dev/null || true)
up() { RELEASE_SHA="$1" docker compose -f "$root/compose.yaml" --env-file "$root/.env" -p frontdesk up -d --remove-orphans >/dev/null; }

say "deploy $sha: starting (previous ${previous:-none})"
up "$sha"
healthy=0
for _ in $(seq 1 30); do
  body=$(ready 2>/dev/null || true)
  if [[ "$body" == *"\"release\":\"$sha\""* ]]; then healthy=1; break; fi
  sleep 2
done

if [[ $healthy != 1 ]]; then
  if [[ -n "$previous" ]] && docker image inspect "frontdesk-api:$previous" >/dev/null 2>&1; then
    say "deploy $sha: NOT READY, rolling back to $previous"
    up "$previous"
  else
    say "deploy $sha: NOT READY, no previous release to restore"
  fi
  exit 5
fi

printf '%s\n' "$sha" > "$root/current-sha"
# Keep the three newest API images; never remove the live one.
# (`|| true`: with one or two images the filters match nothing, which isn't an error.)
{ docker image ls frontdesk-api --format '{{.Tag}}' | grep -E '^[a-f0-9]{40}$' | grep -vx "$sha" | tail -n +3 || true; } |
  while read -r old; do docker image rm "frontdesk-api:$old" >/dev/null 2>&1 || true; done
say "deploy $sha: live and ready"
