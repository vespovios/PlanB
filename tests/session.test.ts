// Session recovery: a lost session pauses the page; only the same account resumes it.
import { describe, expect, it, vi } from 'vitest';
import { ApiError, sessionUserId, setSessionUser, type User } from '../src/client/api.js';
import { SaveCoordinator, type SaveParticipant } from '../src/client/saves.js';
import { SessionRecovery } from '../src/client/session.js';

const alice: User = { id: 'us_alice', email: 'alice@example.com', name: 'Alice' };
const bob: User = { id: 'us_bob', email: 'bob@example.com', name: 'Bob' };

function participant() {
  return {
    settle: vi.fn(async () => undefined),
    issues: () => [{ outcome: 'blocked' as const, kind: 'auth' as const, count: 1, message: 'Edits are kept on this page.' }],
    resume: vi.fn(),
    acknowledgeDropped: vi.fn(),
    discard: vi.fn(),
    retryHeld: vi.fn(),
    isBusy: () => false,
    suspend: vi.fn(),
    retryAfterReauth: vi.fn(),
  } satisfies SaveParticipant;
}

function setup(login: (email: string, password: string) => Promise<{ user: User }>) {
  const c = new SaveCoordinator();
  const p = participant();
  c.register(p);
  const onDiscarded = vi.fn();
  const r = new SessionRecovery({ login: vi.fn(login), onDiscarded, coordinator: c });
  setSessionUser(alice.id);
  return { c, p, r, onDiscarded };
}

describe('session recovery', () => {
  it('pauses on loss (once), and resumes only after the same account signs in', async () => {
    const { c, p, r } = setup(async (email, password) => {
      if (password !== 'right') throw new ApiError(401, 'E-mail or password is incorrect.');
      return { user: email === alice.email ? alice : bob };
    });
    r.lost(alice);
    r.lost(alice);
    expect(p.suspend).toHaveBeenCalledOnce();
    expect(c.isSuspended).toBe(true);
    expect(await r.signIn('wrong')).toBe('E-mail or password is incorrect.');
    expect(r.getSnapshot().step).toBe('lost');
    expect(c.isSuspended).toBe(true);
    expect(p.retryAfterReauth).not.toHaveBeenCalled();
    expect(await r.signIn('right')).toBeNull();
    expect(r.getSnapshot()).toEqual({ step: 'active' });
    expect(c.isFrozen).toBe(false);
    expect(p.retryAfterReauth).toHaveBeenCalledOnce();
    expect(p.resume).toHaveBeenCalledOnce();
    expect(sessionUserId()).toBe(alice.id);
  });

  it('never resumes for a different account', async () => {
    const { c, p, r } = setup(async () => ({ user: bob }));
    r.lost(alice, true);
    expect(r.getSnapshot()).toMatchObject({ step: 'lost', switched: true });
    expect(await r.signIn('right')).toMatch(/not alice@example.com/);
    expect(r.getSnapshot().step).toBe('lost');
    expect(c.isSuspended).toBe(true);
    expect(p.retryAfterReauth).not.toHaveBeenCalled();
    expect(p.resume).not.toHaveBeenCalled();
    // Requests still name Alice, so the server refuses them for Bob's session.
    expect(sessionUserId()).toBe(alice.id);
  });

  it('signs in with the original e-mail only', async () => {
    const login = vi.fn(async () => ({ user: alice }));
    const { r } = setup(login);
    r.lost(alice);
    await r.signIn('right');
    expect(login).toHaveBeenCalledWith('alice@example.com', 'right');
  });

  it('leaving discards this page’s work only after confirming, and forgets the account', async () => {
    const { c, p, r, onDiscarded } = setup(async () => ({ user: alice }));
    c.addDraft('The drawing', { retained: true, discard: () => false });
    r.lost(alice);
    r.askDiscard();
    expect(r.getSnapshot()).toMatchObject({ step: 'confirm-discard', report: { outcome: 'blocked' } });
    r.back();
    expect(p.discard).not.toHaveBeenCalled();
    r.askDiscard();
    r.confirmDiscard();
    expect(p.discard).toHaveBeenCalledOnce();
    expect(onDiscarded).toHaveBeenCalledWith(['The drawing']);
    expect(c.isFrozen).toBe(false);
    expect(sessionUserId()).toBeNull();
  });
});
