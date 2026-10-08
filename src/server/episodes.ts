// Episode persistence, revision checks, history and restore.
// Every change (browser or agent) goes through applyChanges(): one batch → one revision.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { randomId } from '../shared/ids.js';
import {
  EpisodeDocSchema,
  totalSeconds,
  type Episode,
  type EpisodeDoc,
  type EpisodeSummary,
  type RevisionInfo,
  type Scene,
} from '../shared/model.js';
import {
  ChangeRequestSchema,
  OperationError,
  applyOperations,
  formatZodError,
  summariseOperations,
  type ApplyContext,
  type ChangeRequest,
} from '../shared/ops.js';
import { exampleOperations } from '../shared/example.js';
import type { AssetRow, AssetStore } from './assets.js';
import type { Principal } from './auth.js';
import { now, type DB } from './db.js';
import { HttpError, badRequest, conflict, notFound } from './errors.js';

interface EpisodeRow {
  id: string;
  owner_id: string;
  revision: number;
  doc: string;
  created_at: string;
  updated_at: string;
}

export interface ChangeResult {
  episode: Episode;
  created: Record<number, string>;
}

export class Episodes {
  /** Emits `${episodeId}` with the new revision whenever a revision is committed. */
  readonly events = new EventEmitter();

  constructor(
    private db: DB,
    private assets: AssetStore,
  ) {
    this.events.setMaxListeners(0);
  }

  private row(principal: Principal, id: string): EpisodeRow {
    const row = this.db
      .prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL')
      .get(id) as (EpisodeRow & { owner_id: string }) | undefined;
    // Another account's episode is indistinguishable from a missing one.
    if (!row || row.owner_id !== principal.user.id) throw notFound('Episode not found');
    return row;
  }

  private toEpisode(row: EpisodeRow): Episode {
    return {
      id: row.id,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(JSON.parse(row.doc) as EpisodeDoc),
    };
  }

