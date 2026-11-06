// HistoryNav against a fake browser history: traversals are queued and asynchronous, as in browsers,
// so approvals, corrections and interruptions can be exercised deterministically.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryNav, NavigationGuard } from '../src/client/navigation.js';
import { SaveCoordinator, type SaveIssue, type SaveParticipant } from '../src/client/saves.js';

const BASE = 'http://planb.test/';
class FakeBrowser {
  entries: { url: string; state: unknown }[] = [{ url: `${BASE}#/`, state: null }];
  i = 0;
  /** Traversals that actually moved (ours and the user's). */
  moves = 0;
  private queue: (() => void)[] = [];
  window = new EventTarget();
  document = new EventTarget();
  private abs = (url?: string | null) => (url == null ? this.entries[this.i].url : url.startsWith('#') ? `${BASE}${url}` : url);
  history = {
    get state() {
      return browser.entries[browser.i].state;
    },
    get length() {
      return browser.entries.length;
    },
    pushState: (state: unknown, _t: string, url?: string) => {
      this.entries.splice(this.i + 1);
      this.entries.push({ url: this.abs(url), state });
      this.i++;
    },
    replaceState: (state: unknown, _t: string, url?: string) => {
      this.entries[this.i] = { url: this.abs(url), state };
    },
    go: (n: number) => {
      this.queue.push(() => {
        const t = this.i + n;
        if (n === 0 || t < 0 || t >= this.entries.length) return;
        this.i = t;
        this.moves++;
        this.window.dispatchEvent(new Event('popstate'));
      });
      if (this.queue.length === 1) setTimeout(() => this.drain(), 0);
    },
  };
  location = {
    get hash() {
      return new URL(browser.entries[browser.i].url).hash;
    },
    get href() {
      return browser.entries[browser.i].url;
    },
  };
  private drain() {
    const step = this.queue.shift();
    step?.();
    if (this.queue.length) setTimeout(() => this.drain(), 0);
  }
  /** The user presses Back/Forward. */
  back = () => this.history.go(-1);
  forward = () => this.history.go(1);
  /** Waits until every queued traversal (and what it triggers) has run. */
  async settle() {
    for (let n = 0; n < 50; n++) await new Promise((r) => setTimeout(r, 1));
  }
}
let browser: FakeBrowser;

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

let stop: () => void;
function setup() {
  const c = new SaveCoordinator();
  const p = participant();
  c.register(p);
  const guard = new NavigationGuard({ coordinator: c, settleMs: 20 });
  let locked = false;
  const nav = new HistoryNav({ guard, locked: () => locked });
  stop = nav.start();
  return { c, p, guard, nav, lock: (v: boolean) => (locked = v) };
}
/** The page on screen always matches the address once history is quiet. */
const consistent = (nav: HistoryNav) => expect(nav.getSnapshot()).toBe(browser.location.hash);

beforeEach(() => {
  browser = new FakeBrowser();
  Object.assign(globalThis, { window: browser.window, document: browser.document, history: browser.history, location: browser.location });
});
afterEach(() => stop?.());

