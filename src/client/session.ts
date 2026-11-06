// Recovering from a lost session (expired, revoked elsewhere, password changed, or the browser
// switched to another account) without losing the work on this page, and without sending it for a
// different account. The page is hidden (not unmounted) until the account is verified.
import { useEffect, useRef } from 'react';
import { api, setSessionUser, type User } from './api';
import { saves as defaultCoordinator, type SaveCoordinator, type SaveReport } from './saves';

export const REAUTHENTICATED = 'planb:reauthenticated';
export const SIGN_IN_TIMEOUT_MS = 15_000;

/** Runs `fn` after the same account signed in again (to redo a read refused while signed out). */
export function useOnReauthenticated(fn: () => void) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const run = () => latest.current();
    window.addEventListener(REAUTHENTICATED, run);
    return () => window.removeEventListener(REAUTHENTICATED, run);
  }, []);
}

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
      me?: () => Promise<{ user: User }>;
      timeoutMs?: number;
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

  /** Bumped per sign-in attempt and when leaving, so a late answer to an abandoned attempt is ignored. */
  private attempt = 0;

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
   * Signs in again as the same account (the e-mail is fixed), waiting at most timeoutMs. Saves
   * resume only once the server confirms that the browser's session now belongs to that account.
   * Returns an error message, or null on success (or if this attempt was abandoned meanwhile).
   */
  signIn = async (password: string): Promise<string | null> => {
    const phase = this.phase;
    if (phase.step !== 'lost') return null;
    const attempt = ++this.attempt;
    const abandoned = () => attempt !== this.attempt || this.phase !== phase;
    const bounded = <T>(p: Promise<T>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('No answer from PlanB. The sign-in may still complete on the server, but this page stays paused until one is confirmed. Try again, or leave without saving.')),
            this.deps.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
          );
        }),
      ]).finally(() => clearTimeout(timer));
    };
    const differs = (u: User) => `That signed in as ${u.email}, not ${phase.user.email}. This page's edits were not sent.`;
    try {
      const { user } = await bounded((this.deps.login ?? api.login)(phase.user.email, password));
      if (abandoned()) return null;
      // Never resume this page's work for another account. Requests still name the original
      // account, so the server refuses them for any other session.
      if (user.id !== phase.user.id) return differs(user);
      // The cookie is shared by every tab and may have changed since: check whom it belongs to now.
      const { user: now } = await bounded((this.deps.me ?? api.me)());
      if (abandoned()) return null;
      if (now.id !== phase.user.id) return differs(now);
    } catch (e) {
      if (abandoned()) return null;
      return (e as Error).message;
    }
    // New session: late answers for the old one are now recognised as stale.
    setSessionUser(phase.user.id);
    this.set({ step: 'active' });
    this.c.reauthenticated();
    // Pages with their own reads (episode list, settings) load again.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(REAUTHENTICATED));
    return null;
  };

  /** Leave without signing in again: shows what would be discarded. */
  askDiscard = () => {
    if (this.phase.step !== 'lost') return;
    this.attempt++; // a sign-in still waiting for an answer no longer counts
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
