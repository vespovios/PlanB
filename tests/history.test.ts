// HistoryNav against a fake browser history: traversals are queued and asynchronous, as in browsers,
// so approvals, corrections and interruptions can be exercised deterministically.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryNav, NavigationGuard } from '../src/client/navigation.js';
import { SaveCoordinator, type SaveIssue, type SaveParticipant } from '../src/client/saves.js';

const BASE = 'http://planb.test/';
class FakeBrowser {
  entries: { url: string; state: unknown }[] = [{ url: `${BASE}#/`, state: null }];
  i = 0;
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

  it('Back with unsaved work: the address is put back, the page stays, history is unchanged', async () => {
    const { p, guard, nav } = setup();
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    browser.back();
    await browser.settle();
    expect(guard.getSnapshot().step).toBe('blocked');
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    consistent(nav);
    expect(browser.history.length).toBe(2);
    guard.stay();
    await browser.settle();
    consistent(nav);
  });

  it('an approved Back completes only when it lands: discards then, and the page changes then', async () => {
    const { c, p, guard, nav } = setup();
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    browser.back();
    await browser.settle();
    guard.askDiscard();
    guard.confirmDiscard();
    // Not yet arrived: still on the page, frozen, nothing discarded.
    expect(guard.getSnapshot()).toEqual({ step: 'moving' });
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    expect(p.discard).not.toHaveBeenCalled();
    expect(c.isFrozen).toBe(true);
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/');
    consistent(nav);
    expect(p.discard).toHaveBeenCalledOnce();
    expect(c.isFrozen).toBe(false);
    expect(browser.history.length).toBe(2);
  });

  it('if signing in again or sign-out takes the page before the approved Back lands, nothing moves or is discarded', async () => {
    const { c, p, guard, nav, lock } = setup();
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    browser.back();
    await browser.settle();
    guard.askDiscard();
    guard.confirmDiscard();
    lock(true); // e.g. the session was lost (App also resets the guard)
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    consistent(nav);
    expect(p.discard).not.toHaveBeenCalled();
    expect(guard.getSnapshot()).toEqual({ step: 'idle' });
    expect(c.isFrozen).toBe(false);
  });

  it('a guard reset (session lost) before the approved Back lands also keeps the page', async () => {
    const { p, guard, nav } = setup();
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    browser.back();
    await browser.settle();
    guard.askDiscard();
    guard.confirmDiscard();
    guard.reset();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    consistent(nav);
    expect(p.discard).not.toHaveBeenCalled();
  });

  it('Back/Forward pressed while a move is decided or replayed never leaves page and address apart', async () => {
    const { p, guard, nav } = setup();
    nav.navigate('#/settings');
    nav.navigate('#/e/ep_a/plan');
    p.list = [issue('offline')];
    // Several presses while deciding.
    browser.back();
    browser.back();
    browser.forward();
    await browser.settle();
    expect(nav.getSnapshot()).toBe('#/e/ep_a/plan');
    consistent(nav);
    expect(guard.getSnapshot().step).toBe('blocked');
    // Approve, and press Back again before the replay lands.
    guard.askDiscard();
    guard.confirmDiscard();
    browser.back();
    browser.forward();
    await browser.settle();
    consistent(nav);
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
