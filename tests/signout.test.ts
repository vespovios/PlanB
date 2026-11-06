// Sign-out flow: save first, decide explicitly, and only report "signed out" when the server confirmed it.
import { describe, expect, it, vi } from 'vitest';
import { SaveCoordinator, type SaveIssue, type SaveParticipant } from '../src/client/saves.js';
import { SignOutFlow } from '../src/client/signout.js';

const issue = (kind: SaveIssue['kind'] = 'offline'): SaveIssue => ({ outcome: 'blocked', kind, count: 1, message: 'Edits are kept on this page.' });

function participant(issues: SaveIssue[] = []) {
  const p = {
    list: issues,
    settle: vi.fn(async () => undefined),
    issues: () => p.list,
    resume: vi.fn(),
    acknowledgeDropped: vi.fn(),
    discard: vi.fn(() => void (p.list = [])),
    retryHeld: vi.fn(),
    isBusy: () => false,
    suspend: () => undefined,
    retryAfterReauth: () => undefined,
  };
  return p satisfies SaveParticipant;
}

const deferred = <T = unknown>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

function setup(logout: () => Promise<unknown> = async () => ({ ok: true }), opts: { logoutTimeoutMs?: number } = {}) {
  const c = new SaveCoordinator();
  const onSignedOut = vi.fn();
  const logoutFn = vi.fn(logout);
  const flow = new SignOutFlow({ logout: logoutFn, onSignedOut, coordinator: c, settleMs: 50, ...opts });
  return { c, flow, onSignedOut, logout: logoutFn };
}

