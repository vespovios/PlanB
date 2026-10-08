import { z } from 'zod';
import { DEFAULT_CANVAS, STORYBOARD_COLOURS, STORYBOARD_SCHEMA_VERSION, STROKE_WIDTHS, StoryboardInputSchema } from '../shared/storyboard.js';

/** Published so manual and agent drawing edits share one validated format. */
export function storyboardSchemaDocument() {
  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    guidance: [
      'One storyboard per scene on a fixed canvas (default 1600×900, 16:9). Coordinates are canvas pixels from the top-left.',
      'backgroundAttachmentId may reference an image attachment in the same scene; it is fitted without distortion (contain) and kept separate from the drawn objects.',
      'Object types: freehand {points:[x1,y1,x2,y2,...]}, arrow {x1,y1,x2,y2} (head at x2,y2), rect/ellipse {x,y,w,h} (ellipse inside that box), text {x,y,text,size} (x,y is the top-left of the first line).',
      'Every object needs a short unique id, a #rrggbb color and (except text) a stroke width.',
      'Text is rendered in DejaVu Sans; allow roughly 0.6 × size pixels per character and keep labels inside the canvas. Use \n for line breaks.',
      'saveStoryboard replaces the whole document: read it with get_storyboard, modify, and send it all back so existing objects are preserved.',
      'The server renders the PNG preview from the saved document in the same revision; never send only an image.',
      'Add a short description so people and agents without image inspection know what it shows. A drawing is a plan, not evidence that anything was filmed.',
    ],
    defaults: { ...DEFAULT_CANVAS, colours: STORYBOARD_COLOURS, strokeWidths: STROKE_WIDTHS },
    example: {
      width: 1600,
      height: 900,
      backgroundAttachmentId: null,
      description: 'Camera at the trailer ramp; rider pushes bike up from the left.',
      objects: [
        { id: 'a1', type: 'arrow', x1: 200, y1: 650, x2: 800, y2: 450, color: '#dc2626', width: 6 },
        { id: 't1', type: 'text', x: 180, y: 700, text: 'Costis enters here', color: '#111827', size: 48 },
        { id: 'r1', type: 'rect', x: 900, y: 300, w: 400, h: 260, color: '#2563eb', width: 6 },
      ],
    },
    jsonSchema: z.toJSONSchema(StoryboardInputSchema, { io: 'input' }),
  };
}
