// Change operations. The browser and the external agent submit the same batches; the
// server applies them atomically as one revision after the same validation.
import { z } from 'zod';
import {
  AssetId,
  AttachmentId,
  Duration,
  EpisodeDocSchema,
  LIMITS,
  PlanningStatus,
  SceneId,
  SceneSchema,
  ShotId,
  ShotPriority,
  ShotSchema,
  referentialProblems,
  type Attachment,
  type EpisodeDoc,
  type Scene,
} from './model.js';
import { StoryboardInputSchema } from './storyboard.js';

const t = (max: number = LIMITS.longText) => z.string().max(max);
const index = z.number().int().min(0).optional();

const EpisodeFields = z
  .object({
    title: t(LIMITS.title),
    brief: t(),
    outline: t(),
    notes: t(LIMITS.longText * 5),
    targetSeconds: Duration.nullable(),
    status: PlanningStatus,
  })
  .partial()
  .strict();

const SceneFields = z
  .object({
    title: t(LIMITS.title),
    durationSeconds: Duration,
    status: PlanningStatus,
    description: t(),
    purpose: t(),
    notes: t(),
    voiceover: t(),
    audio: t(),
    location: t(LIMITS.shortText),
    thumbnailAttachmentId: AttachmentId.nullable(),
  })
  .partial()
  .strict();
export type SceneFields = z.infer<typeof SceneFields>;

const ShotFields = z
  .object({
    description: t(LIMITS.shortText * 4),
    framing: t(LIMITS.shortText),
    cameraNotes: t(),
    priority: ShotPriority,
    captured: z.boolean(),
  })
  .partial()
  .strict();
export type ShotFields = z.infer<typeof ShotFields>;

const NewShot = ShotFields.extend({ description: t(LIMITS.shortText * 4).trim().min(1, 'A shot needs a short description') });

export const OperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('updateEpisode'), fields: EpisodeFields }),
  z.object({
    op: z.literal('addScene'),
    id: SceneId.optional(),
    index,
    scene: SceneFields.extend({
      title: t(LIMITS.title).trim().min(1, 'A scene needs a title'),
      durationSeconds: Duration,
      shots: z.array(NewShot).max(LIMITS.maxShotsPerScene).optional(),
    }),
  }),
  z.object({ op: z.literal('updateScene'), sceneId: SceneId, fields: SceneFields }),
  z.object({ op: z.literal('deleteScene'), sceneId: SceneId }),
  z.object({ op: z.literal('restoreDeletedScene'), sceneId: SceneId, index }),
  z.object({ op: z.literal('moveScene'), sceneId: SceneId, index: z.number().int().min(0) }),
  z.object({ op: z.literal('addShot'), sceneId: SceneId, id: ShotId.optional(), index, shot: NewShot }),
  z.object({ op: z.literal('updateShot'), sceneId: SceneId, shotId: ShotId, fields: ShotFields }),
  z.object({ op: z.literal('deleteShot'), sceneId: SceneId, shotId: ShotId }),
  z.object({ op: z.literal('moveShot'), sceneId: SceneId, shotId: ShotId, index: z.number().int().min(0) }),
  z.object({
    op: z.literal('addLink'),
    sceneId: SceneId,
    id: AttachmentId.optional(),
    label: t(LIMITS.title).min(1),
    url: z.string().max(2000),
    caption: t(LIMITS.shortText * 2).optional(),
  }),
  z.object({
    op: z.literal('addImage'),
    sceneId: SceneId,
    id: AttachmentId.optional(),
    assetId: AssetId,
    label: t(LIMITS.title).optional(),
    caption: t(LIMITS.shortText * 2).optional(),
  }),
  z.object({
    op: z.literal('updateAttachment'),
    sceneId: SceneId,
    attachmentId: AttachmentId,
    fields: z
      .object({ label: t(LIMITS.title), caption: t(LIMITS.shortText * 2), url: z.string().max(2000) })
      .partial()
      .strict(),
  }),
  z.object({ op: z.literal('removeAttachment'), sceneId: SceneId, attachmentId: AttachmentId }),
  z.object({ op: z.literal('saveStoryboard'), sceneId: SceneId, storyboard: StoryboardInputSchema }),
  z.object({ op: z.literal('deleteStoryboard'), sceneId: SceneId }),
]);
export type Operation = z.infer<typeof OperationSchema>;

export const ChangeRequestSchema = z.object({
  baseRevision: z.number().int().min(1),
  summary: z.string().max(500).optional(),
  operations: z.array(OperationSchema).min(1).max(LIMITS.maxOperationsPerBatch),
});
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

export class OperationError extends Error {
  constructor(
    message: string,
    public opIndex: number | null = null,
  ) {
    super(message);
  }
}

export interface ApplyContext {
  newId(prefix: 'sc' | 'sh' | 'at' | 'sb' | 'as'): string;
  /** Revision number this batch will create. */
  nextRevision: number;
  /** Server: metadata for an uploaded asset owned by this episode, or null. */
  resolveAsset?(assetId: string): { mime: 'image/png' | 'image/jpeg'; bytes: number; width: number; height: number } | null;
  /** Server: most recent saved copy of a scene that no longer exists in the episode. */
  findDeletedScene?(sceneId: string): Scene | null;
}

