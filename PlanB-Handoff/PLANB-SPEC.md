# PlanB Video Planner Draft Build Specification

**Draft v0.3 — 5 October 2026.** This revision incorporates Peter's MagicStoryboard-inspired additions and retains the story-development workflow from v0.2. Use this bundled specification for this build; the linked 2 October discussion page records the earlier brief. Read VISUAL-PLANNING.md for the visual features and staged handoff requirements, AGENT-WORKFLOW.md for agent behaviour, and CHANGELOG.md for revision history.

This is a rough build specification for a lightweight web app that helps individual YouTube creators plan episodes before filming. Peter has agreed the timeline and checklist concept, an external agent workflow, VPS hosting, account login and a mobile-friendly interface.

The first version should make it easy to turn an idea into timed scene blocks and a useful filming checklist. The working product name is **PlanB**, written as one word with a capital P and B. Implementation defaults below are proposals, not additional product commitments.

**Initial logo direction:** Peter's sketch places the PlanB wordmark between horizontal filmstrip bands, with outward-pointing chevrons at the left and right. Preserve this concept when exploring a finished logo. Typography, colour and a simplified app icon are still to be decided.

## Product scope and delivery order

- A private web app installed on the user's VPS, accessed through an account and password.

- An episode list, a short episode brief and one main planning screen.

- A single ordered scene sequence, shown as a timeline or as compact cards. Timeline blocks can be reordered and resized to set their planned screen duration. Both views edit the same records and order.

- Each scene has editable text and an untimed shot checklist. Shots do not get separate timeline tracks.

- Desktop layout: scene details above left, shot checklist above right, scene timeline below.

- Full manual use plus a connected external agent that can create and revise the same plan.

- A readable filming checklist on mobile and a print view.

- A lightweight creative stage consisting of the brief and optional loose notes.

Retain the optional story outline within the episode brief area and the documented external-agent workflow from v0.2.

The v0.3 additions make scenes visual planning objects: compact and expanded cards, a planning status, image references, a simple storyboard drawing popup, separate optional voice-over and audio/music notes, and a portable handoff bundle. A drawing belongs to a scene; it does not create an unbounded creative board.

Use this recommended delivery order to keep the first build achievable:

| Delivery | Scope | Build now? |
| --- | --- | --- |
| A: Core visual planner | Existing authenticated app, story outline, timeline and cards, mobile checklist, scene references and sketching, external agent, portable JSON/Markdown/assets handoff, VPS packaging | Yes; this is the first deliverable |
| B: Play the plan | Timed storyboard preview, initially silent with optional VO text; temporary audio/TTS as a later enhancement | Roadmap; follow a real episode trial |
| C: Editor adapters | OTIO where useful and independently tested NLE-specific outputs | Roadmap; validate one editor at a time |

Deliver A in the implementation stages described in START-HERE.md. Do not implement B or C as part of the first build unless the user expands that task. Preserve their requirements in documentation so they are not lost.

PlanB owns story planning, scene order and duration, shots, sketches, references, checklists, agent refinement and handoff. The NLE owns actual footage editing, cuts, sync, transitions, effects, colour, audio mixing and finished-video rendering. Generating a storyboard PNG or exporting planning data is within PlanB's remit. Embedded AI chat and crew-management systems remain outside scope.

## Human and agent workflow

1. The creator describes an episode idea or provides notes to their existing agent. When direction is unclear, the agent asks a few focused questions and offers a short story outline before expanding it. When the creator has already supplied the direction or requests a complete draft, proceed without another approval round.

2. The agent develops the episode brief and optional story outline into scene blocks, approximate durations and a manageable shot checklist. For each scene, connect its purpose to what the viewer sees and the coverage needed to show it.

3. The creator opens the app, rearranges scenes and edits timing, wording and shot requirements. They can expand a scene to attach references or add a storyboard sketch.

4. The creator asks the agent to review or develop the current plan.

