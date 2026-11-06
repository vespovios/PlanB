// Navigation that never silently drops unsaved work. The page being left stays mounted until the
// move is decided: clean moves happen at once; otherwise saving is tried first (bounded) and the
// user chooses Stay, Retry or an explicit Leave without saving.
import { parseRoute, type Route } from './router';
import { saves as defaultCoordinator, type SaveCoordinator, type SaveReport } from './saves';

/**
 * 'drafts': moving between tabs of the same episode keeps its save engine, but tab content (typed
 * new shots, an open drawing…) unmounts. 'page': leaving the page ends its engine too.
 */
export type NavScope = 'page' | 'drafts';

export function navScope(from: Route, to: Route): NavScope {
  return from.name === 'episode' && to.name === 'episode' && from.id === to.id ? 'drafts' : 'page';
}

export type NavPhase =
  | { step: 'idle' }
  | { step: 'saving' }
  | { step: 'blocked'; scope: NavScope; report: SaveReport }
  | { step: 'confirm'; scope: NavScope; report: SaveReport }
  /** Left after discarding, but a local copy could not be deleted. */
  | { step: 'left'; notDeleted: string[] };

const draftsOnly = (r: SaveReport): SaveReport => {
  const issues = r.issues.filter((i) => i.kind === 'draft');
  return { outcome: issues.length ? 'blocked' : 'confirmed', issues };
};

export class NavigationGuard {
  private phase: NavPhase = { step: 'idle' };
  private listeners = new Set<() => void>();
  private run = 0;
  private pending: { scope: NavScope; proceed: () => void; cancel: () => void } | null = null;
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
    return scope === 'drafts' ? draftsOnly(r) : r;
  }

  /** True if the move can happen at once (nothing it would drop). Synchronous: clean moves stay instant. */
  isClean(scope: NavScope) {
    return this.report(scope).outcome === 'confirmed';
  }

  /** A move that is not clean: try to save first, then proceed or ask. */
  decide(scope: NavScope, proceed: () => void, cancel: () => void) {
    if (this.busy) return cancel();
    this.pending = { scope, proceed, cancel };
    return this.check(this.run);
  }

  stay = () => {
    if (this.phase.step === 'left') return this.set({ step: 'idle' });
    if (this.phase.step !== 'blocked' && this.phase.step !== 'confirm') return;
    this.end(false);
  };

  retry = () => {
    if (this.phase.step !== 'blocked' || this.phase.scope === 'drafts') return Promise.resolve();
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
    if (report.outcome === 'confirmed') return this.finish([]);
    this.set({ step: 'blocked', scope: this.phase.scope, report });
  };

  /** Explicit: discard what this move would drop, then move. */
  confirmDiscard = () => {
    if (this.phase.step !== 'confirm') return;
    const notDeleted = this.phase.scope === 'drafts' ? this.c.discardDrafts() : this.c.discardAll();
    this.finish(notDeleted);
  };

  /** The session was lost (or a sign-out began): abandon the move and stay. */
  reset = () => {
    if (this.busy) this.end(false);
  };

  private end(proceeded: boolean) {
    this.run++;
    const p = this.pending;
    this.pending = null;
    this.c.thaw('navigate');
    this.set({ step: 'idle' });
    if (!proceeded) p?.cancel();
  }

  private finish(notDeleted: string[]) {
    const p = this.pending;
    // Move first (the page being left unmounts and its engine stops), then let saving resume.
    p?.proceed();
    this.end(true);
    if (notDeleted.length) this.set({ step: 'left', notDeleted });
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
    if (this.report(scope).outcome === 'confirmed') return this.finish([]);
    this.c.thaw('navigate');
    this.set({ step: 'blocked', scope, report: this.report(scope) });
  }
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
  private approving: { index: number; hash: string } | null = null;

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
    if (this.approving && idx === this.approving.index) {
      const target = this.approving;
      this.approving = null;
      this.index = target.index;
      this.commit(target.hash);
      return;
    }
    if (idx === this.index) return; // back on the entry that is shown (e.g. an undo landing)
    const delta = idx - this.index;
    const from = parseRoute(this.committed);
    const to = parseRoute(hash);
    // Clean, and nobody else owns the page: move at once, no flicker.
    if (!this.deps.locked() && !this.deps.guard.busy && this.deps.guard.isClean(navScope(from, to))) {
      this.index = idx;
      this.commit(hash);
      return;
    }
    // Put the address back on the page still shown, then decide (or just stay, if locked/busy).
    history.go(-delta);
    if (this.deps.locked() || this.deps.guard.busy) return;
    this.deps.guard.decide(
      navScope(from, to),
      () => {
        this.approving = { index: this.index + delta, hash };
        history.go(delta);
      },
      () => undefined,
    );
  };

  private attempt(hash: string, go: () => void) {
    if (this.deps.locked() || this.deps.guard.busy) return;
    const scope = navScope(parseRoute(this.committed), parseRoute(hash));
    if (this.deps.guard.isClean(scope)) return go();
    this.deps.guard.decide(scope, go, () => undefined);
  }
}
