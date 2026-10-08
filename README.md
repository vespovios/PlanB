<p align="center"><img src="branding/planb-logo-strip.png" alt="PlanB" width="420"></p>

# PlanB

PlanB is a small, private, editor-independent episode planner for individual YouTube creators. It turns an episode idea into timed scenes, shot checklists and a practical filming plan. The creator and their own external agent edit the same saved project.

This repository implements **Delivery A** of the v0.3 brief in [`PlanB-Handoff/`](PlanB-Handoff/START-HERE.md), which is kept unchanged as the source specification. Deliveries B (playback) and C (editor adapters) are documented in [`docs/ROADMAP.md`](docs/ROADMAP.md) and are **not** implemented.

## What it does

- **Accounts:** private, administrator-provisioned accounts with password login. Revocable agent tokens are created per account.
- **Episodes:** each episode has a brief, an optional story outline (with an optional Setup/Desire/Conflict/Change/Result starter), loose notes, a target runtime and a draft/ready status.
- **Scenes:** one ordered scene sequence, shown two ways:
  - **Timeline:** the approved layout. Scene details sit above left, shots above right, and timed blocks run along the bottom. Drag to reorder, drag an edge to resize, with buttons and keyboard shortcuts for the same actions. Includes a ruler, Fit and zoom.
  - **Cards:** an ordered storyboard of cards showing a thumbnail, duration, draft/ready status and captured count. Phones always use this view.
- **Scene details:** title, duration, planning status, what happens, purpose, plus optional location, notes, voice-over, audio/music, references and a storyboard. Optional fields stay collapsed until used.
- **Shot checklist:** untimed; each shot has framing, description, camera notes, essential/optional priority and a captured flag.
- **References and storyboards:** PNG/JPEG image references and labelled links. Each scene has one simple storyboard drawing (freehand, arrow, rectangle, ellipse, text, select/move/resize, undo/redo) on a fixed 16:9 canvas. It is stored as editable JSON, and the server renders a matching PNG preview in the same revision.
- **Filming checklist and print view:** story order, or grouped by location. It works on a phone and prints to paper or PDF.
- **Revisions:** every save is a revision. Stale writes are rejected, and you can undo or restore from History; nothing is erased.
- **Agent access:** an authenticated REST API and an MCP server (Streamable HTTP) with the same validation and save logic as the browser. Agent writes appear in open browsers live.
- **Download plan:** a portable ZIP containing `plan.json`, `plan.md`, `assets/` and `storyboards/`, all from one saved revision.
- **Deployment:** Docker + Caddy (HTTPS), with backup/restore that keeps the database and assets together.

## Stack (and why)

| Part | Choice | Reason |
| --- | --- | --- |
| Server | Node 22, TypeScript, [Fastify](https://fastify.dev) | Small, fast and well maintained. One process serves the API, the MCP endpoint and the web client. |
| Storage | SQLite (`better-sqlite3`) in WAL mode, plus a files directory | One file and one folder on the VPS, with no database server. Online backups use SQLite's backup API. |
| Validation | `zod`, shared by browser, REST and MCP | One definition of a valid episode and drawing for every writer. |
| Web client | React + Vite, plain CSS | Familiar and small. No UI framework or router dependency. |
| Drawings | Custom SVG editor + `sharp` on the server | A tiny JSON schema that agents can write. The PNG is rendered from the saved document, so the preview always matches. |
| Agent | `@modelcontextprotocol/sdk`, stateless Streamable HTTP at `/mcp` | Remote MCP clients connect with a URL and bearer token; nothing to install on the client side. |
| Export | `fflate` ZIP | Pure JS, no native dependencies. |
| Deploy | Docker, docker-compose, Caddy | One app container and automatic HTTPS. Data stays in host directories. |

## Quick start (local)

```bash
npm install
npm run build
PLANB_DATA_DIR=./data npm run user -- user:add --email you@example.com --name "You"
NODE_ENV=production PLANB_SECURE_COOKIES=false PLANB_HOST=127.0.0.1 npm start
# open http://localhost:8787
```

For development with hot reload, run `npm run dev` (API on :8787, Vite on :5173 with a proxy).

## Documentation

- [docs/SETUP.md](docs/SETUP.md): local setup, VPS deployment, accounts, agent connection, backup/restore and upgrades.
- [docs/API.md](docs/API.md): REST endpoints, change operations, revision rules and MCP tools.
- [docs/PLAN-FORMAT.md](docs/PLAN-FORMAT.md): the export bundle and the storyboard document schema.
- [docs/AGENT-WORKFLOW.md](docs/AGENT-WORKFLOW.md): the external-agent workflow to give your agent.
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md): Delivery A acceptance checks, with what was tested and what is still outstanding.
- [docs/ROADMAP.md](docs/ROADMAP.md): Deliveries B and C, preserved for later.

## Tests

```bash
npm test            # API, MCP (real HTTP + official SDK client), persistence, backup/restore, export
npm run test:e2e    # Playwright: desktop and phone (touch) flows, drawing, live agent sync, print
scripts/docker-smoke.sh planb:latest   # container: rendering fonts, backup → restore into a fresh volume
```

## Repository layout

```
src/shared/   model, change operations, storyboard schema + SVG renderer, checklist (used by client and server)
src/server/   Fastify app, auth, episodes/revisions, assets, export, MCP adapter, admin CLI
src/client/   React app: planner (timeline, cards, scene details, shots, references), storyboard editor, checklist
tests/        Vitest (server, MCP, persistence) and Playwright (tests/e2e)
deploy/       Caddyfile
branding/     source logo (PLANB-LOGO.png) and README strip; scripts/brand-assets.mjs regenerates the web logo and icons
docs/         user and operator documentation
PlanB-Handoff/  the original v0.3 brief (unchanged)
```
