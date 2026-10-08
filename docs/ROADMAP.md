# PlanB roadmap: Deliveries B and C (not implemented)

Delivery A is implemented in this repository. Deliveries B and C are recorded here, from `PlanB-Handoff/VISUAL-PLANNING.md` (v0.3, 5 October 2026), so their requirements are not lost. **None of the features below exist in the code.** Do not start them without a new go-ahead; the brief recommends a real episode trial with Delivery A first.

## Delivery B: play the plan (after a real episode trial)

A lightweight timed storyboard preview.

- Play saved scenes in order. For each scene's planned duration, hold its storyboard preview, its selected reference image, or a generated title card (title + duration) when there is no image.
- Controls: play/pause, restart, previous/next scene, a progress indicator and optional VO text. A faster review speed may be offered, but it must never change saved durations.
- Use one saved revision per playback session, and restart from the latest saved revision after changes. Behaviour must stay consistent when navigating or pausing.
- Purpose: judge scene order and broad time allocation. A still held for 60 s cannot predict the pacing of a 60 s montage, so do not add a shot timeline to make the preview more convincing.
- Optional later: temporary TTS and one temporary music track. Choose the provider and storage when this is built. Label synthetic voice and temporary music as rehearsal aids. Sound starts only on an explicit user action and follows play/pause/stop. Never change durations to fit speech or music. No trimming, waveforms, mixing or multitrack.

**Acceptance for B:** a 10 s + 20 s + 30 s example plays for 60 s at normal speed, switches at the correct boundaries, pauses and resumes without drift, handles missing artwork, and does not change saved data. Test the same flow on mobile. If temporary audio is added, test pause/stop and over-long narration separately. No rendered movie export.

Building blocks already in Delivery A: ordered scenes with whole-second durations, server-rendered storyboard PNGs (`previewAssetId`), selected thumbnails, the `voiceover` field and revision-consistent reads.

## Delivery C: editor adapters

One canonical PlanB model, translated from a saved revision at the boundary.

- Consider OTIO where it fits the target, and NLE-specific adapters where needed. Candidate destinations: Shotcut, then Resolve (proposed validation order for Peter's workflow); FCP and Kdenlive on demonstrated demand. These names are targets, not compatibility claims.
- An adapter may export an ordered placeholder sequence (storyboard stills or title slates), scene markers, planned durations, VO cues and notes, where supported. Package stills with portable references, and decide still-image versus placeholder-clip handling by testing the target editor.
- Choose and document an explicit frame rate. Convert **cumulative** scene boundaries to frames, then derive segment lengths, so rounding does not accumulate. Report meaningful timing changes and never modify saved seconds.
- Keep PlanB IDs in namespaced metadata, marker labels or the sidecar. Always ship the full JSON/Markdown sidecar (the Delivery A bundle) whatever the NLE preserves.
- Exports are one-way snapshots: NLE edits do not update PlanB, and re-export must not silently overwrite a creator's working edit. No bidirectional sync and no raw-media selection.

**Acceptance for C (per editor/version):** open the output in the named editor and check scene order, boundaries, total duration, still references, missing-sketch fallback, Unicode text, scene IDs and any claimed markers/notes. Move the exported folder and check relinking. Record the editor and version, frame rate, OS, and any metadata or timing losses. A parseable file is not a passed import test; if the editor cannot be run, mark compatibility as unverified and list the remaining steps.

References (checked 5 October 2026; recheck when implementing):
- OTIO adapters: https://opentimelineio.readthedocs.io/en/latest/tutorials/adapters.html
- Writing an OTIO adapter: https://opentimelineio.readthedocs.io/en/latest/tutorials/write-an-adapter.html

## Also out of scope for now

Camera/subject icon libraries, more attachment types (video/audio), multiple storyboard panels per scene, public registration, billing, team workspaces, offline editing and sync, embedded AI chat, crew management, raw-media editing and finished-video rendering.
