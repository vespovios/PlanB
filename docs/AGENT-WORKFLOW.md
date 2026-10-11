# PlanB external-agent workflow

Draft v0.3 — 5 October 2026. This document guides an external agent connected to PlanB. PLANB-SPEC.md defines the app and the save rules; VISUAL-PLANNING.md defines drawings and handoff. These are conversational instructions, not a new in-app wizard or autonomous publishing process.

Help the creator turn an idea or real observations into a feasible video plan. Keep the creator's voice and decisions visible. The project must remain useful when no agent is connected.

## 1. Establish the story

Read the current episode, revision, brief, outline and notes before working on an existing plan. First determine what the creator is asking for: exploring an idea, making a plan, developing a selected scene, reviewing the episode or revising it after filming.

Use the supplied context. Ask only questions whose answers would materially change the plan, normally no more than three in a round. Useful questions include what the creator wants the viewer to discover, what makes this episode worth telling, and what can realistically be filmed. Avoid a long intake form. Mark ordinary assumptions and keep moving when enough is known.

When the story direction is uncertain, offer one or two short angles for the creator to shape before expanding into a full plan. If the creator has already chosen the direction or asks for a complete draft, proceed. Do not require approval for every scene or field.

Use Setup, Desire, Conflict, Change and Result when helpful. Treat them as optional prompts. A practical demonstration, conversation, atmospheric ride or story about an object may need different labels or none. Never manufacture a problem to satisfy a story formula.

For a future trip, frame the outline around intentions and questions. Leave an unknown ending open. For an event that already happened, use the creator's observations and supplied material. Do not invent incidents, dialogue, feelings or lessons learned. Clearly label proposed reconstructions or hypothetical alternatives if the creator requests them.

Store the short outline in the episode's optional story-outline field. Preserve the original brief and source notes unless the requested edit requires changing them. Plain labels in loose notes are enough to distinguish planned possibilities, reported observations and unresolved questions.

## 2. Develop scenes and coverage

Build from meaning to visible action to practical shots. A useful scene explains:

- Purpose: what the viewer should understand, notice or feel.
- Description: what happens on screen.
- Checklist: the coverage needed to communicate that action.
- Optional fields: location/route context, VO intent/text, audio/music intent and general/edit notes.
- Estimated duration: planned screen time, not time required to shoot.

Use existing fields. Do not introduce separate beat records, shot timelines or compulsory metadata. A narrative beat can span several scenes; several ideas can be expressed in one scene. Scene count and timing remain the creator's decision.

For a simple scene, start with one to three useful shots and expand only when its action needs more coverage. Choose shots for their role: establishing a place, showing an action, revealing a detail or capturing a reaction. Explain an unfamiliar framing choice briefly in the camera notes when needed. Fit suggestions to the equipment, people and time the creator has actually stated.

Separate essential coverage from optional creative alternatives. One optional visual experiment is often enough. Avoid a large checklist assembled from every available camera technique. Suggest sound capture or a question to ask someone when it serves the scene. Never substitute an invented answer for a question that has not been asked.

Use editing intentions only when they affect a useful filming decision. For example, a proposed match cut may need two similarly framed shots. Record that requirement in the relevant scene or shot notes. Do not prescribe frame-accurate cuts or add editing controls to PlanB.

Durations are estimates. When asked to fit a target runtime, propose adjustments and explain significant cuts to content. If narration looks too long for a scene, flag it or suggest a read-aloud check. Do not silently stretch the whole timeline or mistake a timing estimate for verified spoken duration.

## 3. Review with the creator

Re-read the saved project after human edits. Respond to the requested scope. For a review, report a few specific, useful observations, usually no more than three priorities at a time:

- Is the episode's central question or intention understandable?
- Does each substantial scene earn its place, or repeat an earlier point?
- Does the planned coverage show the action or change the narration describes?
- Is the amount of filming manageable, with essential shots apparent?
- Does the planned pacing allow important moments to land?

Offer corrections or alternatives without inventing a numeric story score or treating a formula as a quality gate. Identify opportunities to remove work as well as add it. A request to review does not by itself require rewriting every scene.

## 4. Revise around what happened

Use reported observations from loose notes and capture updates when asked to revise after filming. Keep the distinction between a planned event, an event reported by the creator and footage whose contents have actually been reviewed.

A captured checkbox means the creator reports filming that shot. It does not establish technical quality, usable audio, complete coverage or suitability for the edit. Ask about a critical gap when its answer would change the proposed story. Never claim to have watched media that was not supplied and inspected.

Adjust the outline to the events and available material. Offer practical alternatives for gaps, such as a pickup, a still, a map or honest narration, clearly labelled as suggestions. Do not turn an imagined event into a factual account to preserve an earlier outline.

Develop narration only when requested, using the creator's wording and reported experience. Leave uncertain facts as questions. Suggest a read-aloud pass for natural delivery. Use the portable PlanB export or a concise response to hand off scene IDs, order, estimated durations, purpose, narration, visual references and remaining gaps. Native editor formats belong to the later adapter delivery.

### Writing voice-over (PlanB tip)

When the creator asks for narration, write it to be spoken, not read:

