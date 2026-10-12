# PlanB setup and operations

## Recorded first-build decisions

| Decision | Choice in this build |
| --- | --- |
| Accounts | **Privately provisioned.** There is no public sign-up; the server administrator creates accounts with the CLI. |
| Editing mode | **Online editing.** Edits need a connection to the server. If the connection drops, unsaved edits stay on the page, are marked "Not saved", and are retried. Nothing shows as saved until the server accepts it. A drawing that hasn't been saved is also kept in the browser's local storage, so it can be recovered after a reload. Offline sync is not implemented. |
| Agent connection | Stateless **MCP over Streamable HTTP** at `https://<your-domain>/mcp`, plus the same operations over REST. The agent authenticates with a revocable **bearer token**, never the account password. |
| Concurrency | Every write names the revision it was based on. **Agent** writes against an old revision are rejected (HTTP 409 / `stale_revision`). The browser re-applies its own pending edit on the newer revision only if nobody else changed the same field; otherwise it shows *Keep mine / Use newer*. |
| Undo | Every save is a revision with author and summary. **History → Undo / Go back here** restores an earlier version as a *new* revision. If that would also revert later revisions, PlanB lists them and asks for confirmation. Scene deletion has an immediate Undo. |
| Storage | One SQLite file (`planb.db`) and an `assets/` folder in `PLANB_DATA_DIR`. Asset files are immutable and named by ID, and are never deleted while history references them. |
| Image limits | PNG/JPEG only, up to 10 MiB per file and 8000 px per side (50 megapixels). Content is checked on the server. Web links stay links; PlanB never fetches URLs. |

## Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PLANB_DATA_DIR` | `./data` (`/data` in Docker) | Database and assets. **Back this up.** |
| `PLANB_PORT` / `PLANB_HOST` | `8787` / `127.0.0.1` (dev), `0.0.0.0` (production) | Listen address |
| `PLANB_PUBLIC_URL` | `http://localhost:8787` | Public base URL, shown in the agent connection instructions |
| `PLANB_SECURE_COOKIES` | `true` when `NODE_ENV=production` | Secure-only session cookies. Set `false` only for plain-HTTP local testing. |
| `PLANB_TRUST_PROXY` | `true` when `NODE_ENV=production` | Trust `X-Forwarded-*` headers from Caddy |
| `PLANB_SESSION_DAYS` | `30` | Browser session lifetime |
| `PLANB_LOGIN_MAX` | `10` | Failed logins per e-mail per 15 minutes; the per-IP limit is twice this |
| `PLANB_STATIC_DIR` | `dist/client` in production | Built web client |

## Local development

Requirements: Node 22+ and npm. Docker is optional.

```bash
npm install
PLANB_DATA_DIR=./data npm run user -- user:add --email you@example.com --name "You"
npm run dev           # API :8787 (tsx watch) + Vite :5173 with proxy → open http://localhost:5173
npm test              # server, MCP, persistence, export tests
npm run test:e2e      # browser tests (first run: npx playwright install chromium)
```

A local production run:

```bash
npm run build
NODE_ENV=production PLANB_SECURE_COOKIES=false PLANB_HOST=127.0.0.1 npm start   # http://localhost:8787
```

## VPS deployment (Docker + Caddy)

No provider or domain is chosen yet. These steps work on any Linux VPS with Docker Engine and the Compose plugin (for example Ubuntu 24.04 LTS, 1 vCPU and 1 GB RAM or more).

1. **DNS:** point an A (and optionally AAAA) record such as `planb.example.com` at the VPS. Open ports 80 and 443.
2. **Get the code** onto the server (git clone, or copy this folder without `node_modules`, `dist` and `data`).
3. **Configure:**
   ```bash
   cp .env.example .env          # set PLANB_DOMAIN=planb.example.com
   mkdir -p data backups
   sudo chown -R 1000:1000 data backups   # the container runs as the unprivileged "node" user (uid 1000)
   ```
4. **Start:**
   ```bash
   docker compose up -d --build
   docker compose logs -f planb      # wait for "PlanB listening"
   ```
   Caddy obtains the HTTPS certificate automatically on the first request to the domain.
