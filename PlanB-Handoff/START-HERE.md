# PlanB coding handoff

**Draft v0.3 — 5 October 2026.**

Read PLANB-SPEC.md, VISUAL-PLANNING.md and AGENT-WORKFLOW.md in full, then inspect references/approved-interface.png and references/logo-sketch.jpg. Build Delivery A of the specification. CHANGELOG.md identifies the additions since the original handoff. Deliveries B and C are documented roadmap work, not part of this first implementation.

## What is settled

PlanB is a lightweight episode planner for individual YouTube creators. It runs on a VPS behind account login, works on desktop and mobile, and lets a human and an external agent revise the same saved episode. Scenes are timed blocks; shots are untimed checklists inside scenes.

The approved desktop timeline arrangement is scene details above left, shot checklist above right and the scene timeline below. Add an alternate Cards view of the same ordered scenes; use that view on mobile. The screenshot remains the timeline layout reference and predates the richer scene cards and sketch popup. The specification governs behaviour, including mobile adaptation and server persistence.

The filmstrip and chevrons sketch is the initial branding direction. A simple PlanB wordmark is sufficient during implementation. Keep the MTA opening sequence as optional example data; the app must also support other creators' videos.

Retain the v0.2 optional story outline and external-agent process. The v0.3 additions are richer scene cards, optional reference images/links, a simple editable storyboard popup and a portable planning handoff. Optional VO and audio/music intent have distinct text fields. Story beats do not impose five scenes or fixed timing. A creator can skip the outline and artwork and plan manually.

## How to start

Inspect the repository and any applicable instructions. If this is a new project, initialise an appropriate application structure. Choose a small, maintainable stack suited to one VPS, explain the choice briefly and begin implementation. Check current official dependency documentation where necessary.

Deliver in stages:
1. Authentication, persistent episodes, optional story outline, shared Timeline/Cards sequence, scene checklists, mobile interaction and the printable filming view.
2. Expanded scene details, reference uploads/links, simple storyboard drawing and reliable editable-document/PNG saves.
3. Authenticated agent operations for the full model, a working MCP adapter, protection against stale edits, the documented agent workflow, and portable JSON/Markdown/assets export.
4. A reproducible deployment package, setup documentation and backup/restore of database and reference/drawing assets together.

All four implementation stages belong to Delivery A. A frontend demonstration alone does not complete it. Timed storyboard playback, temporary TTS/music and native editor adapters are later deliveries; do not start them automatically after finishing A.

## What must be demonstrated

Run the acceptance checks in PLANB-SPEC.md. In particular, demonstrate saved data surviving a restart, usable editing on a phone-sized display, an actual agent read/write round trip, and a stale agent update being rejected after a newer human edit.

Human and agent changes must remain in one shared project. Mock agent buttons, clipboard handoffs or browser-only storage do not satisfy this requirement. If an external MCP client cannot be launched in the build environment, report that test as outstanding and give precise steps to run it; do not label it passed.

Also demonstrate that the outline is optional, the starter does not constrain the timeline, and the external agent can revise an episode using reported events without inventing an outcome. Keep capture status separate from any claim that footage has been reviewed.

Demonstrate sketch editing and reopening on desktop and phone, coherent drawing/preview persistence, synchronised scene order between views, and a portable export with working relative asset references. A flattened PNG alone does not satisfy editable storyboard storage. A valid JSON or OTIO file alone cannot establish compatibility with an editor.

## Remaining implementation choices

The stack and exact MCP transport are for the coding session to choose. Privately provisioned accounts and online editing are the proposed first-build defaults. Record those choices in the setup documentation.

The actual VPS provider, domain and deployment credentials are not provided. Build and verify locally, then supply VPS deployment instructions. Ask for deployment details only when needed for actual installation.

Keep drawing within a scene's fixed canvas and keep the app focused on planning. Actual media editing, an unbounded creative board and crew management remain outside scope. Make routine implementation choices independently and preserve the simple interaction shown in the reference.

## Source

This bundle is the self-contained v0.3 build brief, revised on 5 October 2026 from Peter's supplied MagicStoryboard design summary. It preserves the 4 October Story Starter Kit refinements and supersedes earlier ZIPs for this build. The delivery split and draft/ready scene statuses are recommended implementation defaults intended to keep the first build small.

Original discussion brief: https://chatgpt.com/space/page_c3e5ba134214819190472e86c16c3fb5

That page records the earlier scope and may omit this revision. PLANB-SPEC.md in this bundle governs the current handoff. The course itself is reference material, not an implementation dependency. Course files and walkthroughs are not needed to build from this bundle.

## Included files

- PLANB-SPEC.md: complete product and implementation brief.
- VISUAL-PLANNING.md: scene cards, drawing, portable handoff and the preview/editor-adapter roadmap.
- AGENT-WORKFLOW.md: practical guidance for the connected external agent.
- CHANGELOG.md: version history and delivery boundaries.
- references/approved-interface.png: the interface Peter approved.
- references/logo-sketch.jpg: Peter's original PlanB logo idea.
