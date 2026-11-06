// Navigation that never silently drops unsaved work. The page being left stays mounted until the
// move is decided: clean moves happen at once; otherwise saving is tried first (bounded) and the
// user chooses Stay, Retry or an explicit Leave without saving.
import { createContext, useContext } from 'react';
import { parseRoute, type Route } from './router';
import { saves as defaultCoordinator, type SaveCoordinator, type SaveReport } from './saves';

/**
 * 'page': leaving the page ends its save engine and everything on it. { zone }: a move inside the
 * page that unmounts only one part of it ('tab' when switching tabs of an episode, 'scene' when
 * switching scenes or closing the scene sheet), so only drafts living in that zone are at stake.
 */
export type NavScope = 'page' | { zone: string };

export function navScope(from: Route, to: Route): NavScope {
  return from.name === 'episode' && to.name === 'episode' && from.id === to.id ? { zone: 'tab' } : 'page';
}

export type NavPhase =
  | { step: 'idle' }
  | { step: 'saving' }
  | { step: 'blocked'; scope: NavScope; report: SaveReport }
  | { step: 'confirm'; scope: NavScope; report: SaveReport }
  /** Approved; waiting for the move to actually happen (a history step lands). */
  | { step: 'moving' }
  /** Left after discarding, but a local copy could not be deleted. */
  | { step: 'left'; notDeleted: string[] };

const inZone = (r: SaveReport, zone: string): SaveReport => {
  const issues = r.issues.filter((i) => i.kind === 'draft' && (i.zones ?? []).includes(zone));
  return { outcome: issues.length ? 'blocked' : 'confirmed', issues };
};

/**
 * Carries out an approved move. Call `arrive()` at the moment the move takes effect: it returns false
 * if the move was abandoned meanwhile (then do not move). Call `fail()` if it could not happen.
 */
export type Move = (arrive: () => boolean, fail: () => void) => void;

export class NavigationGuard {
  private phase: NavPhase = { step: 'idle' };
  private listeners = new Set<() => void>();
  private run = 0;
  private pending: { scope: NavScope; move: Move; cancel: () => void } | null = null;
  private readonly c: SaveCoordinator;

  constructor(private deps: { coordinator?: SaveCoordinator; settleMs?: number } = {}) {
    this.c = deps.coordinator ?? defaultCoordinator;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.phase;
  get busy() {
    return this.phase.step !== 'idle' && this.phase.step !== 'left';
  }

  private set(phase: NavPhase) {
    this.phase = phase;
    this.listeners.forEach((fn) => fn());
  }

  private report(scope: NavScope) {
    const r = this.c.report();
    return scope === 'page' ? r : inZone(r, scope.zone);
  }

  /** True if the move can happen at once (nothing it would drop). Synchronous: clean moves stay instant. */
  isClean(scope: NavScope) {
    return this.report(scope).outcome === 'confirmed';
  }

  /** A move that is not clean: try to save first (whole page only), then move or ask. */
  decide(scope: NavScope, move: Move, cancel: () => void) {
    if (this.busy) return cancel();
    this.pending = { scope, move, cancel };
    return this.check(this.run);
  }

  /** A change inside the page that unmounts one zone (e.g. another scene): runs `action` once allowed. */
  local = (zone: string, action: () => void) => {
    if (this.busy) return;
    if (this.isClean({ zone })) return action();
    void this.decide({ zone }, (arrive) => arrive() && action(), () => undefined);
  };

  stay = () => {
    if (this.phase.step === 'left') return this.set({ step: 'idle' });
    if (this.phase.step !== 'blocked' && this.phase.step !== 'confirm') return;
    this.end(false);
  };

  retry = () => {
    if (this.phase.step !== 'blocked' || this.phase.scope !== 'page') return Promise.resolve();
    this.c.retryHeld();
    return this.check(this.run);
  };

  askDiscard = () => {
    if (this.phase.step !== 'blocked') return;
    this.c.freeze('navigate');
    this.set({ step: 'confirm', scope: this.phase.scope, report: this.report(this.phase.scope) });
  };

  back = () => {
    if (this.phase.step !== 'confirm') return;
    this.c.thaw('navigate');
    const report = this.report(this.phase.scope);
    if (report.outcome === 'confirmed') return this.approve(false);
    this.set({ step: 'blocked', scope: this.phase.scope, report });
  };

  /** Explicit: discard what this move would drop, at the moment the move happens. */
  confirmDiscard = () => {
    if (this.phase.step !== 'confirm') return;
    this.approve(true);
  };

  /** The session was lost (or a sign-out began): abandon the move and stay. */
  reset = () => {
    if (this.busy) this.end(false);
  };

  private end(moved: boolean) {
    this.run++;
    const p = this.pending;
    this.pending = null;
    this.c.thaw('navigate');
    this.set({ step: 'idle' });
    if (!moved) p?.cancel();
  }

  /**
   * Approved: writes stay frozen and nothing is discarded until the move actually happens. A history
   * step can take a moment, and another flow may take over the page meanwhile (then arrive() is false).
   */
  private approve(discard: boolean) {
    const p = this.pending!;
    const run = this.run;
    this.c.freeze('navigate');
    this.set({ step: 'moving' });
    p.move(
      () => {
        if (run !== this.run) return false;
        const scope = p.scope;
        const notDeleted = !discard ? [] : scope === 'page' ? this.c.discardAll() : this.c.discardDrafts(scope.zone);
        this.end(true);
        if (notDeleted.length) this.set({ step: 'left', notDeleted });
        return true;
      },
      () => {
        if (run === this.run) this.end(false);
      },
    );
  }

  private async check(run: number) {
    const scope = this.pending!.scope;
    if (scope === 'page') {
      this.set({ step: 'saving' });
      await this.c.settle(this.deps.settleMs);
      if (run !== this.run) return;
    }
    // Freeze, then look again synchronously: nothing can be added between this report and the move.
    this.c.freeze('navigate');
    if (this.report(scope).outcome === 'confirmed') return this.approve(false);
    this.c.thaw('navigate');
    this.set({ step: 'blocked', scope, report: this.report(scope) });
  }
}

export const NavGuardContext = createContext<NavigationGuard | null>(null);

/** For changes inside a page that unmount one zone: `(zone, action)` runs `action` once allowed. */
export function useLocalGuard() {
  const guard = useContext(NavGuardContext);
  return (zone: string, action: () => void) => (guard ? guard.local(zone, action) : action());
}

/**
 * Browser history for the hash router. Every entry is numbered, so Back/Forward (popstate) can be
 * told apart and undone exactly; app links and navigate() push only once a move is approved. The
 * rendered route only changes when a move is approved, so the page being left stays mounted.
 */
export class HistoryNav {
  private committed: string;
  private index: number;
  private listeners = new Set<() => void>();
  /** A Back/Forward the user approved, on its way to this entry. */
  private approving: { index: number; hash: string; arrive: () => boolean; fail: () => void } | null = null;
  /**
   * One history.go() of ours is under way to put the address back. Only one at a time: history.go
   * is relative to wherever the browser is when it runs, so each correction is computed from the
   * entry actually reached.
   */
  private correcting = false;