5. The agent reads the latest saved project and applies the requested changes.

6. Repeat until the creator marks the plan ready for filming.

7. During or after filming, the creator can add observations to the existing loose notes and update captured checkboxes. When asked, the agent revises the outline and narration around reported events. Future possibilities, confirmed observations and unanswered questions must remain distinguishable. A plan may stay open-ended until the trip happens.

The saved project is shared by the visual editor and agent. Continuing the conversation must not require copying or exporting the plan. An agent should preserve existing edits outside the requested change. Proposed convenience: marking the plan ready saves a recoverable snapshot while leaving the working plan editable.

AGENT-WORKFLOW.md defines the conversational process. Keep that process in the external agent; the app supplies editable project data and authenticated operations. Include the workflow in the implementation's user documentation so a connected agent can be given it without access to the paid course.

## Optional story development

Add a collapsible Story outline area next to the existing brief and loose notes. Store one optional multiline text field. Offer a lightweight starter using Setup, Desire, Conflict, Change and Result, while allowing free writing, renamed labels and blank sections. Only insert starter text when the creator requests it; never overwrite an existing outline. Blank outlines must not prevent creating scenes or marking a plan ready.

This is a thinking aid, not a mandatory narrative formula. A ride, demonstration, interview or object-centred story can use whatever structure fits. Do not create a separate beat timeline, enforce five scenes, assign fixed duration percentages, or add a relational beat-management system. A beat can cover several scenes. If a relationship needs explaining, put it in the scene's existing purpose text.

In scene details, label the story-purpose field clearly, with a prompt such as "What should the viewer understand or feel here?" Use the description for visible action. Keep the shot checklist for practical coverage. Separate optional Voice-over and Audio/music text fields hold intent or draft wording. General notes may hold an editing intention, such as allowing a pause or capturing matching movement for a transition. These are planning fields; they do not introduce audio or shot tracks.

The agent should start with a small amount of useful coverage and add more when the scene needs it. Optional creative shots remain separate from essential coverage. It should use the creator's stated equipment, available people and filming time, and avoid presenting every shot technique as a requirement.

Longer narration is optional and belongs in the scene's Voice-over field. Reuse episode loose notes for observations from a trip, including scene IDs when helpful. Plain labels such as "Planned", "Observed" and "Question" are sufficient for this version. A separate journal, raw-footage library and transcription service are outside Delivery A; native editor exports belong to Delivery C.

Use original PlanB prompts and examples informed by the reviewed methods. The course PDFs, footage, music and graphics are not included in this bundle and are not required product assets.

## Main planning screen

Show the episode title, short brief and optional target runtime, with total planned runtime calculated from the scenes. New scenes need only a title and duration; other fields can be filled later.

Use contiguous scene blocks in story order. Drag a block to reorder it. Drag an edge or enter a duration to resize it; later blocks shift automatically. Store durations as positive whole seconds and display minutes and seconds. Start times are calculated from preceding scenes. Changing duration must not alter the shot list.

Provide a time ruler, fit-to-view and simple zoom for longer episodes. Block widths must reflect duration at the active zoom. Selecting a block opens that scene's details and shots in the upper panels. Provide buttons or keyboard controls for the same actions as dragging.

Scene deletion must be undoable. Show brief, clear save feedback. Preserve the small interface; optional details should not become compulsory forms.

Add a Timeline / Cards switch on wider screens. Cards show title, planned duration, planning status and an optional thumbnail. Selecting a card opens the same scene details and checklist used by the timeline. Provide access to references, VO/audio notes and Draw / Storyboard through the expanded scene. Use disclosure controls so empty optional fields do not dominate the screen. The original screenshot remains the layout reference for Timeline; it is not a mockup of the new Cards view or drawing popup.

Cards are an ordered storyboard with Kanban-like cards. Do not create status columns with an independent ordering system. Reordering in either view updates the shared scene order. A thumbnail in a narrow timeline block is optional; always keep the full details accessible through scene selection.

