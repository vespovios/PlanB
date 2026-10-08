# Delivery A acceptance status

Run on 8 October 2026: macOS (Apple silicon), Node 22.22, Chromium (Playwright), Docker 29 via Colima. The external agent was Claude Code 2.1.283 (`claude -p`, Sonnet) connected over MCP to a locally running production build.

Automated suites:

- `npm test`: 24 Vitest tests across `tests/api.test.ts`, `tests/mcp.test.ts` and `tests/persistence.test.ts`. The MCP tests use the official MCP SDK client over real HTTP.
- `npm run test:e2e`: 9 Playwright tests. 7 run at desktop size (1360×900) and 2 on a Pixel 7 profile with touch.
- `scripts/docker-smoke.sh`: the container image, storyboard text rendering with container fonts, and backup → restore into a fresh volume.

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Login, four sample scenes, reopen from another browser | **Passed** | e2e "timeline editing…" (second browser context sees the same plan); api "creates the example opening" |
| 2 | Packing 45 → 60 s: total 3:00, later starts +15 s | **Passed** | api "changing packing…"; e2e checks the runtime shows 03:00 and Loading starts at 01:00 |
| 3 | Reorder keeps descriptions, IDs, shots, captured flags | **Passed** | api "reordering keeps IDs…"; e2e drag-reorder on the timeline, then checks the ID and captured flag |
| 4 | Phone: create/edit scene, change duration, reorder, tick captured, no hover or precise drag | **Passed** | e2e phone test: tap-only stepper, ↑/↓ buttons, checkbox, full-screen scene sheet |
| 5 | External agent reads, adds a shot, change shows in app | **Passed** | Real Claude Code session over MCP (below); e2e "agent write appears live" (SSE, no reload) |
| 6 | Human edit after agent read → stale agent write rejected, human edit kept | **Passed** | api + e2e: 409 `stale_revision` lists the newer revision; the human value is unchanged |
| 7 | Undo/restore an agent revision; later edits handled explicitly | **Passed** | e2e History → Undo lists the later human revision and asks to confirm; api checks restore creates a new revision and history is kept |
| 8 | Print checklist with descriptions, priorities, captured; restart persists | **Passed** | e2e print media + PDF; persistence "survives a restart"; production server restarted several times during the session |
| 9 | Unauthenticated and cross-account access denied, incl. agent API | **Passed** | api "account isolation" (cookie and token, episodes/changes/assets/thumbnails/export/revisions); mcp test (other account's agent) |
| 10 | Outline saved, read and revised by the agent, editable on desktop and phone; empty outline blocks nothing | **Passed** | Real agent wrote and revised the outline; e2e desktop starter/edit; e2e phone outline edit; api "outline is optional" |
| 11 | More than five scenes alongside the five-beat starter; purpose/VO/audio in agent read/write | **Passed** | api: 7 scenes plus the starter; e2e: 7 scenes; mcp test writes and reads purpose, voiceover and audio |
| 12 | Conversational review with a real agent, including an unexpected reported event | **Passed (reviewed manually)** | See "Agent conversation" below. This was a single-session review, not a creative-quality claim. |
| 13 | Timeline and Cards agree; IDs, artwork, shots and notes preserved; status and captured independent; optional fields unobtrusive | **Passed** | e2e reorder in both views; card shows "1/3 captured" while status stays Draft; empty scene shows only "+ …" chips |
| 14 | Blank and image-background sketches with freehand, arrow, shape and text; reopen, alter, save; matches after restart and on another device; phone touch; Cancel keeps saved; failed/stale save keeps local work | **Passed** | e2e desktop sketch (blank, then over an uploaded image; Cancel → saved unchanged; opened on a second phone-sized session); e2e phone touch drawing over an image, reload, move label; e2e offline save keeps the editor and strokes; api: stale drawing save publishes no preview |
| 15 | Agent retrieves reference and drawing, attaches a reference, makes a valid drawing update; text-only edit keeps artwork; cross-account denial for originals/previews/exports; DB + assets restore | **Passed** | mcp test; real Claude Code added a link and a storyboard, then inspected the PNG with `get_image`; api text-only edit; persistence backup → restore into an empty directory; Docker smoke test |
| 16 | Download plan inspected outside the app | **Passed** | persistence "portable export": schema version, revision, IDs/order/durations, every relative path resolves, editable JSON + PNG, no-sketch scene handled, no tokens/cookies/hashes/app URLs |

## Agent conversation (check 12), with the real agent

Episode "Heading for the mountains", account `peter@example.com`, revisions 4–7. You can inspect it in the running app under History.

1. **Planning request** (future two-day ride; stated equipment: one action camera, a phone, a small drone; about two hours of filming per day). The agent called `get_workflow_guide`, read the episode and wrote revision 4 in one batch. It added an open-ended outline ("Day two is still unwritten…"), one new scene after the fuel stop with purpose, VO intent and three shots (drone shot noted as quick because of the time budget), and a `Question:` in loose notes. Nothing else changed.
2. **Human edits in the browser** (revision 5): renamed that scene to "First pass: Passo Giau" and changed the drone shot to Optional.
3. **Reported event** (strap came loose at the fuel stop, a 40-minute fix with a stranger's spare strap, no coffee, the strap fix filmed on a phone but not reviewed, foggy arrival, drone shot doubtful). The agent re-read and wrote revision 6:
   - It **kept both human edits.**
   - It recorded an `Observed:` entry separate from the existing `Question:`, and kept day two open.
   - It rewrote the fuel-stop scene from the reported facts, with no invented dialogue or outcome. The VO intent is "tell it plainly… no need to dramatize".
   - It marked only the shot the creator said was filmed as captured, with the note "footage not yet reviewed".
   - It noticed that the creator's claim "I ticked the shots" didn't match the saved data, and asked rather than guessing.
   - Debatable: it removed the planned coffee shot rather than leaving it unticked. The original remains in History.
4. **Visual request** (revision 7): it added a reference link and a storyboard through the schema, then inspected the rendered PNG with `get_image` and correctly reported that a label was clipped at the canvas edge. That prompted clearer text-width guidance in the schema.

## Outstanding and limitations

- **Ten-minute usability target:** not validated. This needs Peter's real planning session ("describe an idea, generate an outline and reshape it in about ten minutes"); feature completion doesn't establish it.
- **A real VPS deployment was not done** (no provider or domain supplied). The Docker image, compose file and Caddy config were built and smoke-tested locally; HTTPS issuance through Caddy needs a real domain. Steps are in [SETUP.md](SETUP.md).
- **MCP clients tested:** Claude Code (Streamable HTTP) and the official TypeScript SDK client. Claude Desktop and other clients were not tried; stdio-only clients need a bridge such as `mcp-remote`.
- **Physical devices:** phone behaviour was tested with Chromium's Pixel 7 emulation (touch events, 412 px width) and the in-app browser at 612 px. It was not tested on a physical iPhone/Android or in Safari.
- **Offline:** by design, editing needs a connection. Pending edits survive a dropped connection while the page stays open (and drawings survive a reload via local storage), but there is no offline mode.
- **Drawing:** one storyboard per scene, five object types, select/move/resize (corner handle), undo/redo, six colours and three stroke widths. There is no rotation, multi-select, icon library or multiple panels, as the brief scoped.
- Deliveries B and C are documented in [ROADMAP.md](ROADMAP.md) and not implemented.

## Independent code review

A separate review pass (authorization, revision integrity, operations, client save engine, backup/restore) found no authorization, path-traversal or export-leak issues. Its findings were fixed and covered by regression tests:

- A History confirmation is now tied to the revision it was shown for. A revision saved while the dialog is open causes a re-prompt; it is never reverted silently.
- Restore is refused while edits are unsaved or conflicted.
- The per-e-mail login throttle normalises whitespace.
- A whitespace-only scene title returns a clear 400 instead of a 500.
- Server errors are no longer retried indefinitely.
- "Saved" is only shown when nothing is queued.
- Refused-change messages stay visible until dismissed.
- Live updates that arrive during a save are applied afterwards.
- An item ID removed in a batch can't be reused within the same batch.

Known minor gaps left as is: if a save's response is lost after the server committed it, the automatic resend can report the already-saved edit as "discarded" (the data itself is correct). Restore does not detect a still-running server; stop it first, as documented.