5. **Create your account** (you'll be prompted for a password of at least 10 characters):
   ```bash
   docker compose exec planb node dist/server/cli.js user:add --email you@example.com --name "Your Name"
   ```
6. Open `https://planb.example.com` and sign in.

Other admin commands: `user:list`, `user:password --email …` (resets a password and signs out that user's sessions), `token:create --email … --label …`, `verify`, and `purge-deleted --days 30` (permanently removes episodes deleted in the browser).

### Security notes

- Passwords are hashed with scrypt. Sessions are random tokens stored hashed, in `HttpOnly`, `SameSite=Lax` and (with HTTPS) `Secure` cookies.
- Cookie-authenticated writes require a custom request header, so cross-site forms cannot use a session.
- Logins are rate-limited per IP and per e-mail.
- Agent tokens are stored hashed, shown once, revocable in **Settings**, and cannot manage tokens or passwords.
- Every episode, asset, export and MCP call is checked against the owning account. Other accounts get "not found".
- Keep `.env`, `data/` and `backups/` out of source control (they are in `.gitignore`).

## VPS deployment without Docker (behind an existing nginx)

Use this route when the server already runs nginx on ports 80/443 for other sites, so PlanB's Caddy container can't take those ports. PlanB runs as a systemd service on `127.0.0.1:8787`, and nginx with a certbot certificate sits in front of it. The current production install, **planb.mototwin.app**, runs this way.

The files below are in [`deploy/native/`](../deploy/native/). They are exact copies of the production ones, except that the domain is `planb.example.com`.

| Path on the server | What it holds |
| --- | --- |
| `/opt/planb/app` | The code and its build (`dist/`, `node_modules/`, `docs/`) |
| `/opt/planb/node` | A private Node 22. The system Node and other apps are left alone. |
| `/var/lib/planb` | `planb.db` and `assets/`: **the data** |
| `/var/backups/planb` | Backup archives |
| `/etc/systemd/system/planb.service` | The app service ([planb.service](../deploy/native/planb.service)) |
| `/etc/systemd/system/planb-backup.{service,timer}` | A nightly backup at about 03:15 UTC that keeps 14 archives ([backup.sh](../deploy/native/backup.sh)) |
| `/etc/nginx/sites-available/planb` | The reverse proxy ([nginx-planb.conf](../deploy/native/nginx-planb.conf)) |

### First install

These steps assume Ubuntu 24.04 with nginx and certbot already installed, and an SSH user with sudo. Commands marked *(Mac)* run in the PlanB repo on your computer. Everything else runs on the server.

1. **DNS.** Add an A record for the subdomain pointing at the server, and check that `dig +short planb.example.com` returns the server's IP.
2. **User, folders and packages.** `build-essential` is needed because `better-sqlite3` compiles from source. `fonts-dejavu-core` is needed so storyboard text renders in PNG previews.
   ```bash
   sudo useradd --system --home-dir /var/lib/planb --shell /usr/sbin/nologin planb
   sudo mkdir -p /opt/planb/app /var/lib/planb /var/backups/planb
   sudo chown -R planb:planb /opt/planb /var/lib/planb /var/backups/planb
   sudo chmod 750 /var/lib/planb /var/backups/planb
   sudo apt-get install -y build-essential fonts-dejavu-core fontconfig
   ```
3. **Private Node 22.** Pick the latest v22 from <https://nodejs.org/dist/>. Use `linux-x64` instead of `linux-arm64` on Intel/AMD servers.
   ```bash
   V=v22.23.3; A=linux-arm64
   cd /tmp && curl -fsSLO https://nodejs.org/dist/$V/node-$V-$A.tar.xz
   curl -fsSL https://nodejs.org/dist/$V/SHASUMS256.txt | grep " node-$V-$A.tar.xz$" | sha256sum -c -
   sudo mkdir -p /opt/planb/node && sudo tar -xJf node-$V-$A.tar.xz -C /opt/planb/node --strip-components=1
   ```
4. **Code** *(Mac)*. This ships only committed files, so local data, `.env` and the Story Starter Kit never leave your computer.
   ```bash
   git archive HEAD | ssh <server> 'sudo -u planb tar -xf - -C /opt/planb/app'
   ```
5. **Build.**
   ```bash
   cd /opt/planb/app
   sudo -u planb env PATH=/opt/planb/node/bin:/usr/bin:/bin HOME=/opt/planb npm_config_cache=/opt/planb/.npm-cache \
     sh -c 'npm ci && npm run build && npm prune --omit=dev'
   ```
6. **Service and backups.** Copy the four files from `deploy/native/` to the paths in the table above, and set `PLANB_PUBLIC_URL` in `planb.service`. Then:
   ```bash
   sudo chmod 755 /opt/planb/backup.sh
   sudo systemctl daemon-reload
   sudo systemctl enable --now planb planb-backup.timer
   curl -s http://127.0.0.1:8787/api/health        # {"ok":true,…}
   ```
7. **nginx and HTTPS.** Set `server_name` in the copied `nginx-planb.conf`. The certificate then renews with certbot's existing timer.
   ```bash
   sudo cp nginx-planb.conf /etc/nginx/sites-available/planb
   sudo ln -s /etc/nginx/sites-available/planb /etc/nginx/sites-enabled/planb
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d planb.example.com --redirect
   ```
   If certbot fails with `No such authorization`, wait a minute and run it again. That is a temporary Let's Encrypt error.
8. **Data.** Either create an account, or bring an existing install across.
   - To create an account: `cd /opt/planb/app && sudo -u planb env PLANB_DATA_DIR=/var/lib/planb /opt/planb/node/bin/node dist/server/cli.js user:add --email you@example.com --name "You"`.
   - To bring an existing install across, run a `backup` there, copy the archive to `/var/backups/planb/`, then on the server stop PlanB, restore and start it again:
     ```bash
     sudo systemctl stop planb
     cd /opt/planb/app && sudo -u planb env PLANB_DATA_DIR=/var/lib/planb /opt/planb/node/bin/node dist/server/cli.js restore --from /var/backups/planb/<file>.tar.gz --yes
     sudo systemctl start planb
     ```
     Accounts, episodes, history and agent tokens all come across. Agents only need the new URL.

Logs: `journalctl -u planb -f`. Status: `systemctl status planb`.

Run other CLI commands (`user:list`, `user:password`, `token:create`, `verify`, …) from `/opt/planb/app` like this:

```bash
sudo -u planb env PLANB_DATA_DIR=/var/lib/planb /opt/planb/node/bin/node dist/server/cli.js <command>
```

## Connecting your agent

1. In PlanB, open **Settings → Agent connections**, enter a name (for example "Claude"), and click **Create token**. Copy the token; it is shown once.
2. Connect an MCP client. For Claude Code:
   ```bash
   claude mcp add --transport http planb https://planb.example.com/mcp \
     --header "Authorization: Bearer planb_…"
   ```
   Other clients need the Streamable HTTP URL `https://planb.example.com/mcp` and the header `Authorization: Bearer <token>`. A client that only supports stdio can use a generic stdio↔HTTP bridge such as `mcp-remote` with the same URL and header.
3. Give the agent [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md), or ask it to call the `get_workflow_guide` tool.
4. To disconnect, click **Revoke** next to the token.

The agent's changes show up in your open browser within a second or two, and in **History** with the token's name.

## Backup and restore (database + assets together)

A database-only backup is **not** enough: storyboards and references live in `data/assets/`. The CLI backs up both consistently while the app is running. It takes an online SQLite snapshot first, then copies the immutable asset files, and checks that every asset the snapshot refers to is included.

```bash
# Backup (app may keep running) → ./backups/planb-YYYY….tar.gz on the host
docker compose exec planb node dist/server/cli.js backup --out /backups/planb-$(date +%F).tar.gz

# Restore (stop the app first; the current data is kept in data/pre-restore-<time>/)
docker compose stop planb
docker compose run --rm planb node dist/server/cli.js restore --from /backups/planb-2026-10-08.tar.gz --yes
docker compose start planb
```

Each archive contains `manifest.json`, `planb.db` (with full revision history for undo) and `assets/`. Restore checks database integrity and asset completeness before replacing anything, then applies any newer migrations.

Suggested schedule: a daily cron job on the host running the backup command, plus an off-site copy of `backups/` (for example with `rclone` or your provider's snapshots). Test a restore occasionally with `scripts/docker-smoke.sh`, or by restoring into a scratch directory.

Without Docker: `PLANB_DATA_DIR=/srv/planb/data node dist/server/cli.js backup --out …`, with the same `restore` command. The [nginx install](#vps-deployment-without-docker-behind-an-existing-nginx) already has a nightly backup timer. To run one now, use `sudo systemctl start planb-backup.service`. Archives land in `/var/backups/planb/`, on the same disk, so copy them off the server too.

## Upgrades

```bash
docker compose exec planb node dist/server/cli.js backup --out /backups/pre-upgrade-$(date +%F).tar.gz
git pull                        # or copy the new release
docker compose up -d --build
```

For the nginx install, run these steps in order:

1. *(Mac)* Commit the change.
2. Back up first:
   ```bash
   ssh <server> 'sudo systemctl start planb-backup.service'
   ```
3. *(Mac)* Ship the new code:
   ```bash
   git archive HEAD | ssh <server> 'sudo -u planb tar -xf - -C /opt/planb/app'
   ```
4. Build:
   ```bash
   cd /opt/planb/app && sudo -u planb env PATH=/opt/planb/node/bin:/usr/bin:/bin HOME=/opt/planb npm_config_cache=/opt/planb/.npm-cache \
     sh -c 'npm ci && npm run build && npm prune --omit=dev'
   ```
5. Restart:
   ```bash
   sudo systemctl restart planb
   ```
6. Check it's back:
   ```bash
   curl -s https://planb.example.com/api/health
   ```

`git archive` overwrites changed files but doesn't delete files that were removed from the repo. That is harmless for PlanB, because the build output is regenerated each time.

Database migrations are append-only and run automatically on start. Asset files are immutable and keyed by ID, and revisions refer to them by ID, so upgrades never rewrite or rename assets. Undo history stays valid across upgrades. If an upgrade misbehaves, restore the pre-upgrade backup with the previous image.
