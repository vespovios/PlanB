// Canonical PlanB planning model. Shared by the browser, the REST API and the MCP adapter
// so every writer goes through the same validation.
import { z } from 'zod';
import { StoryboardSchema } from './storyboard.js';
import { CUT_TYPES, SHOT_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES, keysOf } from './vocab.js';

/** Version of the exported plan.json / episode document shape (independent of the product brief label). */
export const PLAN_SCHEMA_VERSION = 1;

export const LIMITS = {
  title: 200,
  shortText: 500,
  longText: 20_000,
  maxDurationSeconds: 24 * 60 * 60,
  maxScenes: 300,
  maxShotsPerScene: 200,
  maxAttachmentsPerScene: 50,
  maxOperationsPerBatch: 200,
  imageBytes: 10 * 1024 * 1024,
  imageMaxSide: 8000,
  imageMaxPixels: 50_000_000,
} as const;

export const idPattern = (prefix: string) => new RegExp(`^${prefix}_[A-Za-z0-9]{6,32}$`);
export const SceneId = z.string().regex(idPattern('sc'), 'Scene IDs look like sc_xxxxxxxx');
export const ShotId = z.string().regex(idPattern('sh'), 'Shot IDs look like sh_xxxxxxxx');
export const AttachmentId = z.string().regex(idPattern('at'), 'Attachment IDs look like at_xxxxxxxx');
export const AssetId = z.string().regex(idPattern('as'), 'Asset IDs look like as_xxxxxxxx');
export const GearId = z.string().regex(idPattern('ge'), 'Gear IDs look like ge_xxxxxxxx');

const text = (max: number = LIMITS.longText) => z.string().max(max);
export const Duration = z
  .number()
  .int('Durations are whole seconds')
  .min(1, 'Durations must be at least 1 second')
  .max(LIMITS.maxDurationSeconds);

export const PlanningStatus = z.enum(['draft', 'ready']);
export const ShotPriority = z.enum(['essential', 'optional']);
export const ShotSizeEnum = z.enum(keysOf(SHOT_SIZES));
export const ShotAngleEnum = z.enum(keysOf(SHOT_ANGLES));
export const ShotMovementEnum = z.enum(keysOf(SHOT_MOVEMENTS));
export const CutTypeEnum = z.enum(keysOf(CUT_TYPES));

/** Kit the creator is taking: cameras, lenses, supports, audio, light, power… */
export const GEAR_KINDS = ['camera', 'lens', 'support', 'audio', 'light', 'power', 'storage', 'other'] as const;
export const GearKind = z.enum(GEAR_KINDS);
export const GearItemSchema = z.object({
  id: GearId,
  name: text(80).trim().min(1, 'Gear needs a name'),
  kind: GearKind.default('other'),
  notes: text(LIMITS.shortText).default(''),
});
export type GearItem = z.infer<typeof GearItemSchema>;

/**
 * What happened to a shot on the shoot. open: no outcome recorded yet (still possible).
 * filmed: the creator reports footage was captured (not that it was reviewed).
 * skipped: deliberately dropped from this shoot; resolved, but there is no footage.
 */
export const ShotOutcome = z.enum(['open', 'filmed', 'skipped']);
export type ShotOutcome = z.infer<typeof ShotOutcome>;

export const ShotSchema = z.object({
  id: ShotId,
  description: text(LIMITS.shortText * 4).min(1, 'A shot needs a short description'),
  framing: text(LIMITS.shortText).default(''),
  /** Optional structured framing from the shared vocabulary (see vocab.ts). */
  size: ShotSizeEnum.nullable().default(null),
  angle: ShotAngleEnum.nullable().default(null),
  movement: ShotMovementEnum.nullable().default(null),
  cameraNotes: text().default(''),
  /** Gear from the episode's kit list used for this shot (camera, support, mic…). */
  gear: z.array(GearId).max(12).default([]),
  priority: ShotPriority.default('essential'),
  outcome: ShotOutcome.default('open'),
  /** Optional short reason, only kept while the shot is skipped (e.g. "Wind too strong"). */
  skipReason: text(160).default(''),
  /** When the current outcome was recorded (server time); null while open. */
  outcomeAt: z.string().max(40).nullable().default(null),
  /** References to trip-journal entries about this shot (IDs or URLs from the Trip Log). */
  journalRefs: z.array(text(300).trim().min(1)).max(20).default([]),
  /** Legacy mirror of outcome === 'filmed', kept for older clients and agents. */
  captured: z.boolean().default(false),
});
export type Shot = z.infer<typeof ShotSchema>;