  list(principal: Principal): EpisodeSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM episodes WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC')
      .all(principal.user.id) as EpisodeRow[];
    return rows.map((r) => {
      const doc = JSON.parse(r.doc) as EpisodeDoc;
      return {
        id: r.id,
        title: doc.title,
        status: doc.status,
        revision: r.revision,
        sceneCount: doc.scenes.length,
        totalSeconds: totalSeconds(doc),
        targetSeconds: doc.targetSeconds,
        updatedAt: r.updated_at,
      };
    });
  }

  get(principal: Principal, id: string): Episode {
    return this.toEpisode(this.row(principal, id));
  }

  async create(principal: Principal, input: { title: string; brief?: string; withExample?: boolean }): Promise<Episode> {
    const parsed = EpisodeDocSchema.safeParse({ title: input.title, brief: input.brief ?? '' });
    if (!parsed.success) throw badRequest(formatZodError(parsed.error));
    const id = randomId('ep');
    const ts = now();
    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO episodes (id, owner_id, revision, doc, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)')
        .run(id, principal.user.id, JSON.stringify(parsed.data), ts, ts);
      this.insertRevision(id, 1, parsed.data, principal, 'Created episode');
    })();
    if (input.withExample) {
      const ops = exampleOperations();
      if (input.brief) ops[0] = { op: 'updateEpisode', fields: { targetSeconds: 600 } };
      return (await this.applyChanges(principal, id, { baseRevision: 1, summary: 'Added example opening sequence', operations: ops }))
        .episode;
    }
    return this.get(principal, id);
  }

  softDelete(principal: Principal, id: string) {
    this.row(principal, id);
    this.db.prepare('UPDATE episodes SET deleted_at = ? WHERE id = ?').run(now(), id);
  }

  private insertRevision(episodeId: string, revision: number, doc: EpisodeDoc, p: Principal, summary: string) {
    this.db
      .prepare(
        'INSERT INTO episode_revisions (episode_id, revision, doc, author_kind, author_label, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(episodeId, revision, JSON.stringify(doc), p.kind, p.label, summary, now());
  }

  private context(principal: Principal, row: EpisodeRow): ApplyContext {
    return {
      newId: (prefix) => randomId(prefix),
      nextRevision: row.revision + 1,
      resolveAsset: (assetId) => {
        const a = this.assets.get(assetId);
        if (!a || a.owner_id !== principal.user.id || a.episode_id !== row.id || a.kind !== 'upload') return null;
        return { mime: a.mime, bytes: a.bytes, width: a.width, height: a.height };
      },
      findDeletedScene: (sceneId) => this.findSceneInHistory(row.id, sceneId),
    };
  }

  private findSceneInHistory(episodeId: string, sceneId: string): Scene | null {
    const rows = this.db
      .prepare('SELECT doc FROM episode_revisions WHERE episode_id = ? ORDER BY revision DESC LIMIT 1000')
      .iterate(episodeId) as Iterable<{ doc: string }>;
    for (const r of rows) {
      if (!r.doc.includes(sceneId)) continue;
      const scene = (JSON.parse(r.doc) as EpisodeDoc).scenes.find((s) => s.id === sceneId);
      if (scene) return scene;
    }
    return null;
  }

  /**
   * Applies a batch atomically. The batch must be based on the current revision; otherwise it is
   * rejected with 409 so the writer can re-read instead of overwriting newer work.
   */
  async applyChanges(principal: Principal, episodeId: string, body: unknown): Promise<ChangeResult> {
    const parsed = ChangeRequestSchema.safeParse(body);
    if (!parsed.success) throw badRequest(`Invalid change request: ${formatZodError(parsed.error)}`);
    const req: ChangeRequest = parsed.data;
    const row = this.row(principal, episodeId);
    if (row.revision !== req.baseRevision) throw this.staleError(row, req.baseRevision);

    const before = JSON.parse(row.doc) as EpisodeDoc;
    let result;
    try {
      result = applyOperations(before, req.operations, this.context(principal, row));
    } catch (e) {
      if (e instanceof OperationError) {
        throw badRequest(e.opIndex !== null ? `Operation ${e.opIndex + 1} (${req.operations[e.opIndex].op}): ${e.message}` : e.message, {
          operationIndex: e.opIndex,
        });
      }
      throw e;
    }

    // Render previews before committing; the drawing and its PNG land in the same revision.
    const rendered: AssetRow[] = [];
    try {
      for (const sceneId of result.storyboardsToRender) {
        const scene = result.doc.scenes.find((s) => s.id === sceneId)!;
        const sb = scene.storyboard!;
        const bgAttachment = sb.backgroundAttachmentId
          ? scene.attachments.find((a) => a.id === sb.backgroundAttachmentId && a.kind === 'image')
          : null;
        const bgAsset = bgAttachment && bgAttachment.kind === 'image' ? this.assets.get(bgAttachment.assetId) ?? null : null;
        const png = await this.assets.renderStoryboard(sb, bgAsset);
        const file = this.assets.prepareFile(sb.previewAssetId, episodeId, 'png', png);
        rendered.push({
          id: sb.previewAssetId,
          owner_id: principal.user.id,
          episode_id: episodeId,
          kind: 'preview',
          mime: 'image/png',
          bytes: png.length,
          width: sb.width,
          height: sb.height,
          sha256: crypto.createHash('sha256').update(png).digest('hex'),
          file,
          original_name: null,
          created_at: now(),
        });
      }

      const summary = req.summary?.trim() || summariseOperations(before, req.operations);
      const next = row.revision + 1;
      const ts = now();
      this.db.transaction(() => {
        const current = this.db.prepare('SELECT revision FROM episodes WHERE id = ?').get(episodeId) as { revision: number };
        // Another write may have committed while previews were rendering.
        if (current.revision !== req.baseRevision) throw this.staleError({ ...row, revision: current.revision }, req.baseRevision);
        this.db
          .prepare('UPDATE episodes SET revision = ?, doc = ?, updated_at = ? WHERE id = ?')
          .run(next, JSON.stringify(result.doc), ts, episodeId);
        this.insertRevision(episodeId, next, result.doc, principal, summary);
        for (const a of rendered) this.assets.insertRow(a);
      })();
    } catch (e) {
      // Never leave a preview file that no saved document points to.
      this.assets.removeFiles(rendered);
      throw e;
    }
    this.events.emit(episodeId, row.revision + 1);
    return { episode: this.get(principal, episodeId), created: result.created };
  }

  private staleError(row: Pick<EpisodeRow, 'id' | 'revision'>, base: number): HttpError {
    const later = this.db
      .prepare(
        'SELECT revision, author_kind AS authorKind, author_label AS authorLabel, summary, created_at AS createdAt FROM episode_revisions WHERE episode_id = ? AND revision > ? ORDER BY revision',
      )
      .all(row.id, base);
    return conflict(
      `Stale revision: this change was based on revision ${base}, but the episode is now at revision ${row.revision}. Read the episode again and reapply only the intended change.`,
      { code: 'stale_revision', currentRevision: row.revision, baseRevision: base, newerRevisions: later },
    );
  }

  revisions(principal: Principal, id: string, limit = 100): RevisionInfo[] {
    this.row(principal, id);
    return this.db
      .prepare(
        `SELECT revision, created_at AS createdAt, author_kind AS authorKind, author_label AS authorLabel, summary
         FROM episode_revisions WHERE episode_id = ? ORDER BY revision DESC LIMIT ?`,
      )
      .all(id, limit) as RevisionInfo[];
  }

  revisionSnapshot(principal: Principal, id: string, revision: number): Episode & RevisionInfo {
    this.row(principal, id);
    const r = this.db
      .prepare('SELECT * FROM episode_revisions WHERE episode_id = ? AND revision = ?')
      .get(id, revision) as
      | { revision: number; doc: string; created_at: string; author_kind: RevisionInfo['authorKind']; author_label: string; summary: string }
      | undefined;
    if (!r) throw notFound('Revision not found');
    return {
      ...(JSON.parse(r.doc) as EpisodeDoc),
      id,
      createdAt: r.created_at,
      updatedAt: r.created_at,
      revision: r.revision,
      authorKind: r.author_kind,
      authorLabel: r.author_label,
      summary: r.summary,
    };
  }

  /**
   * Restores the content of an earlier revision as a new revision. History is never erased.
   * If more than one later revision would be reverted, the caller must acknowledge them explicitly.
   */
  restore(
    principal: Principal,
    id: string,
    body: { targetRevision?: unknown; baseRevision?: unknown; acknowledgeLaterRevisions?: unknown },
  ): Episode {
    const row = this.row(principal, id);
    const target = Number(body.targetRevision);
    const base = Number(body.baseRevision);
    if (!Number.isInteger(target) || !Number.isInteger(base)) throw badRequest('targetRevision and baseRevision are required');
    if (base !== row.revision) throw this.staleError(row, base);
    if (target >= row.revision || target < 1) throw badRequest(`Choose a revision earlier than ${row.revision}`);
    const snap = this.revisionSnapshot(principal, id, target);
    const reverted = this.db
      .prepare(
        'SELECT revision, author_label AS authorLabel, summary, created_at AS createdAt FROM episode_revisions WHERE episode_id = ? AND revision > ? ORDER BY revision',
      )
      .all(id, target) as { revision: number; authorLabel: string; summary: string }[];
    if (reverted.length > 1 && body.acknowledgeLaterRevisions !== true) {
      throw conflict(
        `Restoring revision ${target} would also revert ${reverted.length - 1} later change(s). Review them and confirm with acknowledgeLaterRevisions: true.`,
        { code: 'later_revisions', revertedRevisions: reverted },
      );
    }
    const doc = EpisodeDocSchema.parse({
      title: snap.title,
      brief: snap.brief,
      outline: snap.outline,
      notes: snap.notes,
      targetSeconds: snap.targetSeconds,
      status: snap.status,
      scenes: snap.scenes,
    });
    const next = row.revision + 1;
    const summary =
      reverted.length === 1
        ? `Undid revision ${reverted[0].revision} (${reverted[0].summary})`.slice(0, 300)
        : `Restored revision ${target}; reverted revisions ${reverted[0].revision}–${reverted[reverted.length - 1].revision}`;
    this.db.transaction(() => {
      const current = this.db.prepare('SELECT revision FROM episodes WHERE id = ?').get(id) as { revision: number };
      if (current.revision !== base) throw this.staleError({ id, revision: current.revision }, base);
      this.db.prepare('UPDATE episodes SET revision = ?, doc = ?, updated_at = ? WHERE id = ?').run(next, JSON.stringify(doc), now(), id);
      this.insertRevision(id, next, doc, principal, summary);
    })();
    this.events.emit(id, next);
    return this.get(principal, id);
  }

  /** Assets referenced by one consistent episode document. */
  referencedAssets(doc: EpisodeDoc): { uploads: Set<string>; previews: Set<string> } {
    const uploads = new Set<string>();
    const previews = new Set<string>();
    for (const s of doc.scenes) {
      for (const a of s.attachments) if (a.kind === 'image') uploads.add(a.assetId);
      if (s.storyboard) previews.add(s.storyboard.previewAssetId);
    }
    return { uploads, previews };
  }

  /** Account ownership check used by asset routes. */
  ownsEpisode(principal: Principal, id: string) {
    this.row(principal, id);
  }
}
