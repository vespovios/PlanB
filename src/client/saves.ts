// Save coordinator: one place that knows about every piece of work that is not yet confirmed
// by the server, so sign-out, session expiry and navigation can wait for it, hold it, or tell
// the user exactly what is still at risk. It never saves or discards anything by itself.
import { useEffect } from 'react';

/**
 * confirmed: nothing outstanding. blocked: work is kept on this page but cannot be saved without
 * the user (conflict, refusal by the server, offline, signed out, open drawing). rejected: the
 * server refused edits and they were dropped. uncertain: a request was sent but no answer came
 * back, so it may or may not have been saved; a timeout never proves the server did not apply it.
 */
export type SaveOutcome = 'confirmed' | 'blocked' | 'rejected' | 'uncertain';

export type SaveIssueKind =
  | 'queued' // waiting to be sent when the wait ran out
  | 'held' // kept while writes are frozen
  | 'offline'
  | 'auth' // signed out; kept for Retry after signing in again
  | 'server' // server error; kept for Retry
  | 'conflict' // needs a Keep mine / Use newer choice
  | 'draft' // an editor holds unsaved input (never saved automatically)
  | 'inflight' // sent, no answer yet
  | 'direct' // a drawing, upload, link or restore still running
  | 'rejected'
  | 'uncertain';

export interface SaveIssue {
  outcome: Exclude<SaveOutcome, 'confirmed'>;
  kind: SaveIssueKind;
  /** Episode the work belongs to (absent for drafts registered without one). */
  episodeId?: string;
  count: number;
  message: string;
}

export interface SaveReport {
  /** The most serious outcome: blocked, then uncertain, then rejected. */
  outcome: SaveOutcome;
  issues: SaveIssue[];
}

/** What the coordinator needs from a save engine (EpisodeSync). */
export interface SaveParticipant {
  /** Sends what can be sent and waits until nothing more is moving, or until the deadline (ms since epoch). */
  settle(deadline: number): Promise<void>;
  issues(): SaveIssue[];
  /** Called when writes are thawed so held edits are sent. */
  resume(): void;
}

const rank: Record<SaveOutcome, number> = { confirmed: 0, rejected: 1, uncertain: 2, blocked: 3 };

export function summarise(issues: SaveIssue[]): SaveReport {
  let outcome: SaveOutcome = 'confirmed';
  for (const i of issues) if (rank[i.outcome] > rank[outcome]) outcome = i.outcome;
  return { outcome, issues };
}

export const DEFAULT_SETTLE_MS = 10_000;

export class SaveCoordinator {
  private participants = new Set<SaveParticipant>();
  private drafts = new Map<symbol, { label: string; episodeId?: string; retained: boolean }>();
  private frozen = false;

  /** Engines register while mounted and stay registered after unmount until their work is resolved. */
  register(p: SaveParticipant) {
    this.participants.add(p);
  }
  unregister(p: SaveParticipant) {
    this.participants.delete(p);
  }
  isRegistered(p: SaveParticipant) {
    return this.participants.has(p);
  }

  /**
   * Records that an editor holds input that is not saved (e.g. an open drawing). Returns the
   * release function. `retained` means a copy is also kept in this browser (localStorage).
   */
  addDraft(label: string, opts: { episodeId?: string; retained?: boolean } = {}): () => void {
    const key = Symbol(label);
    this.drafts.set(key, { label, episodeId: opts.episodeId, retained: !!opts.retained });
    return () => this.drafts.delete(key);
  }

  get isFrozen() {
    return this.frozen;
  }

  /**
   * Stops new writes from being sent: edits are still accepted and kept locally, direct saves are
   * refused, and requests already sent are left to finish. Nothing is discarded.
   */
  freeze() {
    this.frozen = true;
  }

  thaw() {
    if (!this.frozen) return;
    this.frozen = false;
    this.participants.forEach((p) => p.resume());
  }

  /** The current state of all outstanding work, without sending anything. */
  report(): SaveReport {
    const issues: SaveIssue[] = [];
    this.participants.forEach((p) => issues.push(...p.issues()));
    this.drafts.forEach((d) =>
      issues.push({
        outcome: 'blocked',
        kind: 'draft',
        episodeId: d.episodeId,
        count: 1,
        message: `${d.label} is not saved${d.retained ? ' (a copy is kept in this browser)' : ''}.`,
      }),
    );
    return summarise(issues);
  }

  /**
   * Save barrier: sends everything that can be sent and waits (at most timeoutMs) for answers,
   * then reports. It does not retry refused or signed-out saves, resolve conflicts, or save drafts.
   */
  async settle(timeoutMs = DEFAULT_SETTLE_MS): Promise<SaveReport> {
    const deadline = Date.now() + timeoutMs;
    await Promise.all([...this.participants].map((p) => p.settle(deadline).catch(() => undefined)));
    return this.report();
  }
}

export const saves = new SaveCoordinator();

/** Registers an editor's unsaved input with the coordinator while `active` is true. */
export function useUnsavedDraft(label: string, active: boolean, opts: { episodeId?: string; retained?: boolean } = {}) {
  useEffect(() => {
    if (!active) return;
    return saves.addDraft(label, opts);
  }, [label, active, opts.episodeId, opts.retained]);
}
