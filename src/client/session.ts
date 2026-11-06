// Recovering from a lost session (expired, revoked elsewhere, password changed, or the browser
// switched to another account) without losing the work on this page, and without ever sending it
// for, or showing it to, a different account.
import { api, setSessionUser, type User } from './api';
import { saves as defaultCoordinator, type SaveCoordinator, type SaveReport } from './saves';

export type RecoveryPhase =
  | { step: 'active' }
  /** The session is gone; the page stays as it is, paused, until the same account signs in. */
  | { step: 'lost'; user: User; switched: boolean }
  /** The user chose to leave without signing in again: confirm what is discarded. */
  | { step: 'confirm-discard'; user: User; switched: boolean; report: SaveReport };

export class SessionRecovery {
  private phase: RecoveryPhase = { step: 'active' };
  private listeners = new Set<() => void>();
  private readonly c: SaveCoordinator;

  constructor(
    private deps: {
      login?: (email: string, password: string) => Promise<{ user: User }>;
      /** Discarded and signed out locally; `notDeleted` lists local copies that could not be deleted. */
      onDiscarded: (notDeleted: string[]) => void;
      coordinator?: SaveCoordinator;
    },
  ) {
    this.c = deps.coordinator ?? defaultCoordinator;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.phase;

  private set(phase: RecoveryPhase) {
    this.phase = phase;
    this.listeners.forEach((fn) => fn());
  }

  /** The server refused the current session. Repeated reports while already paused are ignored. */
  lost = (user: User, switched = false) => {
    if (this.phase.step !== 'active') return;
    this.c.suspendForAuth();
    this.set({ step: 'lost', user, switched });
  };

  /**
   * Signs in again as the same account (the e-mail is fixed). Only if the server confirms it is the
   * same account do saves resume. Returns an error message, or null on success.
   */
  signIn = async (password: string): Promise<string | null> => {
    const phase = this.phase;
    if (phase.step !== 'lost') return null;
    let user: User;
    try {
      ({ user } = await (this.deps.login ?? api.login)(phase.user.email, password));
    } catch (e) {
      return (e as Error).message;
    }
    if (this.phase !== phase) return null;
    if (user.id !== phase.user.id) {
      // Never resume this page's work for another account. Requests still name the original
      // account, so the server refuses them for this session.
      return `That signed in as ${user.email}, not ${phase.user.email}. Nothing from this page was sent.`;
    }
    // New session: late answers for the old one are now recognised as stale.
    setSessionUser(user.id);
    this.set({ step: 'active' });
    this.c.reauthenticated();
    return null;
  };

  /** Leave without signing in again: shows what would be discarded. */
  askDiscard = () => {
    if (this.phase.step !== 'lost') return;
    this.set({ step: 'confirm-discard', user: this.phase.user, switched: this.phase.switched, report: this.c.report() });
  };

  back = () => {
    if (this.phase.step !== 'confirm-discard') return;
    this.set({ step: 'lost', user: this.phase.user, switched: this.phase.switched });
  };

  /**
   * Discards this page's unsaved work and returns to the sign-in page. Requests already sent cannot
   * be recalled. The server already refused this session, so nothing is claimed about revoking it.
   */
  confirmDiscard = () => {
    if (this.phase.step !== 'confirm-discard') return;
    const notDeleted = this.c.discardAll();
    setSessionUser(null);
    this.set({ step: 'active' });
    this.c.thaw('auth');
    this.deps.onDiscarded(notDeleted);
  };
}