## Visual planning and portable handoff

Delivery A includes PNG/JPEG references, labelled reference links, and one editable storyboard per scene. The popup can draw on a blank canvas or over a stored image using freehand, arrows, rectangles, circles and text. Save the editable document and a matching flattened PNG preview; protect both with the existing revision rules. Drawing remains optional and must work with a mouse and touch. VISUAL-PLANNING.md defines persistence, mobile behaviour and attachment rules.

Provide a Download plan action producing a versioned JSON snapshot, readable Markdown and the referenced planning assets in one portable ZIP. This is the baseline editor-independent handoff. It makes no claim of native import compatibility. Keep canonical planning data independent of OTIO and any particular NLE. Playback and actual editor adapters follow the separate roadmap in VISUAL-PLANNING.md.

## Information to store

| Item | Information |
| --- | --- |
| Episode | Stable ID, owner, title, brief, optional story outline, loose notes and target duration, draft or ready status, revision number |
| Scene | Stable ID, episode, order, title, duration in seconds, planning status (draft/ready), description; optional purpose, general/edit notes, VO intent/text, audio/music intent, location/route context, selected thumbnail attachment and storyboard reference |
| Shot | Stable ID, scene, order, short description; optional framing or angle and camera notes; essential or optional priority; captured checkbox |
| Attachment | Stable ID, scene, kind (image/reference link), label and optional caption; stored file reference plus MIME type, byte size and dimensions for images, or URL for a reference link |
| Storyboard | Stable ID, scene, document schema version, canvas dimensions, optional background-image attachment ID, editable drawing data, matching PNG preview asset, optional text description, saved revision |

Essential priority and captured status are separate. Captured means the user reports that a shot was filmed; it does not imply that footage has been reviewed or approved.

Scene planning status is explicitly set by the creator: draft or ready to film. It defaults to draft and is independent of episode readiness and captured counts. Do not infer filming completion from it or automatically change it when a shot is checked. A captured count such as 2/5 is derived separately when useful.

Use stable IDs independently of displayed scene numbers. Reordering a scene must keep its identity, attached shots, references and drawing. Only title and duration are required from the creator; IDs, order and default status are assigned by the app. Optional content can stay empty. If upgrading an existing prototype with combined sound/narration notes, preserve the original text during migration rather than guessing which parts to discard.

## Mobile use and filming checklist

Mobile uses the same Cards view as a vertical list showing sequence number, title, duration, status and optional thumbnail. A tap opens the same scene details and shot checklist. Keep reordering and timing available through touch controls and numeric input. On wider screens, offer the approved timeline layout and the alternate Cards view.

A creator should be able to add or edit a scene, adjust its duration, edit shot notes and tick captured shots from a phone. Use readable text and comfortable touch targets; essential controls must not depend on hover.

The optional story outline and loose notes must also be editable on mobile. Keep them collapsed when working through the filming checklist. Display a scene's purpose or sound-capture notes when useful without requiring those fields to be completed.

On a phone, the drawing popup may use the full screen. Allow image upload, touch drawing, editing labels, saving and reopening the drawing. Show the saved preview in scene details and make reference images readable at a larger size. The filming checklist must remain quick to use when no artwork is present.

The filming view derives directly from the same scenes and shots. Default to story order, with simple location grouping when locations are supplied. Keep scene names or IDs visible so filming order does not become confused with episode order. A print view should work for paper and the browser's Save as PDF.

Proposed first-build assumption: editing requires a connection to the VPS. Show unsaved changes clearly if connectivity fails; never display a successful save until the server accepts it. Offline editing and synchronisation have not been agreed.

## Agent connection and reliable editing

Provide an authenticated API with a thin MCP adapter so an external agent can list and read episodes, create scenes, update descriptions or durations, reorder scenes, manage shot lists and read the filming checklist. Choose the simplest supported connection method and demonstrate it with one actual MCP client.