const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => {
    try {
      const p = new URL(u);
      return p.protocol === 'http:' || p.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Reference links must be http:// or https:// URLs');

export const ImageAttachmentSchema = z.object({
  id: AttachmentId,
  kind: z.literal('image'),
  label: text(LIMITS.title).default(''),
  caption: text(LIMITS.shortText * 2).default(''),
  assetId: AssetId,
  mime: z.enum(['image/png', 'image/jpeg']),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const LinkAttachmentSchema = z.object({
  id: AttachmentId,
  kind: z.literal('link'),
  label: text(LIMITS.title).min(1, 'Reference links need a label'),
  caption: text(LIMITS.shortText * 2).default(''),
  url: httpUrl,
});
export const AttachmentSchema = z.discriminatedUnion('kind', [ImageAttachmentSchema, LinkAttachmentSchema]);
export type Attachment = z.infer<typeof AttachmentSchema>;
export type ImageAttachment = z.infer<typeof ImageAttachmentSchema>;

/** Optional free-text scene fields. Only title and duration are required from the creator. */
export const SCENE_TEXT_FIELDS = ['description', 'purpose', 'notes', 'voiceover', 'audio', 'location'] as const;

export const FilmNumber = z.number().int().min(1).max(99);

export const SceneSchema = z.object({
  id: SceneId,
  title: text(LIMITS.title).trim().min(1, 'A scene needs a title'),
  durationSeconds: Duration,
  status: PlanningStatus.default('draft'),
  description: text().default(''),
  purpose: text().default(''),
  notes: text().default(''),
  voiceover: text().default(''),
  audio: text().default(''),
  location: text(LIMITS.shortText).default(''),
  thumbnailAttachmentId: AttachmentId.nullable().default(null),
  /** Editing intention for the transition into the next scene (rough-cut guide). */
  cutToNext: CutTypeEnum.nullable().default(null),
  /** When it gets filmed, independent of story order: shooting day (1, 2, …) and stop within that day. */
  filmDay: FilmNumber.nullable().default(null),
  filmStop: FilmNumber.nullable().default(null),
  shots: z.array(ShotSchema).max(LIMITS.maxShotsPerScene).default([]),
  attachments: z.array(AttachmentSchema).max(LIMITS.maxAttachmentsPerScene).default([]),
  storyboard: StoryboardSchema.nullable().default(null),
});
export type Scene = z.infer<typeof SceneSchema>;

export const EpisodeDocSchema = z.object({
  title: text(LIMITS.title).trim().min(1, 'An episode needs a title'),
  brief: text().default(''),
  outline: text().default(''),
  notes: text(LIMITS.longText * 5).default(''),
  targetSeconds: Duration.nullable().default(null),
  status: PlanningStatus.default('draft'),
  /** Kit list for this episode; shots refer to items by ID. */
  gear: z.array(GearItemSchema).max(100).default([]),
  scenes: z.array(SceneSchema).max(LIMITS.maxScenes).default([]),
});
export type EpisodeDoc = z.infer<typeof EpisodeDocSchema>;

/** An episode as returned by the API: the document plus server-owned metadata. */
export interface Episode extends EpisodeDoc {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeSummary {
  id: string;
  /** Null for the account's own episodes; the owner's name for episodes shared with it. */
  ownerName: string | null;
  title: string;
  status: 'draft' | 'ready';
  revision: number;
  sceneCount: number;
  totalSeconds: number;
  targetSeconds: number | null;
  updatedAt: string;
  /** For the episode switcher: first storyboard previews, and progress counts. */
  coverAssetIds: string[];
  shotCount: number;
  capturedCount: number;
  skippedCount: number;
  storyboardCount: number;
}

export interface RevisionInfo {
  revision: number;
  createdAt: string;
  authorKind: 'user' | 'agent' | 'system';
  authorLabel: string;
  summary: string;
}

/** Cross-reference checks that a plain schema cannot express. Returns readable problems. */
export function referentialProblems(doc: EpisodeDoc): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const dup = (id: string) => {
    if (seen.has(id)) problems.push(`Duplicate ID ${id}`);
    seen.add(id);
  };
  const gearIds = new Set((doc.gear ?? []).map((g) => g.id));
  for (const g of doc.gear ?? []) dup(g.id);
  for (const scene of doc.scenes) {
    dup(scene.id);
    for (const shot of scene.shots) {
      const missing = (shot.gear ?? []).filter((id) => !gearIds.has(id));
      if (missing.length) problems.push(`A shot in "${scene.title}" uses gear ${missing.join(', ')} that is not in the kit list. Add it to the kit list first.`);
    }
    scene.shots.forEach((s) => dup(s.id));
    scene.attachments.forEach((a) => dup(a.id));
    const images = new Map(scene.attachments.filter((a) => a.kind === 'image').map((a) => [a.id, a]));
    if (scene.thumbnailAttachmentId && !images.has(scene.thumbnailAttachmentId)) {
      problems.push(
        `Scene "${scene.title}" uses ${scene.thumbnailAttachmentId} as its thumbnail, but that is not an image reference in the scene. Choose another thumbnail or clear it.`,
      );
    }
    const bg = scene.storyboard?.backgroundAttachmentId;
    if (bg && !images.has(bg)) {
      problems.push(
        `The storyboard in scene "${scene.title}" is drawn over image ${bg}, which is not an image reference in this scene. Replace or detach the storyboard background in the same change before removing that image.`,
      );
    }
  }
  return problems;
}

export function totalSeconds(doc: Pick<EpisodeDoc, 'scenes'>): number {
  return doc.scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
}

export function sceneStarts(doc: Pick<EpisodeDoc, 'scenes'>): number[] {
  let t = 0;
  return doc.scenes.map((s) => {
    const start = t;
    t += s.durationSeconds;
    return start;
  });
}

/** "S01", "S02" … display numbers. These are positional and change on reorder; IDs do not. */
export const sceneNumber = (index: number) => `S${String(index + 1).padStart(2, '0')}`;

export function formatTime(totalSecs: number): string {
  const s = Math.max(0, Math.round(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Parses "75", "1:15" or "0:01:15" into whole seconds. */
export function parseTime(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export interface OutcomeCounts {
  filmed: number;
  skipped: number;
  open: number;
  total: number;
}

export function outcomeCounts(shots: Pick<Shot, 'outcome'>[]): OutcomeCounts {
  const c = { filmed: 0, skipped: 0, open: 0, total: shots.length };
  for (const s of shots) c[s.outcome ?? 'open']++;
  return c;
}

/** "29 filmed · 10 skipped · 7 open" (zero parts left out, except open when nothing is recorded). */
export function outcomeSummary(c: OutcomeCounts): string {
  if (!c.total) return 'no shots';
  const parts = [c.filmed && `${c.filmed} filmed`, c.skipped && `${c.skipped} skipped`, c.open && `${c.open} open`].filter(Boolean);
  return parts.join(' · ');
}

/** Per scene: filmed (= captured), skipped, open and total. Skipped counts as resolved, never as filmed. */
export function capturedCount(scene: Pick<Scene, 'shots'>): { captured: number; total: number } & OutcomeCounts {
  const c = outcomeCounts(scene.shots);
  return { captured: c.filmed, ...c };
}

/**
 * Brings documents saved before shot outcomes existed up to date (captured → outcome) and keeps
 * the legacy `captured` flag in step. Mutates and returns the document.
 */
export function normaliseDoc<T extends { scenes: { shots: Partial<Shot>[] }[] }>(doc: T): T {
  for (const scene of doc.scenes ?? []) {
    for (const shot of scene.shots ?? []) {
      if (!shot.outcome) shot.outcome = shot.captured ? 'filmed' : 'open';
      shot.captured = shot.outcome === 'filmed';
      shot.skipReason ??= '';
      shot.outcomeAt ??= null;
      shot.journalRefs ??= [];
    }
  }
  return doc;
}