- **Start from their words.** Build each line from the creator's own notes, the outline's five lines and what they reported. Don't add feelings, events or conclusions they haven't expressed; leave a `Question:` instead.
- **One idea per sentence.** Use short, plain sentences in the creator's natural register, with present tense where it fits the moment.
- **Leave room.** Narration supports pictures and sound, so don't cover every second. Mark where the shot should breathe, or where a real sound or conversation should carry the scene.
- **Fit the time.** Spoken narration runs roughly 2–3 words per second. Compare the draft with the scene's duration, and flag lines that are too long rather than stretching the scene.
- **Mark it as a draft.** Put the text in the scene's `voiceover` field, labelled as proposed wording, and suggest a read-aloud pass. The creator's recorded delivery decides the final words.

## Visual references and handoff

Read the latest attachment list and drawing description when they matter to a request. If image inspection is available, retrieve the authorised preview or original through the API and inspect it before making visual claims. Otherwise explain the limitation and work from the creator's text. An asset filename or captured checkbox is not evidence of what an image or video shows.

Use sketches to clarify framing, camera position, subject movement or blocking. A short proposed sketch description is often enough for the creator to draw. When asked to create or revise drawing data, use the documented schema and validated save operation; preserve the editable objects and background reference. Never replace editable artwork with only a flattened image. Image-generation services and autonomous artwork generation are not required for Delivery A.

Preserve reference images, drawings, thumbnail choices, VO and audio notes during unrelated edits. Planning status is explicitly set; do not mark a scene ready or captured merely because an outline or sketch exists. A suggested drone movement is a plan, not evidence that a drone or shot is available.

When reviewing a storyboard preview in the later playback delivery, distinguish broad scene allocation from the pacing of actual moving footage. One still held for a scene cannot establish how its eventual internal cuts will feel.

Treat the PlanB project as the source of planning truth. Export a consistent revision and identify unresolved questions in the handoff. Use only adapters that are implemented and tested for the requested editor/version. Preserve unsupported detail in the JSON/Markdown sidecar and report losses. Do not promise that every editor accepts OTIO or that arbitrary metadata survives conversion. Changes made in an NLE do not automatically update PlanB.

## Shared-project rules

Before any write, read the latest revision and submit changes against that revision. Preserve stable IDs, captured flags, human wording and all fields outside the requested change. Use partial updates instead of regenerating the entire project for a local revision.

If a stale write is rejected, read again and reconcile with the newer project. Do not bypass the revision check or silently reapply obsolete values. Group a coherent set of changes into one recoverable revision using the API's supported operations. Summarise what changed, including any assumptions or open questions that matter.

## A useful trial

Use one real, short MTA episode to assess the workflow. Start from an idea or actual notes, shape the outline, generate manageable coverage, make human edits in the app, and request a targeted revision. Check whether the process improves filming decisions and remains quick to use. A successful API call alone does not establish that the creative workflow is useful.

---

## Appendix: doing this with the PlanB tools

This appendix maps the workflow above onto PlanB's MCP tools (the same operations exist on the REST API; see `docs/API.md`).

- **Find the episode:** `list_episodes`, then `get_episode`. The result includes `revision`; keep it.
- **Write:** `apply_changes` with `baseRevision` set to the revision you read, a short `summary`, and only the operations you need. One coherent request → one call → one revision in the creator's History.
- **Stale write:** if the result says `stale_revision`, call `get_episode` again, look at what changed (`newerRevisions` lists who changed what), and reapply only your intended change. Never resend old values over newer ones.
- **Five-line outline:** if the creator wants the five-line structure, write the outline with one line per label: `Setup:`, `Desire:`, `Conflict:`, `Change:`, `Result:`. Add the scenes each line covers in brackets, e.g. `Conflict: the strap works loose at the fuel stop (S04–S05)`. The production pack shows these lines on its cover, linked to the scenes. A line can cover several scenes, and lines can stay open ("Result: unknown until the trip").
- **Fields:** episode `outline` (optional story outline), `notes` (loose notes; use `Planned:`, `Observed:`, `Question:` labels), `brief`, `targetSeconds`. Scene `purpose` (what the viewer should understand or feel), `description` (visible action), `voiceover` (VO intent/draft), `audio` (audio/music intent), `notes` (general/edit notes), `location`, `durationSeconds` (whole seconds, screen time), `status` (`draft`/`ready`, set by the creator).
- **Shots:** `addShot`/`updateShot`/`moveShot`/`deleteShot`. `priority` is `essential` or `optional`. Call `get_shot_and_cut_guide` and set `size`, `angle` and `movement` from that vocabulary when the framing matters (the printed pack shows them as pictograms); keep `framing` for free text such as "chest mount". Set a scene's `cutToNext` only as an editing intention, and only plan a match cut or J/L-cut when the shots it needs are on the list. Leave `captured` alone unless the creator reports filming; a captured shot is not reviewed footage.
- **Checklist:** `get_filming_checklist` (optionally grouped by location).
- **References:** `addLink` for web links; `upload_image` (base64 PNG/JPEG supplied by the creator) then `addImage`. Do not fetch arbitrary URLs into PlanB.
- **Drawings:** `get_storyboard_schema`, `get_storyboard`, then `saveStoryboard` with the whole document (keep existing objects and the background). The server renders the PNG preview. Use `get_image` to look at a preview or reference before making visual claims.
- **Undo:** `list_revisions`, then `restore_revision` (to undo revision N, restore N-1). If later revisions would also be reverted, the tool refuses and lists them; only confirm with `acknowledgeLaterRevisions: true` after the creator agrees.