  private restore(idx: number) {
    if (this.correcting || idx === this.index) return;
    this.correcting = true;
    history.go(this.index - idx);
  }

  constructor(
    private deps: {
      guard: NavigationGuard;
      /** Another flow (sign-out, signing in again) owns the page: no move at all, the address is restored. */
      locked: () => boolean;
    },
  ) {
    const st = history.state as { planbIndex?: number } | null;
    this.index = typeof st?.planbIndex === 'number' ? st.planbIndex : 0;
    if (typeof st?.planbIndex !== 'number') history.replaceState({ ...(st ?? {}), planbIndex: this.index }, '', location.href);
    this.committed = location.hash || '#/';
  }

  start() {
    window.addEventListener('popstate', this.onPop);
    document.addEventListener('click', this.onClick, true);
    return () => {
      window.removeEventListener('popstate', this.onPop);
      document.removeEventListener('click', this.onClick, true);
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  /** The route on screen (only changes once a move is approved). */
  getSnapshot = () => this.committed;

  private commit(hash: string) {
    this.committed = hash;
    this.listeners.forEach((fn) => fn());
  }

  /** In-app navigation (links and navigate()). */
  navigate = (to: string) => {
    const hash = to.startsWith('#') ? to : `#${to}`;
    if (hash === this.committed) return;
    this.attempt(hash, () => {
      this.index++;
      history.pushState({ planbIndex: this.index }, '', hash);
      this.commit(hash);
    });
  };

  /** Drops an approved Back/Forward that has not landed: the page on screen stays. */
  private abandonApproval = () => {
    const a = this.approving;
    this.approving = null;
    a?.fail();
  };

  private onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    const href = a?.getAttribute('href');
    if (!a || !href?.startsWith('#') || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    e.preventDefault();
    this.navigate(href);
  };

  private onPop = () => {
    const st = history.state as { planbIndex?: number } | null;
    let idx = st?.planbIndex;
    if (typeof idx !== 'number') {
      // A new entry made outside the router (typed address, location.hash = …): number it.
      idx = this.index + 1;
      history.replaceState({ ...(st ?? {}), planbIndex: idx }, '', location.href);
    }
    const hash = location.hash || '#/';
    const correction = this.correcting;
    this.correcting = false;
    if (this.approving) {
      const target = this.approving;
      if (idx === target.index && hash === target.hash) {
        this.approving = null;
        // Arrived. Only now does the page change, and only if nothing took over the page meanwhile.
        if (!this.deps.locked() && target.arrive()) {
          this.index = idx;
          this.commit(hash);
        } else {
          target.fail();
          this.restore(idx);
        }
        return;
      }
      // Our correction landing first is expected; anything else interrupts the approved move.
      if (idx === this.index && correction) return;
      this.abandonApproval();
    }
    if (idx === this.index) return; // back on the entry that is shown (e.g. a correction landing)
    const delta = idx - this.index;
    const from = parseRoute(this.committed);
    const to = parseRoute(hash);
    const owned = this.deps.locked() || this.deps.guard.busy;
    // Clean, and nobody else owns the page: move at once, no flicker.
    if (!owned && !correction && this.deps.guard.isClean(navScope(from, to))) {
      this.index = idx;
      this.commit(hash);
      return;
    }
    // Put the address back on the page still shown, then decide (or just stay, if owned).
    this.restore(idx);
    if (owned || correction) return;
    void this.deps.guard.decide(
      navScope(from, to),
      (arrive, fail) => {
        this.approving = { index: this.index + delta, hash, arrive, fail };
        history.go(delta);
      },
      () => undefined,
    );
  };

  private attempt(hash: string, go: () => void) {
    if (this.deps.locked() || this.deps.guard.busy) return;
    const scope = navScope(parseRoute(this.committed), parseRoute(hash));
    if (this.deps.guard.isClean(scope)) return go();
    void this.deps.guard.decide(scope, (arrive, fail) => (this.deps.locked() ? fail() : arrive() && go()), () => undefined);
  }
}
