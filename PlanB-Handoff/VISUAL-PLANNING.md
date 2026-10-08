# PlanB visual planning and handoff

Draft v0.3 — 5 October 2026. This document expands PLANB-SPEC.md using Peter's supplied design notes. Build Delivery A first. B and C preserve the intended direction without making every feature a first-release dependency.

## Delivery A: visual scenes and portable planning data

### One scene sequence, two views

Timeline and Cards show the same saved scenes and order. The timeline expresses duration through block width. Cards provide a consistent readable size for visual planning, especially on mobile. Do not give the two views separate ordering or separate copies of scene data.

A collapsed card shows title, planned duration, planning status and an optional thumbnail. Prefer the saved storyboard preview when a storyboard exists; otherwise use the creator's selected image reference. A scene without either works as a text card. Where useful, show captured shots as a separate count. Draft/ready describes planning readiness; it does not mean that a scene has been filmed.

Selecting a card opens the same scene editor used by the timeline. It exposes purpose, action/description, general notes, shot checklist, VO intent/text, audio/music intent, location/route context, references and storyboard. Only title and duration are required. Keep lesser-used sections collapsed until wanted. Do not duplicate field content in different views.

The Cards view is Kanban-like in appearance but remains in story order. A production board grouped into status columns is not required. Location grouping belongs to the filming view and must not change story order. No route-map engine or GPX parser is required for a location note or reference link.

### Simple scene storyboard

Provide Draw / Storyboard in expanded scene details. Start with one editable storyboard per scene on a fixed canvas, with a proposed 16:9 default. Store its dimensions independently of the current display size. Support a blank background or a stored scene image fitted without distortion. Keep that image as a background reference so annotations can be edited separately.

Expose a small toolbar: freehand, arrow, rectangle, ellipse/circle, text, selection/move/resize, delete, undo/redo, a few colours and a simple stroke-width choice. Text remains editable after reopening. Camera/subject icon collections and multiple storyboard panels per scene can follow later if needed. A minimal drawing component is preferable to building a large illustration application; verify its current licence and persistence/export capabilities before adoption.

Useful drawings show camera position, subject movement, direction of travel, framing or blocking. For example, a rider arrow and the label "Costis enters here" can clarify a proposed shot. It is a planning illustration and does not establish that the action was filmed.

Save a versioned editable document, its background attachment reference, canvas dimensions and a flattened PNG preview. Keep the source image intact. The preview must be reproducible from the document and its referenced image. Use one coherent saved revision for drawing data and preview, so a new document cannot be paired with an old thumbnail. Do not store only the PNG. Add an optional short text description for accessibility and agents without image inspection.

The popup has clear Save and Cancel actions. Save uses the episode's existing revision protection; Cancel discards only unsaved drawing changes. If saving fails or conflicts, keep the local pending drawing available and report the problem. Do not overwrite newer work or close the popup as though it saved. A text-only scene edit must leave the artwork untouched.

Mouse and touch must support the core drawing flow. On phones, use a full-screen sheet with a comfortable toolbar and a clear way to return to the scene. Drawing gestures inside the canvas must not accidentally drag the scene card. Check the saved result on another device rather than relying on an in-memory preview.

### References and storage

For Delivery A, accept PNG/JPEG images and labelled HTTP(S) reference links. Links remain links; drawing over a web reference requires its image to be uploaded. Do not silently fetch arbitrary URLs into server storage. Other attachment types, raw footage and audio uploads are later decisions.

Use a documented upload-size and image-dimension limit, with a proposed 10 MiB limit per image and a readable error when a limit is exceeded. Validate image content and dimensions on the server. Store image files and derived previews outside disposable containers, with stable asset IDs and access checks tied to the owning episode. Use the same authenticated access for browser and agent retrieval.

Removing a background image must not silently break a drawing. Explain the dependency and require the creator to replace or detach that background as part of the requested change. Preserve assets needed by supported undo/restore. Document backup/restore of both database records and assets; database-only backups are insufficient for this feature.

The API should expose reference metadata, authenticated file retrieval, the drawing schema and validated drawing saves. The agent can attach supplied references and make requested edits through these operations. An image-generation service is not a dependency, and the manual drawing workflow remains complete on its own.

### Portable handoff

Provide Download plan for the current saved episode. Produce a ZIP with:

- `plan.json`: schema version, episode revision, brief, outline, notes, ordered scenes, stable IDs, durations, statuses, shots and planning-asset references.
- `plan.md`: readable story and scene/shot handoff, including VO/audio intent, context and optional preview images.
- `assets/`: the episode's stored image references, using portable filenames based on asset IDs.
- `storyboards/`: editable drawing documents and PNG previews linked by stable scene/drawing IDs.

