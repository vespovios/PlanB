// Client-side save engine. Edits apply locally at once and are sent to the server in
// batches against the last confirmed revision. Nothing is shown as saved until the server
// accepts it. If someone else (e.g. the agent) saved first, the batch is rebased onto the
// newer revision when it touches different fields, or surfaced as a conflict when it doesn't.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { randomId } from '../shared/ids';
import type { Episode, EpisodeDoc, Scene } from '../shared/model';
import { applyOperations, type ApplyContext, type Operation } from '../shared/ops';
import { api, ApiError } from './api';
import { saves, type SaveIssue, type SaveIssueKind, type SaveParticipant } from './saves';

type FieldOp = Extract<Operation, { op: 'updateEpisode' | 'updateScene' | 'updateShot' | 'updateAttachment' | 'updateGear' }>;
interface Pending {
  op: Operation;
  key?: string;
  /** Field values this edit started from, for detecting edits made elsewhere. */
  base?: Record<string, unknown>;
  /** Sent at least once without a definite answer: the server may already have applied it. */
  unconfirmed?: boolean;
}

/** Edits dropped by the engine, kept for the coordinator until the user dismisses the message. */
interface Dropped {
  outcome: 'rejected' | 'uncertain';
  source: 'error' | 'notice' | 'direct';
  count: number;
  message: string;
}

/** No definite answer: the request may have been applied (lost response, proxy or server error). */
const ambiguous = (e: unknown) => !(e instanceof ApiError) || e.offline || e.status >= 500;

const frozenError = () =>
  new ApiError(423, 'Saving is paused right now. This change was not sent; it is still here.', { code: 'writes_frozen' });

type QueuedKind = Extract<SaveIssueKind, 'queued' | 'held' | 'offline' | 'auth' | 'server'>;
const queuedMessages: Record<QueuedKind, string> = {
  queued: 'Edits are waiting to be sent.',
  held: 'Edits are kept on this page while saving is paused.',
  offline: 'Edits are kept on this page until the connection returns.',
  auth: 'Edits are kept on this page; the server signed you out.',
  server: 'Edits are kept on this page after a server error.',
};

export type SaveState = 'loading' | 'saved' | 'pending' | 'saving' | 'offline' | 'error';

export interface Conflict {
  items: { label: string; mine: unknown; theirs: unknown }[];
}

export interface SyncSnapshot {
  episode: Episode | null;
  serverRevision: number;
  state: SaveState;
  error: string | null;
  conflict: Conflict | null;
  notice: string | null;
  loadError: string | null;
}

const isFieldOp = (op: Operation): op is FieldOp =>
  op.op === 'updateEpisode' || op.op === 'updateScene' || op.op === 'updateShot' || op.op === 'updateAttachment' || op.op === 'updateGear';

function opKey(op: FieldOp): string {
  switch (op.op) {
    case 'updateEpisode':
      return 'episode';
    case 'updateGear':
      return `gear:${op.gearId}`;
    case 'updateScene':
      return `scene:${op.sceneId}`;
    case 'updateShot':
      return `shot:${op.sceneId}:${op.shotId}`;
    case 'updateAttachment':
      return `att:${op.sceneId}:${op.attachmentId}`;
  }
}

