# Portable plan bundle and storyboard schema

**Download plan** (`GET /api/episodes/:id/export.zip`) produces an editor-independent handoff built from **one saved revision**. It is canonical PlanB planning data. It is **not** a native editor project and makes no claim of NLE import compatibility (see [ROADMAP.md](ROADMAP.md), Delivery C). Importing a bundle back into PlanB is not supported in Delivery A.

```
planb-<title-slug>-r<revision>/
  plan.json                      canonical data (format "planb.plan", schemaVersion 1)
  plan.md                        readable story, scenes, shots, VO/audio intent, references, sketch previews
  assets/<assetId>.png|jpg       uploaded reference images, byte-for-byte originals
  storyboards/<sceneId>-<storyboardId>.json   editable drawing documents
  storyboards/<sceneId>-<storyboardId>.png    matching flattened previews
```

All paths inside the bundle are relative to the file that contains them. External reference links stay as URLs marked `"external": true`. The bundle contains no passwords, agent tokens, session cookies or app URLs. If a referenced file is missing on the server (which should not happen), its path is `null` and its ID is listed in `missingAssets`.

## plan.json (schemaVersion 1)

```jsonc
{
  "format": "planb.plan",
  "schemaVersion": 1,                 // independent of the product brief's v0.3 label
  "exportedAt": "2026-10-08T12:00:00.000Z",
  "generator": "PlanB 0.1.0",
  "episode": {
    "id": "ep_…", "revision": 7, "savedAt": "…",
    "title": "…", "brief": "…", "outline": "…", "notes": "…",
    "status": "draft|ready", "targetSeconds": 600, "totalSeconds": 180
  },
  "scenes": [
    {
      "id": "sc_…", "number": "S01", "order": 0,
      "title": "…", "startSeconds": 0, "durationSeconds": 45, "status": "draft|ready",
      "description": "…", "purpose": "…", "notes": "…", "voiceover": "…", "audio": "…", "location": "…",
      "thumbnailAttachmentId": "at_…|null",
      "capturedShots": 1, "totalShots": 3,
      "shots": [{ "id": "sh_…", "order": 0, "description": "…", "framing": "…", "cameraNotes": "…",
                  "priority": "essential|optional", "captured": false }],
      "attachments": [
        { "id": "at_…", "kind": "image", "label": "…", "caption": "…", "assetId": "as_…",
          "file": "assets/as_….jpg", "mime": "image/jpeg", "bytes": 123456, "width": 1600, "height": 1200 },
        { "id": "at_…", "kind": "link", "label": "…", "caption": "…", "url": "https://…", "external": true }
      ],
      "storyboard": {                  // or null
        "id": "sb_…", "document": "storyboards/sc_…-sb_….json", "preview": "storyboards/sc_…-sb_….png",
        "savedRevision": 6, "backgroundAttachmentId": "at_…|null", "description": "…", "summary": "1 arrow, 1 text; labels: \"…\"."
      }
    }
  ],
  "missingAssets": []
}
```

Scene IDs, shot IDs and attachment IDs are stable across reordering and renaming. `number` is positional. `startSeconds` is derived from the order and the durations. `captured` means the creator reported filming the shot; it does not mean the footage has been reviewed.

## Storyboard document (schemaVersion 1)

This is the format used inside the app (`scene.storyboard`) and by `saveStoryboard`. The exported copy adds `format`, `storyboardId`, `sceneId` and a relative `background.file`.

```jsonc
{
  "schemaVersion": 1,
  "width": 1600, "height": 900,                // fixed canvas, independent of display size (default 16:9)
  "backgroundAttachmentId": "at_…" | null,    // image reference in the same scene, fitted with "contain" (no distortion)
  "description": "Camera at the ramp; rider enters from the left",
  "objects": [
    { "id": "f1", "type": "freehand", "points": [x1, y1, x2, y2, …], "color": "#dc2626", "width": 6 },
    { "id": "a1", "type": "arrow", "x1": 200, "y1": 650, "x2": 800, "y2": 450, "color": "#dc2626", "width": 6 },
    { "id": "r1", "type": "rect", "x": 900, "y": 300, "w": 400, "h": 260, "color": "#2563eb", "width": 6 },
    { "id": "e1", "type": "ellipse", "x": 300, "y": 200, "w": 200, "h": 120, "color": "#16a34a", "width": 3 },
    { "id": "t1", "type": "text", "x": 180, "y": 700, "text": "Costis enters here", "color": "#111827", "size": 48 }
  ]
}
```

- Coordinates are canvas pixels from the top-left. The arrow head is at `x2,y2`. An ellipse is drawn inside its box. Text `x,y` is the top-left of the first line, and lines are separated by `\n`.
- Colours are `#rrggbb`; stroke widths are 1–40. Up to 2,000 objects are allowed.
- Rendering (browser and server) uses `objectToSvg()` in `src/shared/storyboard.ts`. Text uses DejaVu Sans with a light halo for legibility over photos. The server composites the background image (contain, white letterbox) under the annotation SVG and stores the PNG as a new immutable asset in the same revision as the document. To reproduce a preview, render the document over the referenced image the same way.
- The full JSON Schema is available from `GET /api/storyboard-schema` and the MCP tool `get_storyboard_schema`.
