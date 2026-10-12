#!/bin/sh
# Daily PlanB backup (database + assets together); keeps the newest 14 daily archives.
set -eu
cd /opt/planb/app
PLANB_DATA_DIR=/var/lib/planb /opt/planb/node/bin/node dist/server/cli.js backup --out "/var/backups/planb/planb-daily-$(date +%F).tar.gz"
ls -1t /var/backups/planb/planb-daily-*.tar.gz | tail -n +15 | xargs -r rm --