describe('guarded hash history', () => {
  it('clean moves are immediate, one entry per navigation, and Back/Forward follow', async () => {
    const { nav } = setup();
    nav.navigate('#/e/ep_a/plan');
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    expect(browser.history.length).toBe(2);
    browser.back();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/');
    browser.forward();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
  });

  it('Back with unsaved work: the page stays while deciding; Stay restores the address; history is unchanged', async () => {
    const { p, guard, nav } = setup();
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    browser.back();
    await browser.settle();
    expect(guard.getSnapshot().step).toBe('blocked');
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    guard.stay();
    await browser.settle();
    consistent(nav);
    expect(browser.i).toBe(1);
    expect(browser.history.length).toBe(2);
  });

  it('an approved Back shows the page the browser is already on, and discards only then', async () => {
    const { c, p, guard, nav } = setup();
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    browser.back();
    await browser.settle();
    guard.askDiscard();
    expect(c.isFrozen).toBe(true);
    expect(p.discard).not.toHaveBeenCalled();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    guard.confirmDiscard();
    expect(nav.getSnapshot()).toBe('#/');
    expect(p.discard).toHaveBeenCalledOnce();
    expect(c.isFrozen).toBe(false);
    await browser.settle();
    consistent(nav);
    expect(browser.history.length).toBe(2);
  });

  it('if signing in again or sign-out takes the page before the move is approved, nothing moves or is discarded', async () => {
    const { c, p, guard, nav, lock } = setup();
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    browser.back();
    await browser.settle();
    guard.askDiscard();
    lock(true); // e.g. the session was lost while the dialog was open
    guard.confirmDiscard();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    consistent(nav);
    expect(p.discard).not.toHaveBeenCalled();
    expect(guard.getSnapshot()).toEqual({ step: 'idle' });
    expect(c.isFrozen).toBe(false);
  });

  it('Back/Forward pressed while deciding never leaves page and address apart once decided', async () => {
    const { p, guard, nav } = setup();
    nav.navigate('#/settings');
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    browser.back();
    browser.back();
    browser.forward();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    expect(guard.getSnapshot().step).toBe('blocked');
    guard.stay();
    await browser.settle();
    consistent(nav);
    expect(browser.i).toBe(2);
    expect(guard.busy).toBe(false);
  });

  it('in-app navigation with unsaved work pushes exactly one entry once approved, and none on Stay', async () => {
    const { p, guard, nav } = setup();
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    nav.navigate('#/settings');
    await browser.settle();
    expect(guard.getSnapshot().step).toBe('blocked');
    guard.stay();
    expect(browser.history.length).toBe(2);
    nav.navigate('#/settings');
    await browser.settle();
    guard.askDiscard();
    guard.confirmDiscard();
    expect(nav.getSnapshot()).toBe('#/settings');
    expect(browser.history.length).toBe(3);
    consistent(nav);
  });

  it('nothing moves at all while another flow owns the page; the address is put back', async () => {
    const { nav, lock } = setup();
    nav.navigate('#/e/ep_a/plan');
    lock(true);
    browser.back();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    consistent(nav);
    nav.navigate('#/settings');
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
  });
});

describe('exact history positions', () => {
  /** History: #/ (0) → #/settings (1) → plan (2), with unsaved work on the plan. */
  async function onDirtyPlan() {
    const ctx = setup();
    ctx.nav.navigate('#/settings');
    ctx.nav.navigate('#/e/ep_a/plan');
    ctx.p.list = [issue('offline')];
    return ctx;
  }

  it('an approved Back ends exactly on its target with no further traversal of ours', async () => {
    const { guard, nav } = await onDirtyPlan();
    browser.back();
    await browser.settle();
    expect(guard.getSnapshot().step).toBe('blocked');
    const moves = browser.moves;
    guard.askDiscard();
    guard.confirmDiscard();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/settings');
    expect(browser.i).toBe(1);
    expect(browser.entries).toHaveLength(3);
    expect(browser.moves).toBe(moves); // approving needed no traversal
  });

  it('Stay ends exactly on the source, even if the user presses Back while it is being restored', async () => {
    const { guard, nav } = await onDirtyPlan();
    browser.back();
    await browser.settle();
    guard.stay();
    browser.back(); // competes with the restoring traversal
    await browser.settle();
    // Still unsaved, so that Back asks again (the address is on the page being decided about).
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    guard.stay();
    await browser.settle();
    expect(browser.i).toBe(2);
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    expect(browser.entries).toHaveLength(3);
  });

  it('Back pressed while deciding, then approving: the move is cancelled and the source restored exactly', async () => {
    const { p, guard, nav } = await onDirtyPlan();
    browser.back();
    await browser.settle();
    browser.back(); // moves the browser on while the dialog is open
    await browser.settle();
    guard.askDiscard();
    guard.confirmDiscard();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    expect(browser.i).toBe(2);
    expect(p.discard).not.toHaveBeenCalled();
    expect(guard.busy).toBe(false);
  });

  it('the session lost while deciding: the source is restored exactly and nothing is discarded', async () => {
    const { p, guard, nav, lock } = await onDirtyPlan();
    browser.back();
    await browser.settle();
    lock(true);
    guard.reset();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    expect(browser.i).toBe(2);
    expect(p.discard).not.toHaveBeenCalled();
  });
});
