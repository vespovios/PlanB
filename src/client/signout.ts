// Sign-out that tells the truth: unsaved work is saved first (or the user decides what happens to
// it), and the app only shows "signed out" once the server confirmed it.
import { saves as defaultCoordinator, type SaveCoordinator, type SaveReport } from './saves';

export type SignOutPhase =
  | { step: 'idle' }
  /** Saving what can be saved before signing out. */
  | { step: 'saving' }
  /** Something is not saved; nothing has been signed out. */
  | { step: 'blocked'; report: SaveReport }
  /** The user asked to sign out without saving; writes are frozen while they confirm. */
  | { step: 'confirm'; report: SaveReport }
  | { step: 'signing-out'; discard: boolean }
  /** The sign-out request got no clear answer: the session may or may not have ended. */
  | { step: 'unconfirmed'; discard: boolean; message: string };

export const LOGOUT_TIMEOUT_MS = 15_000;

export class SignOutFlow {
  private phase: SignOutPhase = { step: 'idle' };
  private listeners = new Set<() => void>();
  /** Bumped whenever a run ends, so late answers from an abandoned run are ignored. */
  private run = 0;
  private readonly c: SaveCoordinator;

  constructor(
    private deps: {
      logout: () => Promise<unknown>;
      /** Called once the server confirmed the sign-out. */
      onSignedOut: () => void;
      coordinator?: SaveCoordinator;
      settleMs?: number;
      logoutTimeoutMs?: number;
    },
  ) {
    this.c = deps.coordinator ?? defaultCoordinator;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.phase;

  private set(phase: SignOutPhase) {
    this.phase = phase;
    this.listeners.forEach((fn) => fn());
  }

  /** Sign out button. Ignored while a sign-out is already under way (double clicks). */
  start = () => {
    if (this.phase.step !== 'idle') return Promise.resolve();
    return this.check(this.run);
  };

  /** Blocked: resend saves held after server errors or while offline, then check again. */
  retry = () => {
    if (this.phase.step !== 'blocked') return Promise.resolve();
    this.c.retryHeld();
    return this.check(this.run);
  };

  /** Back to the page with everything as it was. */
  stay = () => {
    if (this.phase.step === 'idle' || this.phase.step === 'saving' || this.phase.step === 'signing-out') return;
    this.end();
  };

  /** Blocked: ask to sign out without saving. Writes are frozen so the list shown is the list discarded. */
  askDiscard = () => {
    if (this.phase.step !== 'blocked') return;
    this.c.freeze();
    this.set({ step: 'confirm', report: this.c.report() });
  };

  /** Confirm step: go back to the list without discarding. */
  back = () => {
    if (this.phase.step !== 'confirm') return;
    this.c.thaw();
    const report = this.c.report();
    if (report.outcome === 'confirmed') this.end();
    else this.set({ step: 'blocked', report });
  };

  /**
   * Confirm step: sign out, then discard. Nothing is discarded unless the server confirms the
   * sign-out, so a failed sign-out never deletes work.
   */
  confirmDiscard = () => {
    if (this.phase.step !== 'confirm') return Promise.resolve();
    return this.logout(this.run, true);
  };

  /** Unconfirmed: send the sign-out again (it is idempotent). Nothing is saved meanwhile. */
  tryAgain = () => {
    if (this.phase.step !== 'unconfirmed') return Promise.resolve();
    this.c.freeze();
    return this.logout(this.run, this.phase.discard);
  };

  /** The app signed out for another reason (e.g. the session expired): abandon this run. */
  reset = () => {
    if (this.phase.step !== 'idle') this.end();
  };

  private end() {
    this.run++;
    this.c.thaw();
    this.set({ step: 'idle' });
  }

  private async check(run: number) {
    this.set({ step: 'saving' });
    await this.c.settle(this.deps.settleMs);
    if (run !== this.run) return;
    // Freeze, then look again synchronously: nothing can be added between this report and sign-out.
    this.c.freeze();
    const report = this.c.report();
    if (report.outcome === 'confirmed') return this.logout(run, false);
    this.c.thaw();
    // Shown as it is now that writes resume (nothing is "paused" any more).
    this.set({ step: 'blocked', report: this.c.report() });
  }

  private async logout(run: number, discard: boolean) {
    this.set({ step: 'signing-out', discard });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.deps.logout(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('PlanB did not answer in time.')), this.deps.logoutTimeoutMs ?? LOGOUT_TIMEOUT_MS);
        }),
      ]);
    } catch (e) {
      if (run !== this.run) return;
      // Writes stay frozen: nothing is sent while it is unclear whether this session still exists.
      this.set({ step: 'unconfirmed', discard, message: (e as Error)?.message ?? String(e) });
      return;
    } finally {
      clearTimeout(timer);
    }
    if (run !== this.run) return;
    if (discard) this.c.discardAll();
    this.end();
    this.deps.onSignedOut();
  }
}
