// Editable storyboard document (one per scene) and its SVG rendering.
// The same objectToSvg() output is shown in the browser editor and rasterised on the
// server for the PNG preview, so the saved preview is reproducible from the document.
import { z } from 'zod';

export const STORYBOARD_SCHEMA_VERSION = 1;
export const DEFAULT_CANVAS = { width: 1600, height: 900 } as const;
export const STORYBOARD_FONT = "'DejaVu Sans', Verdana, Arial, Helvetica, sans-serif";
export const STORYBOARD_COLOURS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#ffffff'] as const;
export const STROKE_WIDTHS = [3, 6, 12] as const;

const coord = z.number().finite().min(-10_000).max(10_000);
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are #rrggbb hex values');
const strokeWidth = z.number().min(1).max(40);
const objectId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const FreehandSchema = z.object({
  id: objectId,
  type: z.literal('freehand'),
  /** Flat list of x,y pairs in canvas coordinates. */
  points: z
    .array(coord)
    .min(2)
    .max(8000)
    .refine((p) => p.length % 2 === 0, 'points must contain x,y pairs'),
  color: colour,
  width: strokeWidth,
});
export const ArrowSchema = z.object({
  id: objectId,
  type: z.literal('arrow'),
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
  color: colour,
  width: strokeWidth,
});
const boxShape = <T extends string>(type: T) =>
  z.object({
    id: objectId,
    type: z.literal(type),
    x: coord,
    y: coord,
    w: z.number().finite().min(1).max(20_000),
    h: z.number().finite().min(1).max(20_000),
    color: colour,
    width: strokeWidth,
  });
export const RectSchema = boxShape('rect');
export const EllipseSchema = boxShape('ellipse');
export const TextSchema = z.object({
  id: objectId,
  type: z.literal('text'),
  /** Top-left of the first line. */
  x: coord,
  y: coord,
  text: z.string().min(1).max(500),
  color: colour,
  size: z.number().min(8).max(300),
});

export const StoryboardObjectSchema = z.discriminatedUnion('type', [
  FreehandSchema,
  ArrowSchema,
  RectSchema,
  EllipseSchema,
  TextSchema,
]);
export type StoryboardObject = z.infer<typeof StoryboardObjectSchema>;

/** What a writer (browser or agent) submits. The server adds id, preview and revision. */
export const StoryboardInputSchema = z.object({
  schemaVersion: z.literal(STORYBOARD_SCHEMA_VERSION).default(STORYBOARD_SCHEMA_VERSION),
  width: z.number().int().min(320).max(4096).default(DEFAULT_CANVAS.width),
  height: z.number().int().min(180).max(4096).default(DEFAULT_CANVAS.height),
  backgroundAttachmentId: z
    .string()
    .regex(/^at_[A-Za-z0-9]{6,32}$/)
    .nullable()
    .default(null),
  description: z.string().max(2000).default(''),
  objects: z.array(StoryboardObjectSchema).max(2000).default([]),
});
export type StoryboardInput = z.infer<typeof StoryboardInputSchema>;

export const StoryboardSchema = StoryboardInputSchema.extend({
  id: z.string().regex(/^sb_[A-Za-z0-9]{6,32}$/),
  /** Server-rendered PNG of exactly this document. */
  previewAssetId: z.string().regex(/^as_[A-Za-z0-9]{6,32}$/),
  /** Episode revision in which this drawing (and its preview) was saved. */
  savedRevision: z.number().int().positive(),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

// ---------------------------------------------------------------------------
// Geometry + SVG

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 10) / 10).toString();

export function freehandPathData(points: number[]): string {
  if (points.length < 2) return '';
  let d = `M${n(points[0])} ${n(points[1])}`;
  if (points.length === 2) return `${d} L${n(points[0] + 0.1)} ${n(points[1])}`;
  for (let i = 2; i < points.length; i += 2) d += ` L${n(points[i])} ${n(points[i + 1])}`;
  return d;
}

export function arrowHead(o: { x1: number; y1: number; x2: number; y2: number; width: number }) {
  const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
  const len = Math.max(14, o.width * 4);
  const spread = Math.PI / 7;
  return [
    [o.x2, o.y2],
    [o.x2 - len * Math.cos(angle - spread), o.y2 - len * Math.sin(angle - spread)],
    [o.x2 - len * Math.cos(angle + spread), o.y2 - len * Math.sin(angle + spread)],
  ] as const;
}

