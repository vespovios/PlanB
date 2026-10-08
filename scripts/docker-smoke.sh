#!/usr/bin/env bash
# Smoke-tests the Docker image: account setup, storyboard rendering (fonts), backup and restore
# into a fresh volume. Usage: scripts/docker-smoke.sh [image]   (default planb:latest)
set -euo pipefail
IMAGE=${1:-planb:latest}
T="$(pwd)/.docker-smoke/$(date +%s)"
mkdir -p "$T"
# Named volumes behave like a VPS data directory owned by the container user.
V1=planb-smoke-data-$$; V2=planb-smoke-restored-$$; VB=planb-smoke-backups-$$
cleanup() {
  docker rm -f planb-smoke planb-smoke2 >/dev/null 2>&1 || true
  docker volume rm -f "$V1" "$V2" "$VB" >/dev/null 2>&1 || true
}
trap cleanup EXIT
j() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

TOKEN=$(docker run --rm -v "$V1:/data" "$IMAGE" sh -c \
  'printf "container-password-1\n" | node dist/server/cli.js user:add --email vps@example.com --name VPS --password-stdin >/dev/null && node dist/server/cli.js token:create --email vps@example.com --label smoke')
docker run -d --name planb-smoke -p 127.0.0.1:8790:8787 -e PLANB_SECURE_COOKIES=false -v "$V1:/data" -v "$VB:/backups" "$IMAGE" >/dev/null
for i in $(seq 1 20); do curl -fs localhost:8790/api/health >/dev/null && break; sleep 0.5; done
echo "health: $(curl -s localhost:8790/api/health)"
H=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json')
EP=$(curl -s -X POST localhost:8790/api/episodes "${H[@]}" -d '{"title":"Container test","withExample":true}')
ID=$(echo "$EP" | j 'd["episode"]["id"]'); SC=$(echo "$EP" | j 'd["episode"]["scenes"][0]["id"]'); REV=$(echo "$EP" | j 'd["episode"]["revision"]')
CH=$(curl -s -X POST "localhost:8790/api/episodes/$ID/changes" "${H[@]}" -d "{\"baseRevision\":$REV,\"operations\":[{\"op\":\"saveStoryboard\",\"sceneId\":\"$SC\",\"storyboard\":{\"objects\":[{\"id\":\"t\",\"type\":\"text\",\"x\":100,\"y\":100,\"text\":\"Text rendered in the container\",\"color\":\"#111827\",\"size\":80},{\"id\":\"a\",\"type\":\"arrow\",\"x1\":100,\"y1\":600,\"x2\":900,\"y2\":400,\"color\":\"#dc2626\",\"width\":8}]}}]}")
PREV=$(echo "$CH" | j 'd["episode"]["scenes"][0]["storyboard"]["previewAssetId"]')
curl -s "localhost:8790/api/assets/$PREV" -H "authorization: Bearer $TOKEN" -o "$T/preview.png"
echo "preview: $T/preview.png ($(wc -c <"$T/preview.png") bytes)"
docker exec planb-smoke node dist/server/cli.js backup --out /backups/smoke.tar.gz
docker rm -f planb-smoke >/dev/null
docker run --rm -v "$V2:/data" -v "$VB:/backups" "$IMAGE" node dist/server/cli.js restore --from /backups/smoke.tar.gz --yes
docker run -d --name planb-smoke2 -p 127.0.0.1:8791:8787 -v "$V2:/data" "$IMAGE" >/dev/null
for i in $(seq 1 20); do curl -fs localhost:8791/api/health >/dev/null && break; sleep 0.5; done
curl -s "localhost:8791/api/episodes/$ID" -H "authorization: Bearer $TOKEN" | j '"restored: %s, revision %s, %d scenes" % (d["episode"]["title"], d["episode"]["revision"], len(d["episode"]["scenes"]))'
echo "restored preview: HTTP $(curl -s -o /dev/null -w '%{http_code}' "localhost:8791/api/assets/$PREV" -H "authorization: Bearer $TOKEN")"