Episode reads and writes must include the optional story outline and loose notes. Scene reads and writes must include status, purpose, VO/audio/general notes and location context. Provide authenticated operations to list and retrieve references and drawings, attach user-supplied images or links, and save a supported drawing document when specifically requested. Expose the drawing schema so manual and agent edits use the same validation. Keep binary image retrieval separate from ordinary text reads. Use the same revision checks for these fields as for timing and shots. No embedded model, in-app chat, image-generation service or paid-course access is required by the workflow.

Both browser actions and agent actions must use the same validation and save logic. Issue revocable agent credentials associated with the account; the agent should not need the user's login password.

An agent reads the current episode revision before writing. Changes include the revision they were based on. Reject stale updates and let the agent read again; do not silently overwrite more recent human edits. Preserve fields outside the requested change. A successful agent write must appear in the browser without a manual import.

Make a batch of agent changes one recoverable revision. Provide simple undo or restore behaviour that cannot silently erase intervening edits. Detailed per-field locks and elaborate approval screens are not part of the initial interface.

Apply those rules to references, drawings and preview assets as well. A text-only scene change must not replace its artwork. Serve private assets only to the authorised owner or that owner's agent. The portable export must represent one consistent saved revision and exclude credentials.

## VPS implementation defaults

These are proposed engineering defaults for the coding session:

- One application deployment and one persistent database, with a straightforward container setup and documented backup and restore steps.

- Store projects on the server so the same account sees the same data from the Mac, ThinkPad and phone.

- Start with privately provisioned accounts. Public registration, billing and shared team workspaces are not required. Enforce account ownership for all project and agent requests.

- Use established authentication components with password hashing, secure sessions, login rate limits and HTTPS. Keep credentials and application secrets out of source control and browser code.

- Keep the database, uploaded reference images, editable drawings and preview assets outside disposable containers. Back up and restore database and assets together; document how upgrades preserve their relationships and the data needed for undo.

- Use a small, maintainable stack. The coding agent should explain its choice and verify current dependency documentation before implementing integrations.

No VPS provider, domain, operating system, deployment credentials or final technology stack has been selected in this brief. The deliverable should run locally for review and include VPS deployment instructions. Actual deployment is a separate operational step.

## Example opening sequence

These are illustrative planning values, not a report of filmed footage.

| Scene | Planned duration | Example shots |
| --- | --- | --- |
| Packing for the ride | 45 seconds | Both riders and bikes; bags and gear close-ups; brief departure conversation |
| Loading the trailer | 30 seconds | Bike moving up the ramp; straps tightening; final check |
| The road to the mountains | 60 seconds | Departure; changing landscape; optional route insert |
| Fuel and coffee stop | 30 seconds | Arrival; coffee detail; brief rider conversation |

This opening totals 2 minutes 45 seconds. The user can freely change those estimates. A 30-second scene may take much longer to film; screen duration is not a filming schedule.

Make example content optional so new episodes can start empty.

For the illustrative 30-second loading scene, a possible purpose is to introduce the riders and what they hope to get from the trip. Coverage could show both riders loading, a detail of securing the bikes, and a brief answer to "What are you most looking forward to?" Treat the answer as something to capture, not invented dialogue. A later scene can revisit the actual answer once the trip has happened. These are planning suggestions, not claims about existing MTA footage.

## Acceptance checks

1. After login, create and save an episode with the four sample scenes. Reopen it from another browser and see the same plan.

2. Change packing from 45 to 60 seconds. The opening becomes 3 minutes and later scene start times move by 15 seconds.

3. Reorder scenes and confirm descriptions, IDs, shot lists and captured flags remain attached correctly.

4. At phone width, create and edit a scene, change its duration, reorder it and tick a captured shot without relying on desktop hover or precise dragging.

5. Have an external agent read the plan, add a shot to a selected scene and show that change in the app.