export function textLines(t: string): string[] {
  return t.split(/\r?\n/);
}

export const TEXT_LINE_HEIGHT = 1.2;

export function objectToSvg(o: StoryboardObject): string {
  const common = `stroke="${o.color}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  switch (o.type) {
    case 'freehand':
      return `<path d="${freehandPathData(o.points)}" ${common} stroke-width="${n(o.width)}"/>`;
    case 'arrow': {
      const head = arrowHead(o);
      // Stop the shaft short of the tip so the line end does not poke through the head.
      const angle = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const back = Math.max(14, o.width * 4) * 0.6;
      const sx = o.x2 - back * Math.cos(angle);
      const sy = o.y2 - back * Math.sin(angle);
      return (
        `<g><line x1="${n(o.x1)}" y1="${n(o.y1)}" x2="${n(sx)}" y2="${n(sy)}" ${common} stroke-width="${n(o.width)}"/>` +
        `<polygon points="${head.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${o.color}" stroke="${o.color}" stroke-width="${n(Math.max(1, o.width / 2))}" stroke-linejoin="round"/></g>`
      );
    }
    case 'rect':
      return `<rect x="${n(o.x)}" y="${n(o.y)}" width="${n(o.w)}" height="${n(o.h)}" rx="4" ${common} stroke-width="${n(o.width)}"/>`;
    case 'ellipse':
      return `<ellipse cx="${n(o.x + o.w / 2)}" cy="${n(o.y + o.h / 2)}" rx="${n(o.w / 2)}" ry="${n(o.h / 2)}" ${common} stroke-width="${n(o.width)}"/>`;
    case 'text': {
      const lines = textLines(o.text);
      const tspans = lines
        .map((line, i) => `<tspan x="${n(o.x)}" y="${n(o.y + o.size * (0.9 + i * TEXT_LINE_HEIGHT))}">${esc(line) || ' '}</tspan>`)
        .join('');
      // A light halo keeps labels readable over photos.
      const halo = o.color.toLowerCase() === '#ffffff' ? '#111827' : '#ffffff';
      return `<text font-family="${esc(STORYBOARD_FONT)}" font-size="${n(o.size)}" fill="${o.color}" stroke="${halo}" stroke-width="${n(Math.max(2, o.size / 8))}" paint-order="stroke" stroke-linejoin="round" xml:space="preserve">${tspans}</text>`;
    }
  }
}

/** Annotation layer only (transparent background). The server composites the background image under it. */
export function annotationsSvg(doc: Pick<StoryboardInput, 'width' | 'height' | 'objects'>): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">` +
    doc.objects.map(objectToSvg).join('') +
    `</svg>`
  );
}

/** Approximate bounds, used for selection and hit-testing in the editor. */
export function objectBounds(o: StoryboardObject): { x: number; y: number; w: number; h: number } {
  switch (o.type) {
    case 'freehand': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < o.points.length; i += 2) {
        minX = Math.min(minX, o.points[i]);
        maxX = Math.max(maxX, o.points[i]);
        minY = Math.min(minY, o.points[i + 1]);
        maxY = Math.max(maxY, o.points[i + 1]);
      }
      return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    }
    case 'arrow':
      return {
        x: Math.min(o.x1, o.x2),
        y: Math.min(o.y1, o.y2),
        w: Math.max(1, Math.abs(o.x2 - o.x1)),
        h: Math.max(1, Math.abs(o.y2 - o.y1)),
      };
    case 'rect':
    case 'ellipse':
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    case 'text': {
      const lines = textLines(o.text);
      const longest = Math.max(...lines.map((l) => l.length), 1);
      return { x: o.x, y: o.y, w: longest * o.size * 0.6, h: lines.length * o.size * TEXT_LINE_HEIGHT };
    }
  }
}

/** Plain-language summary for agents without image inspection. */
export function describeObjects(objects: StoryboardObject[]): string {
  if (!objects.length) return 'No drawn objects.';
  const counts = new Map<string, number>();
  for (const o of objects) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  const parts = [...counts].map(([t, c]) => `${c} ${t}${c > 1 ? 's' : ''}`);
  const labels = objects.filter((o) => o.type === 'text').map((o) => `"${(o as { text: string }).text}"`);
  return `${parts.join(', ')}${labels.length ? `; labels: ${labels.join(', ')}` : ''}.`;
}
