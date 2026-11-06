// Save coordinator and EpisodeSync outcomes: what is confirmed, blocked, rejected or uncertain.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EpisodeDocSchema, type Episode } from '../src/shared/model.js';
import type { Operation } from '../src/shared/ops.js';

// The engine listens on window/document; node has neither.
beforeAll(() => {
  Object.assign(globalThis, { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: 'visible' }) });
});

const server = vi.hoisted(() => ({
  changes: undefined as unknown as (id: string, base: number, ops: Operation[], summary?: string) => Promise<unknown>,
  episode: undefined as unknown as (id: string) => Promise<unknown>,
  restore: undefined as unknown as (...args: unknown[]) => Promise<unknown>,
}));
vi.mock('../src/client/api', async (orig) => {
  const real = await orig<typeof import('../src/client/api')>();
  return {
    ...real,
    api: {
      episode: (id: string) => server.episode(id),
      changes: (id: string, base: number, ops: Operation[], summary?: string) => server.changes(id, base, ops, summary),
      restore: (...args: unknown[]) => server.restore(...args),
    },
  };
});

const { ApiError } = await import('../src/client/api.js');
const { EpisodeSync } = await import('../src/client/sync.js');
const { saves, storeLocalCopy } = await import('../src/client/saves.js');
const { applyOperations } = await import('../src/shared/ops.js');