6. Make a human edit after an agent reads a revision. Reject the stale agent write and preserve the human edit.

7. Undo or restore an agent revision through the documented mechanism; verify that later edits are handled explicitly.

8. Print the filming checklist with complete descriptions, priorities and captured status. Restart the application and confirm saved data persists.

9. Confirm that unauthenticated requests and another account's requests cannot read or modify an episode, including through the agent API.

10. Save an optional story outline, read and revise it through the external agent, and confirm it persists and remains editable on desktop and mobile. Repeat basic manual planning with that field empty; no guided workflow may block it.

11. Create more than five scenes while using the five-beat starter in the outline. Confirm that scene count, order, durations and shots remain freely editable and independent of the starter. Include scene purpose, VO intent/text and audio/music notes in the agent read/write check.

12. Demonstrate the agent workflow with a short planning conversation, then add an unexpected reported event and request a revision. Review whether it preserves unrelated human edits, distinguishes observations from proposed events, leaves unknown outcomes open, and avoids treating captured shots as verified usable footage. This is a conversational review with an actual agent, not a unit-test claim. Mark it outstanding if it cannot be run.

13. Reorder and retime scenes in Timeline and Cards. Confirm the two views agree and preserve IDs, artwork, shots and notes. Verify planning status and captured counts change independently. Check the new optional fields remain unobtrusive for a scene with only a title and duration.

14. Save a blank-canvas sketch and a sketch over an uploaded image. Use freehand, an arrow, a shape and editable text; reopen, alter and save them. Verify editable data and PNG preview match after restart and on another device. Repeat the core drawing and save flow at phone width using touch. Cancel must preserve the earlier saved drawing. A failed or stale save must not publish a mismatched preview or lose the local pending work.

15. Through the agent connection, retrieve a scene's reference and drawing data, attach a reference, and make a small valid drawing update. Confirm browser visibility and that a subsequent text-only edit preserves the artwork. Verify cross-account denial for originals, previews and exported assets, and restore both database and assets from a backup.

16. Download an episode plan and inspect it outside the app: schema version and revision are present, scene IDs/order/durations match the saved snapshot, all exported relative asset paths resolve, sketches include editable data and PNGs, and missing optional artwork is handled. Confirm no login credentials, agent tokens or expiring authenticated URLs are embedded. Native NLE import is not part of this check.

These checks cover Delivery A. VISUAL-PLANNING.md lists the separate checks needed when B or C is commissioned. Do not mark roadmap features implemented merely because their design is documented.

The practical usability target is to describe an idea, generate an outline and reshape it into a useful plan in about ten minutes. Validate that through an actual planning session, rather than claiming it from feature completion.

## Prompt for the coding session

Use this specification as the product brief. Build a small, working PlanB episode planner for individual YouTube creators. Preserve the desktop layout of scene details above left, untimed shot checklist above right and timed scene blocks below. Implement the mobile adaptation, private account access, persistent server storage and external agent connection.

Implement Delivery A of v0.3, including the optional story outline, expanded scene cards, references, simple editable storyboards and portable plan export. Read VISUAL-PLANNING.md and AGENT-WORKFLOW.md and include the relevant guidance with the user documentation. The external agent follows that process through the shared API; do not turn it into an in-app chat or compulsory wizard. Retain B and C as documented later work.

Begin by inspecting the repository and its instructions, then choose and briefly explain a simple implementation stack. Build in stages: persistent manual planning and mobile checklist; visual references and sketching; authenticated agent operations and portable handoff; VPS packaging and setup documentation. Agent support remains part of the first deliverable. Use a suitably licensed, maintainable drawing component if it reduces complexity, and expose only the required tools.

Keep the app straightforward. Use the sample opening as optional demo content. Verify the acceptance checks with meaningful tests and an actual agent round trip. Report what works, what was tested and any remaining limitations. Make routine implementation choices using the brief; ask only when a missing decision materially affects the product.
