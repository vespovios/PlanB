// Navigation guard: clean moves are instant; otherwise save first, then Stay / Retry / explicit discard.
import { describe, expect, it, vi } from 'vitest';
import { navScope, NavigationGuard } from '../src/client/navigation.js';
import { parseRoute } from '../src/client/router.js';
import { SaveCoordinator, type SaveIssue, type SaveParticipant } from '../src/client/saves.js';

const issue = (kind: SaveIssue['kind']): SaveIssue => ({ outcome: 'blocked', kind, count: 1, message: kind });
function participant(list: SaveIssue[] = []) {
  const p = {
    list,
    settle: vi.fn(async () => undefined),
    issues: () => p.list,
    resume: vi.fn(),
    acknowledgeDropped: vi.fn(),
    discard: vi.fn(() => void (p.list = [])),
    retryHeld: vi.fn(),
    isBusy: () => false,
    suspend: vi.fn(),
    retryAfterReauth: vi.fn(),
  };
  return p satisfies SaveParticipant;
}
function setup(list: SaveIssue[] = []) {
  const c = new SaveCoordinator();
  const p = participant(list);
  c.register(p);
  const g = new NavigationGuard({ coordinator: c, settleMs: 50 });
  return { c, p, g, proceed: vi.fn(), cancel: vi.fn() };
}

describe('navigation scope', () => {
  it('tabs of the same episode only risk editor drafts; anything else ends the page', () => {
    expect(navScope(parseRoute('#/e/ep_a/plan'), parseRoute('#/e/ep_a/shots'))).toBe('drafts');
    expect(navScope(parseRoute('#/e/ep_a/plan'), parseRoute('#/e/ep_b/plan'))).toBe('page');
    expect(navScope(parseRoute('#/e/ep_a/plan'), parseRoute('#/e/ep_a/checklist'))).toBe('page');
    expect(navScope(parseRoute('#/e/ep_a'), parseRoute('#/'))).toBe('page');
  });
});

describe('navigation guard', () => {
  it('is clean when nothing is outstanding; a tab change ignores engine edits (the engine stays)', () => {
    const { g } = setup([issue('queued')]);
    expect(g.isClean('page')).toBe(false);
    expect(g.isClean('drafts')).toBe(true);
  });

  it('saves first and moves without asking once everything is confirmed', async () => {
    const { p, g, proceed, cancel } = setup([issue('queued')]);
    p.settle.mockImplementation(async () => void (p.list = []));
    await g.decide('page', proceed, cancel);
    expect(proceed).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(g.getSnapshot()).toEqual({ step: 'idle' });
  });

  it('blocks when something stays unsaved; Stay cancels and keeps it', async () => {
    const { c, p, g, proceed, cancel } = setup([issue('offline')]);
    await g.decide('page', proceed, cancel);
    expect(g.getSnapshot()).toMatchObject({ step: 'blocked', scope: 'page' });
    expect(c.isFrozen).toBe(false);
    g.stay();
    expect(cancel).toHaveBeenCalledOnce();
    expect(proceed).not.toHaveBeenCalled();
    expect(p.discard).not.toHaveBeenCalled();
  });

  it('Retry resends held saves and moves once they are confirmed', async () => {
    const { p, g, proceed, cancel } = setup([issue('server')]);
    p.retryHeld.mockImplementation(() => void (p.list = []));
    await g.decide('page', proceed, cancel);
    await g.retry();
    expect(proceed).toHaveBeenCalledOnce();
  });

  it('Leave without saving: freezes while confirming, discards, then moves; Back keeps everything', async () => {
    const { c, p, g, proceed, cancel } = setup([issue('conflict')]);
    await g.decide('page', proceed, cancel);
    g.askDiscard();
    expect(c.isFrozen).toBe(true);
    g.back();
    expect(c.isFrozen).toBe(false);
    expect(p.discard).not.toHaveBeenCalled();
    g.askDiscard();
    g.confirmDiscard();
    expect(p.discard).toHaveBeenCalledOnce();
    expect(proceed).toHaveBeenCalledOnce();
    expect(c.isFrozen).toBe(false);
  });

  it('a tab change with typed input discards only that input, not the engine', async () => {
    const { c, p, g, proceed, cancel } = setup([issue('queued')]);
    const draft = vi.fn();
    c.addDraft('A new shot typed', { discard: draft });
    await g.decide('drafts', proceed, cancel);
    expect(g.getSnapshot()).toMatchObject({ step: 'blocked', scope: 'drafts', report: { issues: [{ kind: 'draft' }] } });
    expect(p.settle).not.toHaveBeenCalled();
    g.askDiscard();
    g.confirmDiscard();
    expect(draft).toHaveBeenCalledOnce();
    expect(p.discard).not.toHaveBeenCalled();
    expect(proceed).toHaveBeenCalledOnce();
  });

  it('a second move while one is being decided is refused; reset abandons the first', async () => {
    const { g, proceed, cancel } = setup([issue('offline')]);
    await g.decide('page', proceed, cancel);
    const other = vi.fn();
    const otherCancel = vi.fn();
    await g.decide('page', other, otherCancel);
    expect(otherCancel).toHaveBeenCalledOnce();
    g.reset();
    expect(cancel).toHaveBeenCalledOnce();
    expect(proceed).not.toHaveBeenCalled();
    expect(g.getSnapshot()).toEqual({ step: 'idle' });
  });

  it('a pause for a lost session is not lifted by the guard', async () => {
    const { c, g, proceed, cancel } = setup([issue('offline')]);
    c.suspendForAuth();
    await g.decide('page', proceed, cancel);
    g.stay();
    expect(c.isSuspended).toBe(true);
  });
});