describe('sign-out flow', () => {
  it('signs out once everything is confirmed, and only after the server answered', async () => {
    const { c, flow, onSignedOut, logout } = setup();
    c.register(participant());
    await flow.start();
    expect(logout).toHaveBeenCalledOnce();
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(flow.getSnapshot()).toEqual({ step: 'idle' });
    expect(c.isFrozen).toBe(false);
  });

  it('ignores repeated clicks while signing out', async () => {
    const answer = deferred();
    const { c, flow, onSignedOut, logout } = setup(() => answer.promise);
    c.register(participant());
    const first = flow.start();
    void flow.start();
    await vi.waitFor(() => expect(flow.getSnapshot().step).toBe('signing-out'));
    void flow.start();
    answer.resolve({ ok: true });
    await first;
    expect(logout).toHaveBeenCalledOnce();
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it('does not sign out while anything is unsaved, and Stay leaves it all in place', async () => {
    const { c, flow, logout } = setup();
    const p = participant([issue('offline')]);
    c.register(p);
    await flow.start();
    expect(flow.getSnapshot()).toMatchObject({ step: 'blocked', report: { outcome: 'blocked' } });
    expect(logout).not.toHaveBeenCalled();
    expect(c.isFrozen).toBe(false);
    flow.stay();
    expect(flow.getSnapshot()).toEqual({ step: 'idle' });
    expect(p.discard).not.toHaveBeenCalled();
  });

  it('re-checks after freezing: an edit that arrives once saving finished still blocks', async () => {
    const { c, flow, logout } = setup();
    const p = participant();
    p.settle.mockImplementation(async () => {
      p.list = [issue('held')];
    });
    c.register(p);
    await flow.start();
    expect(flow.getSnapshot().step).toBe('blocked');
    expect(logout).not.toHaveBeenCalled();
  });

  it('treats rejected and uncertain reports as needing a decision, without acknowledging them', async () => {
    const { c, flow, logout } = setup();
    const p = participant([{ outcome: 'rejected', kind: 'rejected', count: 1, message: 'Not saved' }]);
    c.register(p);
    await flow.start();
    expect(flow.getSnapshot().step).toBe('blocked');
    expect(p.acknowledgeDropped).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('Retry resends held saves and signs out once they are saved', async () => {
    const { c, flow, onSignedOut } = setup();
    const p = participant([issue('server')]);
    p.retryHeld.mockImplementation(() => void (p.list = []));
    c.register(p);
    await flow.start();
    await flow.retry();
    expect(p.retryHeld).toHaveBeenCalledOnce();
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it('discards only after the server confirmed the sign-out', async () => {
    const answer = deferred();
    const { c, flow, onSignedOut } = setup(() => answer.promise);
    const p = participant([issue('conflict')]);
    const draft = vi.fn();
    c.register(p);
    c.addDraft('The drawing', { retained: true, discard: draft });
    await flow.start();
    flow.askDiscard();
    expect(c.isFrozen).toBe(true);
    expect(flow.getSnapshot()).toMatchObject({ step: 'confirm' });
    const done = flow.confirmDiscard();
    await vi.waitFor(() => expect(flow.getSnapshot().step).toBe('signing-out'));
    expect(p.discard).not.toHaveBeenCalled();
    answer.resolve({ ok: true });
    await done;
    expect(p.discard).toHaveBeenCalledOnce();
    expect(draft).toHaveBeenCalledOnce();
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(c.report().outcome).toBe('confirmed');
  });

  it('a local copy that could not be deleted is reported after the confirmed sign-out, not as a failed sign-out', async () => {
    const { c, flow, onSignedOut, logout } = setup();
    c.register(participant([issue('conflict')]));
    c.addDraft('The drawing for "Opening"', { retained: true, discard: () => false });
    c.addDraft('A link being added', {
      discard: () => {
        throw new Error('storage denied');
      },
    });
    c.addDraft('A new shot typed', { discard: () => undefined });
    await flow.start();
    flow.askDiscard();
    await flow.confirmDiscard();
    expect(logout).toHaveBeenCalledOnce();
    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(flow.getSnapshot()).toEqual({ step: 'signed-out', notDeleted: ['The drawing for "Opening"', 'A link being added'] });
    expect(c.isFrozen).toBe(false);
    flow.stay();
    expect(flow.getSnapshot()).toEqual({ step: 'idle' });
  });

  it('Back from the confirmation thaws and keeps everything', async () => {
    const { c, flow } = setup();
    const p = participant([issue('offline')]);
    c.register(p);
    await flow.start();
    flow.askDiscard();
    flow.back();
    expect(flow.getSnapshot().step).toBe('blocked');
    expect(c.isFrozen).toBe(false);
    expect(p.discard).not.toHaveBeenCalled();
  });

  it('a failed or unanswered sign-out is "unconfirmed": nothing discarded, writes stay frozen, Try again resends', async () => {
    let fail = true;
    const { c, flow, onSignedOut, logout } = setup(async () => {
      if (fail) throw new Error('Cannot reach the PlanB server.');
      return { ok: true };
    });
    const p = participant([issue('offline')]);
    const draft = vi.fn();
    c.register(p);
    c.addDraft('The drawing', { discard: draft });
    await flow.start();
    flow.askDiscard();
    await flow.confirmDiscard();
    expect(flow.getSnapshot()).toMatchObject({ step: 'unconfirmed', discard: true, message: 'Cannot reach the PlanB server.' });
    expect(c.isFrozen).toBe(true);
    expect(p.discard).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
    expect(onSignedOut).not.toHaveBeenCalled();
    fail = false;
    await flow.tryAgain();
    expect(logout).toHaveBeenCalledTimes(2);
    expect(p.discard).toHaveBeenCalledOnce();
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it('Stay after an unconfirmed sign-out keeps the work and thaws', async () => {
    const { c, flow, onSignedOut } = setup(async () => {
      throw new Error('Request failed (503)');
    });
    c.register(participant());
    await flow.start();
    expect(flow.getSnapshot().step).toBe('unconfirmed');
    flow.stay();
    expect(c.isFrozen).toBe(false);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('a sign-out request that never answers ends as unconfirmed, and its late answer is ignored', async () => {
    const answer = deferred();
    const { c, flow, onSignedOut } = setup(() => answer.promise, { logoutTimeoutMs: 50 });
    c.register(participant());
    await flow.start();
    expect(flow.getSnapshot()).toMatchObject({ step: 'unconfirmed', message: expect.stringMatching(/did not answer/) });
    flow.stay();
    answer.resolve({ ok: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('reset abandons a run: a late answer does not sign out or discard', async () => {
    const answer = deferred();
    const { c, flow, onSignedOut } = setup(() => answer.promise);
    const p = participant([issue('offline')]);
    c.register(p);
    await flow.start();
    flow.askDiscard();
    const done = flow.confirmDiscard();
    flow.reset();
    answer.resolve({ ok: true });
    await done;
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(p.discard).not.toHaveBeenCalled();
    expect(c.isFrozen).toBe(false);
  });
});
