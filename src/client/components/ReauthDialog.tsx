// Shown when the server no longer accepts this page's session. The page stays mounted as it was
// (paused, and hidden until the account is verified); only the same account can resume it.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { SessionRecovery } from '../session';
import { Modal } from './ui';
import { useInertApp } from './SignOutDialog';

const noop = () => undefined;

export function ReauthDialog({ recovery }: { recovery: SessionRecovery }) {
  const phase = useSyncExternalStore(recovery.subscribe, recovery.getSnapshot);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paused = phase.step !== 'active';
  useInertApp(paused);
  // Hidden, not unmounted: whoever is at the screen has not shown they are this account.
  useEffect(() => {
    const root = document.getElementById('root');
    if (!paused || !root) return;
    root.classList.add('concealed');
    return () => root.classList.remove('concealed');
  }, [paused]);
  if (phase.step === 'active') return null;
  const who = phase.user.name ? `${phase.user.name} (${phase.user.email})` : phase.user.email;

  const dialog =
    phase.step === 'lost' ? (
      <Modal
        title="Sign in again to keep working"
        onClose={noop}
        footer={
          <>
            <button type="button" className="btn danger" onClick={recovery.askDiscard}>
              Leave without saving…
            </button>
            <button type="submit" form="reauth-form" className="btn primary" disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </>
        }
      >
        <p>
          {phase.switched
            ? 'This browser is now signed in to a different account (perhaps in another tab).'
            : 'PlanB no longer accepts this sign-in (it expired, was signed out elsewhere, or the password changed).'}{' '}
          New saves are paused. This page’s work is kept, hidden, until you sign in again as {who}; then unsaved edits are retried (some may meet newer
          changes and ask you to choose). Requests sent before this may still finish.
        </p>
        <form
          id="reauth-form"
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            const problem = await recovery.signIn(password);
            setBusy(false);
            setError(problem);
            if (!problem) setPassword('');
          }}
        >
          <div className="field">
            <label htmlFor="reauth-email">E-mail</label>
            <input id="reauth-email" type="email" autoComplete="username" value={phase.user.email} readOnly />
          </div>
          <div className="field">
            <label htmlFor="reauth-password">Password</label>
            <input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
        <p className="muted small">To use a different account, leave without saving first. This page’s edits are not sent for another account.</p>
      </Modal>
    ) : (
      <Modal
        title="Leave without saving?"
        onClose={recovery.back}
        footer={
          <>
            <button type="button" className="btn" onClick={recovery.back} autoFocus>
              Back
            </button>
            <button type="button" className="btn danger" onClick={recovery.confirmDiscard}>
              Discard and leave
            </button>
          </>
        }
      >
        <p>These are removed from this device and cannot be recovered:</p>
        <ul className="signout-issues">
          {phase.report.issues.map((i, n) => (
            <li key={n}>
              {i.count > 1 && i.kind !== 'draft' ? `${i.count} changes: ` : ''}
              {i.message}
            </li>
          ))}
        </ul>
        {phase.report.outcome === 'confirmed' && <p>Nothing on this page is waiting to be saved.</p>}
        <p className="small">Changes already sent cannot be recalled: the server may still save them. PlanB also deletes the copy of an unsaved drawing kept in this browser, and tells you if it cannot.</p>
      </Modal>
    );
  return createPortal(dialog, document.body);
}