function target(doc: EpisodeDoc, op: FieldOp): Record<string, unknown> | null {
  if (op.op === 'updateEpisode') return doc as unknown as Record<string, unknown>;
  if (op.op === 'updateGear') return ((doc.gear ?? []).find((g) => g.id === op.gearId) as unknown as Record<string, unknown>) ?? null;
  const scene = doc.scenes.find((s) => s.id === op.sceneId);
  if (!scene) return null;
  if (op.op === 'updateScene') return scene as unknown as Record<string, unknown>;
  if (op.op === 'updateShot') return (scene.shots.find((s) => s.id === op.shotId) as unknown as Record<string, unknown>) ?? null;
  return (scene.attachments.find((a) => a.id === op.attachmentId) as unknown as Record<string, unknown>) ?? null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function fieldLabel(op: FieldOp, field: string, doc: EpisodeDoc): string {
  const names: Record<string, string> = {
    durationSeconds: 'duration',
    voiceover: 'voice-over',
    audio: 'audio/music',
    purpose: 'purpose',
    description: 'description',
    targetSeconds: 'target runtime',
    cameraNotes: 'camera notes',
  };
  const f = names[field] ?? field;
  if (op.op === 'updateEpisode') return `Episode ${f}`;
  if (op.op === 'updateGear') return `Kit list ${f}`;
  const scene = doc.scenes.find((s) => s.id === op.sceneId);
  return `${scene ? `"${scene.title}"` : 'Scene'}${op.op === 'updateShot' ? ' shot' : op.op === 'updateAttachment' ? ' reference' : ''} ${f}`;
}

export class EpisodeSync implements SaveParticipant {
  private server: Episode | null = null;
  private queued: Pending[] = [];
  private inflight: Pending[] = [];
  private conflicted: Pending[] = [];
  private conflictInfo: Conflict | null = null;
  private state: SaveState = 'loading';
  private error: string | null = null;
  private notice: string | null = null;
  private loadError: string | null = null;
  private snap: SyncSnapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 2000;
  private lock: Promise<unknown> = Promise.resolve();
  private sending = false;
  private events: EventSource | null = null;
  private stopped = false;
  /** Highest revision announced by the server while a save was in flight. */
  private remoteSeen = 0;
  /** A refused change stays reported until the user dismisses it. */
  private stickyError = false;
  /** Copies of scenes deleted in this session, so "Undo" can show them immediately. */
  private deletedScenes = new Map<string, Scene>();
  private assetMeta = new Map<string, { mime: 'image/png' | 'image/jpeg'; bytes: number; width: number; height: number }>();
  /** Why queued edits are held for Retry (state 'error'). */
  private failure: 'auth' | 'server' | null = null;
  private dropped: Dropped[] = [];
  /** Direct saves (commitNow, uploads, restores) still running. */
  private active = new Set<Promise<unknown>>();
  /** Direct-save errors already recorded (or deliberately not), so an enclosing track() does not count them twice. */
  private handled = new WeakSet<object>();

  constructor(public readonly id: string) {
    this.snap = this.makeSnapshot();
  }

  // --- React wiring ------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private emit() {
    this.snap = this.makeSnapshot();
    this.listeners.forEach((fn) => fn());
    this.releaseIfDone();
  }

  private makeSnapshot(): SyncSnapshot {
    return {
      episode: this.computeLocal(),
      serverRevision: this.server?.revision ?? 0,
      state: this.state,
      error: this.error,
      conflict: this.conflictInfo,
      notice: this.notice,
      loadError: this.loadError,
    };
  }

  private ctx(): ApplyContext {
    return {
      newId: (p) => randomId(p),
      nextRevision: (this.server?.revision ?? 0) + 1,
      resolveAsset: (id) => this.assetMeta.get(id) ?? null,
      findDeletedScene: (id) => this.deletedScenes.get(id) ?? null,
    };
  }

  private computeLocal(): Episode | null {
    if (!this.server) return null;
    let doc: EpisodeDoc = this.server;
    for (const p of [...this.inflight, ...this.queued, ...this.conflicted]) {
      try {
        doc = applyOperations(doc, [p.op], this.ctx()).doc;
      } catch {
        // An edit that no longer applies (e.g. its scene was removed) is reported by rebase().
      }
    }
    const { id, revision, createdAt, updatedAt } = this.server;
    return { ...doc, id, revision, createdAt, updatedAt };
  }

  // --- Lifecycle -------------------------------------------------------------------

  start() {
    this.stopped = false;
    saves.register(this);
    void this.load();
    this.connectEvents();
    window.addEventListener('beforeunload', this.beforeUnload);
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop() {
    this.stopped = true;
    this.events?.close();
    this.events = null;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    window.removeEventListener('beforeunload', this.beforeUnload);
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisible);
    // Best effort: send anything still waiting.
    if (this.queued.length && this.server && !this.sending) void this.flush();
    // Unsaved work stays registered with the coordinator until it is resolved.
    this.releaseIfDone();
  }

  /** Nothing outstanding: no edits, no requests, no unacknowledged dropped edits. */
  private get idle() {
    return !this.hasUnsaved && !this.sending && !this.active.size && !this.dropped.length;
  }

  private releaseIfDone() {
    if (this.stopped && this.idle) saves.unregister(this);
  }

  get hasUnsaved() {
    return this.queued.length + this.inflight.length + this.conflicted.length > 0;
  }

  private beforeUnload = (e: BeforeUnloadEvent) => {
    if (this.hasUnsaved) {
      void this.flush();
      e.preventDefault();
    }
  };
  private onOnline = () => {
    if (this.state === 'offline') void this.flush();
    else if (this.server) void this.refresh();
  };

  private connectEvents() {
    if (typeof EventSource === 'undefined') return;
    this.events = new EventSource(`/api/episodes/${this.id}/events`);
    this.events.addEventListener('revision', (ev) => {
      const { revision } = JSON.parse((ev as MessageEvent).data) as { revision: number };
      if (!this.server || revision <= this.server.revision) return;
      if (this.sending) this.remoteSeen = Math.max(this.remoteSeen, revision);
      else void this.refresh();
    });
    // EventSource retries dropped connections itself, but gives up after some failures
    // (e.g. a server restart answered by a proxy error). Reopen it, then catch up.
    this.events.onerror = () => {
      if (this.events?.readyState !== EventSource.CLOSED) return;
      this.events.close();
      this.events = null;
      if (!this.stopped) setTimeout(() => !this.stopped && !this.events && this.connectEvents(), 3000);
    };
    this.events.onopen = () => {
      if (this.server) void this.refresh();
    };
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.server) void this.refresh();
  };

  private async load() {
    try {
      const { episode } = await api.episode(this.id);
      this.server = episode;
      this.state = 'saved';
      this.loadError = null;
    } catch (e) {
      this.loadError = (e as Error).message;
    }
    this.emit();
  }

  /** Fetches the latest saved revision and replays local edits on top of it. */
  async refresh() {
    return this.exclusive(async () => {
      try {
        const { episode } = await api.episode(this.id);
        if (this.server && episode.revision <= this.server.revision) return;
        this.rebase(episode);
      } catch (e) {
        if ((e as ApiError).offline) this.setOffline((e as Error).message);
      }
    });
  }

  // --- Editing -------------------------------------------------------------------------

  /** Queue an edit. Text edits are debounced and merged per field; structural edits save at once. */
  queue(op: Operation, debounceMs = 0) {
    if (!this.server) return;
    if (op.op === 'deleteScene') {
      const s = this.snap.episode?.scenes.find((x) => x.id === op.sceneId);
      if (s) this.deletedScenes.set(s.id, structuredClone(s));
    }
    if (isFieldOp(op)) {
      const key = opKey(op);
      const existing = this.queued.find((p) => p.key === key);
      const before = target(this.confirmedPlusInflight(), op) ?? {};
      if (existing && isFieldOp(existing.op)) {
        for (const f of Object.keys(op.fields)) if (!(f in existing.base!)) existing.base![f] = before[f];
        Object.assign(existing.op.fields, op.fields);
      } else {
        const base: Record<string, unknown> = {};
        for (const f of Object.keys(op.fields)) base[f] = before[f];
        this.queued.push({ op: structuredClone(op), key, base });
      }
    } else {
      this.queued.push({ op });
    }
    if (this.state !== 'offline') this.state = 'pending';
    this.notice = null;
    this.emit();
    this.schedule(debounceMs);
  }

  rememberAsset(id: string, meta: { mime: string; bytes: number; width: number; height: number }) {
    this.assetMeta.set(id, meta as never);
  }

  private confirmedPlusInflight(): EpisodeDoc {
    let doc: EpisodeDoc = this.server!;
    for (const p of this.inflight) {
      try {
        doc = applyOperations(doc, [p.op], this.ctx()).doc;
      } catch {
        /* ignore */
      }
    }
    return doc;
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    if (saves.isFrozen) return;
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  /** Save queued edits now (e.g. on blur). Resolves whatever the outcome; see issues(). */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (saves.isFrozen) return Promise.resolve();
    return this.exclusive(() => this.flushInner()) as Promise<void>;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async flushInner(): Promise<void> {
    // Checked when the send is about to happen, not only when it was requested: a flush waiting
    // behind another request must not go out after writes were frozen. The edits stay queued.
    if (!this.server || !this.queued.length || saves.isFrozen) return;
    clearTimeout(this.retryTimer);
    this.sending = true;
    this.inflight = this.queued;
    this.queued = [];
    this.state = 'saving';
    this.emit();
    try {
      const res = await api.changes(
        this.id,
        this.server.revision,
        this.inflight.map((p) => p.op),
      );
      this.server = res.episode;
      // Later edits to the same fields are now based on what was just saved.
      for (const q of this.queued) {
        if (!q.key || !q.base || !isFieldOp(q.op)) continue;
        const sent = this.inflight.find((p) => p.key === q.key);
        if (!sent || !isFieldOp(sent.op)) continue;
        const now = target(this.server, q.op) ?? {};
        for (const f of Object.keys(sent.op.fields)) if (f in q.base) q.base[f] = now[f];
      }
      this.inflight = [];
      this.retryDelay = 2000;
      this.failure = null;
      if (!this.stickyError) this.error = null;
      this.state = this.queued.length ? 'pending' : 'saved';
    } catch (e) {
      const err = e as ApiError;
      const failed = this.inflight;
      this.inflight = [];
      if (!(e instanceof ApiError)) {
        // Not an answer from the server (e.g. the response could not be read): the batch may have
        // been applied. Keep it for Retry; a replay is checked against the revision as usual.
        for (const p of failed) p.unconfirmed = true;
        this.queued = [...failed, ...this.queued];
        this.failure = 'server';
        this.state = 'error';
        this.error = `Could not confirm this save (${(e as Error)?.message ?? e}). Your edits are kept on this page; press Retry.`;
      } else if (err.status === 409 && err.body.code === 'stale_revision') {
        this.queued = [...failed, ...this.queued];
        try {
          const { episode } = await api.episode(this.id);
          this.rebase(episode);
        } catch (e2) {
          this.setOffline((e2 as Error).message);
        }
      } else if (err.offline || err.status >= 500 || err.status === 401) {
        if (ambiguous(err)) for (const p of failed) p.unconfirmed = true;
        this.queued = [...failed, ...this.queued];
        if (err.status === 401) {
          this.failure = 'auth';
          this.state = 'error';
          this.error = 'You were signed out. Your edits are kept here; sign in again in another tab, then press Retry.';
        } else if (err.status >= 500) {
          // A server error is not retried automatically; the edits stay here until Retry.
          this.failure = 'server';
          this.state = 'error';
          this.error = `${err.message} Your edits are kept on this page; press Retry.`;
        } else this.setOffline(err.message);
      } else {
        // The server refused the change (validation). Show why and drop it rather than retrying forever.
        this.state = this.queued.length ? 'pending' : 'error';
        this.error = `Not saved: ${err.message}`;
        this.stickyError = true;
        this.recordDropped(failed, 'error', `Not saved: ${err.message}`);
      }
    } finally {
      this.sending = false;
      this.emit();
    }
    if (this.server && this.remoteSeen > this.server.revision) {
      this.remoteSeen = 0;
      void this.refresh();
    }
    const state = this.state as SaveState;
    if (this.queued.length && state !== 'offline' && state !== 'error') this.schedule(250);
  }

  private setOffline(message: string) {
    this.state = 'offline';
    this.error = message;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.flush(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }

  retry() {
    this.retryDelay = 2000;
    this.failure = null;
    this.stickyError = false;
    if (this.state === 'error') this.state = 'pending';
    this.error = null;
    this.emit();
    void this.flush();
  }

  dismissError() {
    this.error = null;
    this.stickyError = false;
    this.dropped = this.dropped.filter((d) => d.source !== 'error');
    if (this.state === 'error') this.state = this.queued.length ? 'pending' : 'saved';
    this.emit();
  }

  dismissNotice() {
    this.notice = null;
    this.dropped = this.dropped.filter((d) => d.source !== 'notice');
    this.emit();
  }

  /** The user has seen every report of dropped or possibly-unsaved edits (e.g. in a sign-out dialog). */
  acknowledgeDropped() {
    this.dropped = [];
    this.emit();
  }

  /**
   * Records edits that were dropped. If any of them had been sent without a definite answer they
   * may already be saved, so they are reported as uncertain rather than as refused: an "ID already
   * in use" or "not found" on replay does not prove the earlier attempt succeeded.
   */
  private recordDropped(items: Pending[], source: Dropped['source'], message: string) {
    const uncertain = items.filter((p) => p.unconfirmed).length;
    if (uncertain) this.dropped.push({ outcome: 'uncertain', source, count: uncertain, message: `May or may not have been saved. ${message}` });
    if (items.length - uncertain) this.dropped.push({ outcome: 'rejected', source, count: items.length - uncertain, message });
  }

  /** Re-applies queued edits on a newer revision, separating real conflicts. */
  private rebase(latest: Episode) {
    // Merge field edits per target so each keeps the value it originally started from.
    const merged: Pending[] = [];
    for (const p of this.queued) {
      const prev = p.key ? merged.find((m) => m.key === p.key) : undefined;
      if (prev && isFieldOp(prev.op) && isFieldOp(p.op)) {
        for (const f of Object.keys(p.op.fields)) if (!(f in prev.base!)) prev.base![f] = p.base![f];
        Object.assign(prev.op.fields, p.op.fields);
        if (p.unconfirmed) prev.unconfirmed = true;
      } else merged.push(p);
    }
    const keep: Pending[] = [];
    const dropped: string[] = [];
    const droppedItems: Pending[] = [];
    let doc: EpisodeDoc = latest;
    for (const p of merged) {
      if (isFieldOp(p.op)) {
        const now = target(doc, p.op);
        if (!now) {
          dropped.push(fieldLabel(p.op, Object.keys(p.op.fields)[0], this.server ?? latest));
          droppedItems.push(p);
          continue;
        }
        const clash = Object.keys(p.op.fields).filter((f) => !same(now[f], p.base![f]) && !same(now[f], (p.op as FieldOp).fields[f as never]));
        if (clash.length) {
          this.conflicted.push(p);
          this.conflictInfo = {
            items: [
              ...(this.conflictInfo?.items ?? []),
              ...clash.map((f) => ({ label: fieldLabel(p.op as FieldOp, f, latest), mine: (p.op as FieldOp).fields[f as never], theirs: now[f] })),
            ],
          };
          continue;
        }
        for (const f of Object.keys(p.op.fields)) p.base![f] = now[f];
      }
      try {
        doc = applyOperations(doc, [p.op], this.ctx()).doc;
        keep.push(p);
      } catch (e) {
        dropped.push((e as Error).message);
        droppedItems.push(p);
      }
    }
    this.server = latest;
    this.queued = keep;
    if (dropped.length) {
      this.notice = `Some edits could not be applied to the newer version and were discarded: ${dropped.join('; ')}`;
      this.recordDropped(droppedItems, 'notice', this.notice);
    }
    this.state = keep.length ? 'pending' : this.conflicted.length ? 'pending' : 'saved';
    if (!this.stickyError) this.error = null;
    this.emit();
    if (keep.length) this.schedule(0);
  }

  /** Conflict choice: keep my version (save over the newer value) or use the newer saved value. */
  resolveConflict(choice: 'mine' | 'theirs') {
    const items = this.conflicted;
    this.conflicted = [];
    this.conflictInfo = null;
    if (choice === 'mine' && this.server) {
      for (const p of items) {
        const now = isFieldOp(p.op) ? target(this.server, p.op) ?? {} : {};
        for (const f of Object.keys(p.base ?? {})) p.base![f] = now[f];
        this.queued.push(p);
      }
      this.schedule(0);
    }
    this.state = this.queued.length ? 'pending' : 'saved';
    this.emit();
  }

  /**
   * Saves a batch immediately and waits for the server (used for drawings, uploads and
   * restores, where the result must be confirmed before the UI moves on). Throws ApiError.
   * `kept`: the caller still holds the change (an open editor), so a definite failure is not
   * recorded as lost. `nested`: called inside track(), which counts the save as running.
   */
  commitNow(operations: Operation[], summary?: string, opts: { kept?: boolean; nested?: boolean } = {}) {
    const label = summary ?? 'A change';
    return this.direct(label, { kept: opts.kept, writes: true, count: !opts.nested }, () => {
      clearTimeout(this.timer);
      return this.exclusive(async () => {
        if (saves.isFrozen) throw frozenError();
        await this.flushInner();
        // Writes may have been frozen while that flush was waiting for its answer.
        if (saves.isFrozen) throw frozenError();
        if (this.queued.length || this.conflicted.length) {
          throw new ApiError(409, 'Other edits are still waiting to be saved. Resolve them, then try again.', { code: 'pending_edits' });
        }
        try {
          const res = await api.changes(this.id, this.server!.revision, operations, summary);
          this.server = res.episode;
          this.state = this.queued.length ? 'pending' : 'saved';
          if (!this.stickyError) this.error = null;
          this.emit();
          return res;
        } catch (e) {
          const err = e as ApiError;
          if (err.status === 409) {
            try {
              this.rebase((await api.episode(this.id)).episode);
            } catch {
              /* keep current */
            }
          }
          throw err;
        }
      });
    });
  }

  /** Restores a revision (History), in turn with other saves. Throws ApiError. */
  restore(targetRevision: number, baseRevision: number, acknowledgeLaterRevisions = false) {
    return this.direct(`Restoring revision ${targetRevision}`, { writes: true }, () =>
      this.exclusive(async () => {
        if (saves.isFrozen) throw frozenError();
        const { episode } = await api.restore(this.id, targetRevision, baseRevision, acknowledgeLaterRevisions);
        this.adopt(episode);
        return episode;
      }),
    );
  }

  /**
   * Runs a save made outside the queue (e.g. upload then link) so the coordinator can wait for it
   * and knows if it fails. Pass `nested: true` to commitNow calls inside it. Refused while frozen.
   */
  track<T>(label: string, fn: () => Promise<T>, opts: { kept?: boolean } = {}): Promise<T> {
    return this.direct(label, { kept: opts.kept }, fn);
  }

  private async direct<T>(label: string, o: { kept?: boolean; writes?: boolean; count?: boolean }, fn: () => Promise<T>): Promise<T> {
    const run = (async () => {
      if (saves.isFrozen) throw frozenError();
      return fn();
    })();
    if (o.count !== false) this.active.add(run);
    try {
      return await run;
    } catch (e) {
      this.recordFailure(e, label, o);
      throw e;
    } finally {
      this.active.delete(run);
      this.releaseIfDone();
    }
  }

  /**
   * A direct save failed. If it may have reached the server it is uncertain; otherwise it was not
   * saved, which matters unless the caller still holds the change (an open editor keeps it).
   */
  private recordFailure(e: unknown, label: string, o: { kept?: boolean; writes?: boolean }) {
    if (e && typeof e === 'object') {
      if (this.handled.has(e)) return;
      this.handled.add(e);
    }
    const message = e instanceof Error ? e.message : String(e);
    if (o.writes && ambiguous(e)) {
      this.dropped.push({ outcome: 'uncertain', source: 'direct', count: 1, message: `${label}: no answer from the server, so it may or may not have been saved.` });
    } else if (!o.kept) {
      this.dropped.push({ outcome: 'rejected', source: 'direct', count: 1, message: `${label} was not saved: ${message}` });
    } else return;
    this.emit();
  }

  /** Replace the confirmed state after a restore or other direct server call. */
  adopt(episode: Episode) {
    if (this.queued.length || this.conflicted.length) {
      // Edits made meanwhile are replayed on the new version (or shown as conflicts), never discarded silently.
      this.queued = [...this.conflicted, ...this.queued];
      this.conflicted = [];
      this.conflictInfo = null;
      this.rebase(episode);
      return;
    }
    this.server = episode;
    this.state = 'saved';
    this.emit();
  }

  // --- Save coordinator ----------------------------------------------------------------

  /** Outstanding work for the coordinator's report. */
  issues(): SaveIssue[] {
    const out: SaveIssue[] = [];
    const add = (outcome: SaveIssue['outcome'], kind: SaveIssueKind, count: number, message: string) => {
      if (count) out.push({ outcome, kind, episodeId: this.id, count, message });
    };
    add('uncertain', 'inflight', this.inflight.length, 'Edits were sent; no answer from the server yet.');
    add('uncertain', 'direct', this.active.size, 'A drawing, image, link or restore is still being saved.');
    const held: QueuedKind = this.failure ?? (saves.isFrozen ? 'held' : this.state === 'offline' ? 'offline' : 'queued');
    add('blocked', held, this.queued.length, queuedMessages[held]);
    add('blocked', 'conflict', this.conflicted.length, 'Edits need a Keep mine / Use newer choice.');
    for (const d of this.dropped) add(d.outcome, d.outcome, d.count, d.message);
    return out;
  }

  /**
   * Sends what can be sent (nothing while frozen) and waits for answers until nothing is moving or
   * the deadline passes.
   * Saves held for Retry (signed out, server error) and conflicts are left for the user; offline
   * edits get one more attempt. Requests still running at the deadline are not cancelled.
   */
  async settle(deadline: number) {
    const until = <T>(p: Promise<T>) => {
      let t: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((r) => (t = setTimeout(r, Math.max(0, deadline - Date.now()))));
      return Promise.race([p, timeout]).finally(() => clearTimeout(t));
    };
    let triedOffline = false;
    while (Date.now() < deadline) {
      // While frozen nothing new is sent, but requests already sent are still waited for.
      const sendable = !saves.isFrozen && this.server && this.queued.length && this.state !== 'error' && !(this.state === 'offline' && triedOffline);
      if (sendable) {
        await until(this.flush());
        if (this.state === 'offline') triedOffline = true;
      } else if (this.sending || this.active.size) {
        await until(Promise.allSettled([this.lock, ...this.active]));
      } else return;
    }
  }

  /** Writes were thawed: send what was held. */
  resume() {
    if (this.queued.length && this.state !== 'error') this.schedule(0);
  }

  get confirmed() {
    return this.server;
  }
}

export function useEpisodeSync(id: string) {
  const engine = useMemo(() => new EpisodeSync(id), [id]);
  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  return { ...snap, engine };
}