Use a consistent saved snapshot for every file. Store asset links inside the bundle as relative paths; include every referenced local planning asset. Handle scenes with no sketch or attachments normally. Do not substitute expiring app asset URLs for files. Exclude application passwords, agent tokens and internal service credentials. User-supplied external reference links remain identified as external links.

The JSON export represents PlanB's canonical planning data. Its schema version is independent of the product brief's v0.3 label. Document the schema and asset relationships. Restoring or merging an arbitrary bundle into the app is not required for Delivery A; do not claim import support from the presence of an export.

This handoff is useful to a person or an external agent using any editor. It is not labelled as a native editor project. The existing printable filming checklist remains a separate, compact working view.

## Delivery B: play the plan

After a real episode trial, add a lightweight timed storyboard preview. Play saved scenes in order, holding the storyboard preview, selected reference image or a generated title card for each scene's planned duration. Use the title and duration when no image exists.

Start with play/pause, restart, previous/next scene, a progress indicator and optional VO text. A faster review speed can help with longer plans; it must not change saved durations. Use one saved revision per playback session, and restart from the latest saved revision after changes. Keep playback behaviour consistent when navigating or pausing.

This assesses scene order and broad time allocation. A still image held for 60 seconds cannot predict the pacing of an eventual 60-second montage. Do not add a shot timeline merely to make this preview more convincing. Assess detailed editing rhythm in the NLE with actual footage.

Temporary TTS and one temporary music track are optional follow-on features. Decide their input/provider and storage behaviour when implementing that enhancement. Clearly identify synthetic voice and temporary music as rehearsal aids. Playback begins through an explicit user action; any sound must follow play/pause/stop. Do not change planned durations automatically to fit speech or music, and do not add trimming, waveforms, mixing or multitrack controls.

Acceptance for B: an example sequence of 10, 20 and 30 seconds plays for 60 seconds at normal speed, switches at the correct boundaries, pauses/resumes without accumulating drift, handles missing artwork, and does not change saved scene data. Test the same flow on mobile. If temporary audio is added, test its pause/stop and overlong-narration behaviour separately. No rendered movie export is required.

## Delivery C: editor adapters

Keep one canonical PlanB model and translate from a saved revision at the boundary. Consider OTIO where it fits the target; use NLE-specific adapters where necessary. Candidate destinations include Shotcut, Resolve, FCP and Kdenlive. Their names are roadmap targets, not a compatibility claim. For Peter's workflow, the proposed validation order is Shotcut, then Resolve; additional editors follow demonstrated demand.

OTIO supports conversion through adapters, but other formats preserve only what their format and adapter support. Adapter support also varies. Therefore test actual imports and document losses rather than assuming universal compatibility. Keep PlanB IDs and extra planning metadata in a namespace when the interchange supports it; retain the complete JSON/Markdown sidecar regardless of what an NLE preserves.

An adapter may export an ordered placeholder sequence using storyboard stills or title slates, scene markers, planned durations, VO cues and notes where supported. Package the required stills with portable references. Determine still-image versus placeholder-clip handling by testing the target editor. Any future conversion to placeholder movie files is an adapter implementation decision, not a general media-rendering feature in PlanB.

Choose an explicit frame rate during export and document it. Convert cumulative scene boundaries to frames, then derive segment lengths so rounding does not accumulate across scenes. Report meaningful timing changes and do not modify the saved duration in seconds. Preserve stable scene IDs in supported metadata, marker labels or the sidecar so titles and scene numbers can change without losing identity.

Exports are one-way snapshots. Editing the exported project in an NLE does not update PlanB, and re-export must not silently overwrite a creator's working edit. Bidirectional synchronisation and raw-media selection are outside this delivery.

Before calling an adapter supported, open its output in the named editor/version and check scene order, boundaries, total duration, still references, missing-sketch fallback, Unicode text, scene IDs and whatever markers/notes are claimed. Move the exported folder and verify relinking behaviour. Record the tested editor/version, frame rate, operating system and any metadata or timing losses. A parseable file alone is not a passed editor-import test. If the editor cannot be run, label compatibility unverified and provide the remaining test steps.

Official references checked on 5 October 2026; recheck relevant versions when implementing an adapter:

- [OTIO adapter documentation](https://opentimelineio.readthedocs.io/en/latest/tutorials/adapters.html)
- [Writing an OTIO adapter: format limitations, metadata and media references](https://opentimelineio.readthedocs.io/en/latest/tutorials/write-an-adapter.html)