export interface ApplyResult {
  doc: EpisodeDoc;
  /** Scene IDs whose storyboard was saved in this batch and needs a fresh preview render. */
  storyboardsToRender: string[];
  created: Record<number, string>;
}

const clamp = (i: number | undefined, len: number) => (i === undefined ? len : Math.max(0, Math.min(len, i)));

/**
 * Applies operations to a copy of the document. Throws OperationError with a readable message.
 * The resulting document is fully validated, including cross-references.
 */
export function applyOperations(input: EpisodeDoc, ops: Operation[], ctx: ApplyContext): ApplyResult {
  const doc: EpisodeDoc = structuredClone(input);
  const toRender = new Set<string>();
  const created: Record<number, string> = {};
  const allIds = () => {
    const ids = new Set<string>();
    for (const s of doc.scenes) {
      ids.add(s.id);
      s.shots.forEach((x) => ids.add(x.id));
      s.attachments.forEach((x) => ids.add(x.id));
    }
    return ids;
  };
  // IDs present at the start of the batch can't be reused, even if removed earlier in the batch:
  // a new item must never inherit another item's identity (or a drawing's background reference).
  const initialIds = allIds();
  const freshId = (prefix: 'sc' | 'sh' | 'at', requested: string | undefined, i: number) => {
    if (requested) {
      if (initialIds.has(requested) || allIds().has(requested)) throw new OperationError(`ID ${requested} is already in use`, i);
      return requested;
    }
    return ctx.newId(prefix);
  };

  ops.forEach((op, i) => {
    const scene = (id: string): Scene => {
      const s = doc.scenes.find((x) => x.id === id);
      if (!s) throw new OperationError(`Scene ${id} was not found. It may have been deleted; read the episode again.`, i);
      return s;
    };
    switch (op.op) {
      case 'updateEpisode': {
        Object.assign(doc, op.fields);
        break;
      }
      case 'addScene': {
        if (doc.scenes.length >= LIMITS.maxScenes) throw new OperationError('Too many scenes', i);
        const { shots = [], ...fields } = op.scene;
        const id = freshId('sc', op.id, i);
        const parsedScene = SceneSchema.safeParse({
          ...fields,
          id,
          shots: shots.map((sh) => ({ ...sh, id: ctx.newId('sh') })),
        });
        if (!parsedScene.success) throw new OperationError(formatZodError(parsedScene.error), i);
        const s = parsedScene.data;
        doc.scenes.splice(clamp(op.index, doc.scenes.length), 0, s);
        created[i] = id;
        break;
      }
      case 'updateScene': {
        Object.assign(scene(op.sceneId), op.fields);
        break;
      }
      case 'deleteScene': {
        const s = scene(op.sceneId);
        doc.scenes.splice(doc.scenes.indexOf(s), 1);
        break;
      }
      case 'restoreDeletedScene': {
        if (doc.scenes.some((s) => s.id === op.sceneId)) throw new OperationError('That scene is already in the episode', i);
        const prior = ctx.findDeletedScene?.(op.sceneId);
        if (!prior) throw new OperationError(`No earlier copy of scene ${op.sceneId} was found`, i);
        const ids = allIds();
        const clash = [prior.id, ...prior.shots.map((s) => s.id), ...prior.attachments.map((a) => a.id)].find((x) => ids.has(x));
        if (clash) throw new OperationError(`Cannot restore: ID ${clash} is now used elsewhere`, i);
        doc.scenes.splice(clamp(op.index, doc.scenes.length), 0, structuredClone(prior));
        break;
      }
      case 'moveScene': {
        const s = scene(op.sceneId);
        doc.scenes.splice(doc.scenes.indexOf(s), 1);
        doc.scenes.splice(clamp(op.index, doc.scenes.length), 0, s);
        break;
      }
      case 'addShot': {
        const s = scene(op.sceneId);
        const id = freshId('sh', op.id, i);
        const shot = ShotSchema.safeParse({ ...op.shot, id });
        if (!shot.success) throw new OperationError(formatZodError(shot.error), i);
        s.shots.splice(clamp(op.index, s.shots.length), 0, shot.data);
        created[i] = id;
        break;
      }
      case 'updateShot':
      case 'deleteShot':
      case 'moveShot': {
        const s = scene(op.sceneId);
        const shot = s.shots.find((x) => x.id === op.shotId);
        if (!shot) throw new OperationError(`Shot ${op.shotId} was not found in scene "${s.title}"`, i);
        if (op.op === 'updateShot') Object.assign(shot, op.fields);
        else {
          s.shots.splice(s.shots.indexOf(shot), 1);
          if (op.op === 'moveShot') s.shots.splice(clamp(op.index, s.shots.length), 0, shot);
        }
        break;
      }
      case 'addLink': {
        const s = scene(op.sceneId);
        const id = freshId('at', op.id, i);
        s.attachments.push({ id, kind: 'link', label: op.label, url: op.url.trim(), caption: op.caption ?? '' });
        created[i] = id;
        break;
      }
      case 'addImage': {
        const s = scene(op.sceneId);
        const meta = ctx.resolveAsset?.(op.assetId);
        if (!meta) throw new OperationError(`Image ${op.assetId} was not found. Upload it to this episode first.`, i);
        const id = freshId('at', op.id, i);
        s.attachments.push({ id, kind: 'image', label: op.label ?? '', caption: op.caption ?? '', assetId: op.assetId, ...meta });
        created[i] = id;
        break;
      }
      case 'updateAttachment': {
        const s = scene(op.sceneId);
        const a = s.attachments.find((x) => x.id === op.attachmentId);
        if (!a) throw new OperationError(`Reference ${op.attachmentId} was not found`, i);
        if (op.fields.url !== undefined && a.kind !== 'link') throw new OperationError('Only reference links have a URL', i);
        Object.assign(a, op.fields);
        break;
      }
      case 'removeAttachment': {
        const s = scene(op.sceneId);
        const a = s.attachments.find((x) => x.id === op.attachmentId);
        if (!a) throw new OperationError(`Reference ${op.attachmentId} was not found`, i);
        s.attachments.splice(s.attachments.indexOf(a), 1);
        if (s.thumbnailAttachmentId === a.id) s.thumbnailAttachmentId = null;
        // A storyboard background is never silently removed: referentialProblems() rejects it below
        // unless this batch also replaced or detached the background.
        break;
      }
      case 'saveStoryboard': {
        const s = scene(op.sceneId);
        s.storyboard = {
          ...op.storyboard,
          id: s.storyboard?.id ?? ctx.newId('sb'),
          previewAssetId: ctx.newId('as'),
          savedRevision: ctx.nextRevision,
        };
        toRender.add(s.id);
        break;
      }
      case 'deleteStoryboard': {
        const s = scene(op.sceneId);
        s.storyboard = null;
        toRender.delete(s.id);
        break;
      }
    }
  });

  const parsed = EpisodeDocSchema.safeParse(doc);
  if (!parsed.success) throw new OperationError(formatZodError(parsed.error));
  const problems = referentialProblems(parsed.data);
  if (problems.length) throw new OperationError(problems.join(' '));
  return {
    doc: parsed.data,
    storyboardsToRender: [...toRender].filter((id) => parsed.data.scenes.some((s) => s.id === id && s.storyboard)),
    created,
  };
}