const ID = 'ep_test';
let current: Episode;
const make = (title: string, revision: number, extra: object = {}): Episode => ({
  ...EpisodeDocSchema.parse({ title, scenes: [{ id: 'sc_existing', title: 'Opening', durationSeconds: 30 }], ...extra }),
  id: ID,
  revision,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
/** A server that applies batches against the current revision, like the real one. */
const apply = async (_id: string, base: number, ops: Operation[]) => {
  if (base !== current.revision) throw new ApiError(409, 'stale', { code: 'stale_revision' });
  const { doc } = applyOperations(current, ops, { newId: (p) => `${p}_generated`, nextRevision: current.revision + 1, resolveAsset: () => null, findDeletedScene: () => null });
  current = { ...current, ...doc, revision: current.revision + 1 };
  return { episode: current, created: {} };
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

let engines: InstanceType<typeof EpisodeSync>[] = [];
async function started() {
  const e = new EpisodeSync(ID);
  engines.push(e);
  e.start();
  await vi.waitFor(() => expect(e.confirmed).not.toBeNull());
  return e;
}
const title = (t: string): Operation => ({ op: 'updateEpisode', fields: { title: t } });
const kinds = () => saves.report().issues.map((i) => `${i.outcome}:${i.kind}:${i.count}`);

beforeEach(() => {
  current = make('Start', 1);
  server.episode = async () => ({ episode: current });
  server.changes = apply;
  server.restore = async () => {
    throw new Error('unused');
  };
});
afterEach(() => {
  saves.thaw();
  // Discard rather than stop: a stopped engine with unsaved work keeps retrying (by design).
  for (const e of engines) e.discard();
  engines = [];
});

describe('save barrier', () => {
  it('confirms once queued edits are saved', async () => {
    const e = await started();
    e.queue(title('A'), 10_000);
    expect(saves.report().outcome).toBe('blocked');
    const report = await saves.settle(2000);
    expect(report).toEqual({ outcome: 'confirmed', issues: [] });
    expect(current.title).toBe('A');
  });

  it('also sends edits queued behind a request in flight', async () => {
    const e = await started();
    const gate = deferred<void>();
    const sent: string[] = [];
    server.changes = async (id, base, ops) => {
      sent.push((ops[0] as { fields: { title: string } }).fields.title);
      if (sent.length === 1) await gate.promise;
      return apply(id, base, ops);
    };
    e.queue(title('first'));
    await vi.waitFor(() => expect(sent).toEqual(['first']));
    e.queue({ op: 'updateEpisode', fields: { brief: 'second' } }, 10_000);
    const settling = saves.settle(2000);
    gate.resolve();
    expect((await settling).outcome).toBe('confirmed');
    expect(sent).toHaveLength(2);
    expect([current.title, current.brief]).toEqual(['first', 'second']);
  });

  it('reports a request still in flight at the deadline as uncertain, without cancelling it', async () => {
    const e = await started();
    const gate = deferred<void>();
    server.changes = async (id, base, ops) => {
      await gate.promise;
      return apply(id, base, ops);
    };
    e.queue(title('slow'));
    const started_ = Date.now();
    const report = await saves.settle(150);
    expect(Date.now() - started_).toBeLessThan(1000);
    expect(report.outcome).toBe('uncertain');
    expect(kinds()).toEqual(['uncertain:inflight:1']);
    gate.resolve();
    await vi.waitFor(() => expect(saves.report().outcome).toBe('confirmed'));
    expect(current.title).toBe('slow');
  });

  it('keeps edits that cannot be sent offline, and marks them as possibly applied', async () => {
    const e = await started();
    server.changes = async () => {
      throw new ApiError(0, 'Cannot reach the PlanB server.');
    };
    e.queue(title('offline'));
    const report = await saves.settle(1000);
    expect(report.outcome).toBe('blocked');
    expect(kinds()).toEqual(['blocked:offline:1']);
    expect(e.getSnapshot().episode?.title).toBe('offline');
  });

  it('does not resend signed-out or server-error saves, and says why they are held', async () => {
    const e = await started();
    let calls = 0;
    server.changes = async () => {
      calls++;
      throw new ApiError(401, 'Sign in');
    };
    e.queue(title('mine'));
    await vi.waitFor(() => expect(e.getSnapshot().state).toBe('error'));
    expect((await saves.settle(500)).issues.map((i) => i.kind)).toEqual(['auth']);
    expect(calls).toBe(1);

    server.changes = async () => {
      throw new ApiError(500, 'Boom');
    };
    e.retry();
    await vi.waitFor(() => expect(kinds()).toEqual(['blocked:server:1']));
  });

  it('reports edits refused by the server as rejected even though nothing is unsaved', async () => {
    const e = await started();
    server.changes = async () => {
      throw new ApiError(400, 'Too long');
    };
    e.queue(title('bad'));
    const report = await saves.settle(1000);
    expect(e.hasUnsaved).toBe(false);
    expect(report.outcome).toBe('rejected');
    expect(kinds()).toEqual(['rejected:rejected:1']);
    e.dismissError();
    expect(saves.report().outcome).toBe('confirmed');
  });

  it('never counts a replayed add that now collides as saved: it is uncertain', async () => {
    const e = await started();
    // The first attempt is applied on the server, but the answer is lost.
    server.changes = async (id, base, ops) => {
      await apply(id, base, ops);
      throw new ApiError(0, 'Connection lost');
    };
    e.queue({ op: 'addScene', id: 'sc_newscene1', index: 1, scene: { title: 'New', durationSeconds: 10 } } as Operation);
    await vi.waitFor(() => expect(e.getSnapshot().state).toBe('offline'));
    server.changes = apply;
    await saves.settle(2000);
    expect(current.scenes.filter((s) => s.id === 'sc_newscene1')).toHaveLength(1);
    expect(kinds()).toEqual(['uncertain:uncertain:1']);
    expect(e.getSnapshot().notice).toMatch(/discarded/);
    e.dismissNotice();
    expect(saves.report().outcome).toBe('confirmed');
  });

  it('leaves conflicts to the user', async () => {
    const e = await started();
    e.queue(title('mine'), 10_000);
    current = { ...current, title: 'theirs', revision: 2 };
    await e.refresh();
    expect((await saves.settle(500)).issues.map((i) => i.kind)).toEqual(['conflict']);
  });
});

describe('freezing writes', () => {
  it('holds new edits locally, refuses direct saves, and sends held edits on thaw', async () => {
    const e = await started();
    saves.freeze();
    let calls = 0;
    server.changes = async (id, base, ops) => {
      calls++;
      return apply(id, base, ops);
    };
    e.queue(title('held'));
    await saves.settle(200);
    await tick();
    expect(calls).toBe(0);
    expect(kinds()).toEqual(['blocked:held:1']);
    await expect(e.commitNow([title('direct')])).rejects.toMatchObject({ status: 423, body: { code: 'writes_frozen' } });
    saves.thaw();
    await vi.waitFor(() => expect(current.title).toBe('held'));
    // The refused direct save is reported as not saved until acknowledged.
    expect(kinds()).toEqual(['rejected:rejected:1']);
    saves.acknowledge();
    expect(saves.report().outcome).toBe('confirmed');
  });
});

describe('ownership after unmount', () => {
  it('keeps a stopped engine registered until its work is resolved', async () => {
    const e = await started();
    const gate = deferred<void>();
    server.changes = async (id, base, ops) => {
      await gate.promise;
      return apply(id, base, ops);
    };
    e.queue(title('late'));
    await vi.waitFor(() => expect(e.getSnapshot().state).toBe('saving'));
    e.stop();
    expect(saves.isRegistered(e)).toBe(true);
    gate.resolve();
    await vi.waitFor(() => expect(saves.isRegistered(e)).toBe(false));
    expect(current.title).toBe('late');
  });

  it('releases an idle engine as soon as it stops', async () => {
    const e = await started();
    e.stop();
    expect(saves.isRegistered(e)).toBe(false);
  });
});

describe('freezing at dispatch time', () => {
  it('a flush requested before the freeze sends nothing after it', async () => {
    const e = await started();
    let calls = 0;
    server.changes = async (id, base, ops) => {
      calls++;
      return apply(id, base, ops);
    };
    e.queue(title('x'), 10_000);
    const p = e.flush();
    saves.freeze();
    await p;
    await tick();
    expect(calls).toBe(0);
    expect(kinds()).toEqual(['blocked:held:1']);
  });

  it('direct saves and restores waiting behind a request are not sent after the freeze', async () => {
    const e = await started();
    const gate = deferred<void>();
    let changes = 0;
    let restores = 0;
    server.changes = async (id, base, ops) => {
      changes++;
      await gate.promise;
      return apply(id, base, ops);
    };
    server.restore = async () => {
      restores++;
      return { episode: current };
    };
    e.queue(title('first'));
    await vi.waitFor(() => expect(changes).toBe(1));
    const direct = e.commitNow([{ op: 'updateEpisode', fields: { brief: 'direct' } }], 'Direct save');
    const restoring = e.restore(1, 1);
    saves.freeze();
    gate.resolve();
    await expect(direct).rejects.toMatchObject({ status: 423, body: { code: 'writes_frozen' } });
    await expect(restoring).rejects.toMatchObject({ status: 423 });
    expect([changes, restores]).toEqual([1, 0]);
    expect(current.title).toBe('first');
    expect(current.brief).not.toBe('direct');
    // Neither is reported as saved.
    expect(kinds()).toEqual(['rejected:rejected:1', 'rejected:rejected:1']);
  });

  it('a direct save is not sent if writes freeze while its own preceding flush is in flight', async () => {
    const e = await started();
    const gate = deferred<void>();
    const sent: Operation[][] = [];
    server.changes = async (id, base, ops) => {
      sent.push(ops);
      if (sent.length === 1) await gate.promise;
      return apply(id, base, ops);
    };
    e.queue(title('queued first'), 10_000);
    const direct = e.commitNow([{ op: 'updateEpisode', fields: { brief: 'direct' } }], 'Direct save');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    saves.freeze();
    gate.resolve();
    await expect(direct).rejects.toMatchObject({ status: 423, body: { code: 'writes_frozen' } });
    expect(sent).toHaveLength(1);
    expect([current.title, current.brief]).toEqual(['queued first', '']);
    expect(kinds()).toEqual(['rejected:rejected:1']);
  });

  it('an upload finishing after the freeze is not linked, and is reported once as not saved', async () => {
    const e = await started();
    let changes = 0;
    server.changes = async (id, base, ops) => {
      changes++;
      return apply(id, base, ops);
    };
    const upload = deferred<void>();
    const run = e.track('Adding image "a.jpg"', async () => {
      await upload.promise;
      await e.commitNow([title('linked')], 'Added image reference', { nested: true });
    });
    saves.freeze();
    upload.resolve();
    await expect(run).rejects.toMatchObject({ status: 423 });
    expect(changes).toBe(0);
    expect(kinds()).toEqual(['rejected:rejected:1']);
  });

  it('settle still waits for a request sent before the freeze', async () => {
    const e = await started();
    const gate = deferred<void>();
    server.changes = async (id, base, ops) => {
      await gate.promise;
      return apply(id, base, ops);
    };
    e.queue(title('sent'));
    await vi.waitFor(() => expect(e.getSnapshot().state).toBe('saving'));
    saves.freeze();
    setTimeout(() => gate.resolve(), 50);
    expect(await saves.settle(2000)).toEqual({ outcome: 'confirmed', issues: [] });
    expect(current.title).toBe('sent');
  });
});

describe('direct saves', () => {
  const offline = async () => {
    throw new ApiError(0, 'Connection lost');
  };

  it('counts upload-and-link as one running save, and an unanswered link as uncertain once', async () => {
    const e = await started();
    const upload = deferred<void>();
    const commit = deferred<void>();
    server.changes = async () => {
      await commit.promise;
      throw new ApiError(0, 'Connection lost');
    };
    const run = e.track('Adding image "a.jpg"', async () => {
      await upload.promise;
      await e.commitNow([title('linked')], 'Added image reference', { nested: true });
    });
    expect(kinds()).toEqual(['uncertain:direct:1']);
    upload.resolve();
    await tick();
    expect(kinds()).toEqual(['uncertain:direct:1']);
    commit.resolve();
    await expect(run).rejects.toMatchObject({ status: 0 });
    expect(kinds()).toEqual(['uncertain:uncertain:1']);
    expect(saves.report().issues[0].message).toMatch(/Added image reference.*may or may not/);
    saves.acknowledge();
    expect(saves.report().outcome).toBe('confirmed');
  });

  it('an upload that fails before linking is reported as not saved, never confirmed', async () => {
    const e = await started();
    const run = e.track('Adding image "a.jpg"', async () => {
      await offline();
    });
    await expect(run).rejects.toMatchObject({ status: 0 });
    expect(saves.report().outcome).toBe('rejected');
    expect(saves.report().issues[0].message).toMatch(/Adding image "a.jpg" was not saved/);
  });

  it('a direct save refused (400) or signed out (401) is reported, unless an editor still holds it', async () => {
    const e = await started();
    server.changes = async () => {
      throw new ApiError(400, 'Too long');
    };
    await expect(e.commitNow([title('x')], 'Remove image')).rejects.toMatchObject({ status: 400 });
    server.changes = async () => {
      throw new ApiError(401, 'Sign in');
    };
    await expect(e.commitNow([title('x')], 'Added link')).rejects.toMatchObject({ status: 401 });
    expect(kinds()).toEqual(['rejected:rejected:1', 'rejected:rejected:1']);
    saves.acknowledge();
    // An open drawing keeps its content, so its own failure is not counted again (its draft is).
    await expect(e.commitNow([title('x')], 'Saved storyboard', { kept: true })).rejects.toMatchObject({ status: 401 });
    expect(saves.report().outcome).toBe('confirmed');
    // ...but an unanswered one may have been saved, so it is still uncertain.
    server.changes = offline;
    await expect(e.commitNow([title('x')], 'Saved storyboard', { kept: true })).rejects.toMatchObject({ status: 0 });
    expect(kinds()).toEqual(['uncertain:uncertain:1']);
  });

  it('a restore replays edits made meanwhile instead of discarding them', async () => {
    const e = await started();
    server.restore = async () => {
      current = { ...current, brief: 'restored', revision: current.revision + 1 };
      return { episode: current };
    };
    const restoring = e.restore(1, 1);
    e.queue(title('typed during restore'), 10_000);
    await restoring;
    expect(e.getSnapshot().episode?.title).toBe('typed during restore');
    await saves.settle(1000);
    expect([current.title, current.brief]).toEqual(['typed during restore', 'restored']);
  });

  it('an unanswered restore is uncertain', async () => {
    const e = await started();
    server.restore = offline;
    await expect(e.restore(1, 1)).rejects.toMatchObject({ status: 0 });
    expect(kinds()).toEqual(['uncertain:uncertain:1']);
  });
});

describe('errors that are not answers from the server', () => {
  it('keeps the batch for Retry and marks it as possibly applied, never as rejected', async () => {
    const e = await started();
    server.changes = async (id, base, ops) => {
      await apply(id, base, ops);
      throw new TypeError('Failed to read the response');
    };
    e.queue({ op: 'addScene', id: 'sc_newscene2', index: 1, scene: { title: 'New', durationSeconds: 10 } } as Operation);
    await vi.waitFor(() => expect(e.getSnapshot().state).toBe('error'));
    expect(kinds()).toEqual(['blocked:server:1']);
    expect(e.getSnapshot().episode?.scenes.some((s) => s.id === 'sc_newscene2')).toBe(true);
    server.changes = apply;
    e.retry();
    await saves.settle(2000);
    expect(current.scenes.filter((s) => s.id === 'sc_newscene2')).toHaveLength(1);
    expect(kinds()).toEqual(['uncertain:uncertain:1']);
  });

  it('reports uncertain, not confirmed, if a participant cannot be checked', () => {
    const broken = {
      settle: async () => undefined,
      resume: () => undefined,
      acknowledgeDropped: () => undefined,
      discard: () => undefined,
      retryHeld: () => undefined,
      issues: (): never => {
        throw new Error('boom');
      },
    };
    saves.register(broken);
    try {
      expect(saves.report()).toMatchObject({ outcome: 'uncertain', issues: [{ kind: 'unknown' }] });
    } finally {
      saves.unregister(broken);
    }
  });
});

describe('drafts', () => {
  it('reports an open drawing as blocked until it is released', () => {
    const release = saves.addDraft('The drawing for "Opening"', { episodeId: ID, retained: true });
    expect(saves.report()).toMatchObject({ outcome: 'blocked', issues: [{ kind: 'draft', episodeId: ID }] });
    expect(saves.report().issues[0].message).toMatch(/kept in this browser/);
    release();
    expect(saves.report().outcome).toBe('confirmed');
  });

  it('claims a local copy only when one was stored', () => {
    const release = saves.addDraft('The drawing for "Opening"', { episodeId: ID, retained: false });
    expect(saves.report().issues[0].message).not.toMatch(/kept/);
    release();
    const stored = new Map<string, string>();
    expect(storeLocalCopy('k', 'v', { setItem: (k, v) => void stored.set(k, v) })).toBe(true);
    expect(stored.get('k')).toBe('v');
    expect(
      storeLocalCopy('k', 'v', {
        setItem: () => {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        },
      }),
    ).toBe(false);
    // Denied storage: even reading window.localStorage throws.
    const denied = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Access denied', 'SecurityError');
      },
    });
    try {
      expect(storeLocalCopy('k', 'v')).toBe(false);
    } finally {
      if (denied) Object.defineProperty(globalThis, 'localStorage', denied);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('explicit discard', () => {
  it('drops local work, ignores the late answer of a request already sent, and leaves no timers', async () => {
    const e = await started();
    const gate = deferred<void>();
    let calls = 0;
    server.changes = async (id, base, ops) => {
      calls++;
      await gate.promise;
      throw new ApiError(0, 'Connection lost');
    };
    e.queue(title('sent'));
    await vi.waitFor(() => expect(calls).toBe(1));
    e.queue({ op: 'updateEpisode', fields: { brief: 'queued' } }, 10_000);
    const release = saves.addDraft('A new shot typed', { discard: vi.fn() });
    const draftDiscard = vi.fn();
    saves.addDraft('The drawing', { retained: true, discard: draftDiscard });
    saves.discardAll();
    release();
    expect(draftDiscard).toHaveBeenCalledOnce();
    expect(saves.isRegistered(e)).toBe(false);
    expect(saves.report()).toEqual({ outcome: 'confirmed', issues: [] });
    gate.resolve();
    await new Promise((r) => setTimeout(r, 2500));
    // The failed answer is not requeued and no retry is scheduled.
    expect(calls).toBe(1);
    expect(e.hasUnsaved).toBe(false);
  });

  it('retryHeld resends server-error saves but never signed-out ones', async () => {
    const e = await started();
    let calls = 0;
    server.changes = async () => {
      calls++;
      throw new ApiError(401, 'Sign in');
    };
    e.queue(title('a'));
    await vi.waitFor(() => expect(e.getSnapshot().state).toBe('error'));
    saves.retryHeld();
    await tick();
    expect(calls).toBe(1);
    server.changes = async () => {
      calls++;
      throw new ApiError(500, 'Boom');
    };
    e.retry();
    await vi.waitFor(() => expect(kinds()).toEqual(['blocked:server:1']));
    server.changes = apply;
    saves.retryHeld();
    await vi.waitFor(() => expect(current.title).toBe('a'));
  });
});
