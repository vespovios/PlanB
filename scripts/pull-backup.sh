#!/bin/sh
# Takes a fresh backup on the VPS and copies it to this computer (backups/vps/), then checks it.
# Usage: scripts/pull-backup.sh [ssh-host]   (default: mototwin.app)
set -eu
HOST="${1:-mototwin.app}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/backups/vps"
NAME="planb-$(date -u +%Y-%m-%dT%H%M%SZ).tar.gz"
mkdir -p "$DEST"

echo "Backing up on ${HOST}..."
ssh "$HOST" "cd /opt/planb/app && sudo -u planb env PLANB_DATA_DIR=/var/lib/planb /opt/planb/node/bin/node dist/server/cli.js backup --out /var/backups/planb/$NAME"
ssh "$HOST" "sudo cat /var/backups/planb/$NAME" > "$DEST/$NAME"
# The copy on the server is kept; the server's own nightly backups prune themselves.

echo "Checking ${DEST}/${NAME}..."
tar -tzf "$DEST/$NAME" | grep -qx 'manifest.json'
tar -tzf "$DEST/$NAME" | grep -qx 'planb.db'
tar -xzOf "$DEST/$NAME" manifest.json
echo
echo "Saved $(du -h "$DEST/$NAME" | cut -f1) to $DEST/$NAME"