export function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** Short human-readable description of a batch, used in revision history. */
const FIELD_NAMES: Record<string, string> = {
  durationSeconds: 'duration',
  targetSeconds: 'target runtime',
  voiceover: 'voice-over',
  audio: 'audio/music',
  notes: 'notes',
  cameraNotes: 'camera notes',
  thumbnailAttachmentId: 'thumbnail',
  description: 'description',
};
const fieldList = (fields: object) =>
  Object.keys(fields)
    .map((f) => FIELD_NAMES[f] ?? f)
    .join(', ');

export function summariseOperations(before: EpisodeDoc, ops: Operation[]): string {
  const title = (id: string) => {
    const s = before.scenes.find((x) => x.id === id);
    return s ? `"${s.title}"` : 'a scene';
  };
  const parts = ops.map((op) => {
    switch (op.op) {
      case 'updateEpisode':
        return `Edited episode ${fieldList(op.fields)}`;
      case 'addScene':
        return `Added scene "${op.scene.title}"`;
      case 'updateScene':
        return `Edited ${title(op.sceneId)} ${fieldList(op.fields)}`;
      case 'deleteScene':
        return `Deleted ${title(op.sceneId)}`;
      case 'restoreDeletedScene':
        return 'Restored a deleted scene';
      case 'moveScene':
        return `Moved ${title(op.sceneId)}`;
      case 'addShot':
        return `Added shot to ${title(op.sceneId)}`;
      case 'updateShot':
        return `Edited shot in ${title(op.sceneId)} (${fieldList(op.fields)})`;
      case 'deleteShot':
        return `Deleted shot from ${title(op.sceneId)}`;
      case 'moveShot':
        return `Reordered shots in ${title(op.sceneId)}`;
      case 'addLink':
      case 'addImage':
        return `Added reference to ${title(op.sceneId)}`;
      case 'updateAttachment':
        return `Edited reference in ${title(op.sceneId)}`;
      case 'removeAttachment':
        return `Removed reference from ${title(op.sceneId)}`;
      case 'saveStoryboard':
        return `Saved storyboard for ${title(op.sceneId)}`;
      case 'deleteStoryboard':
        return `Deleted storyboard for ${title(op.sceneId)}`;
    }
  });
  const unique = [...new Set(parts)];
  const text = unique.slice(0, 3).join('; ') + (unique.length > 3 ? `; +${unique.length - 3} more` : '');
  return text.slice(0, 300);
}

export const STORY_STARTER = `Setup:
Desire:
Conflict:
Change:
Result:
`;
