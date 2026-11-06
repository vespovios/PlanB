// The sign-out dialog: shown while signing out saves first, when something is not saved, and when
// the server did not confirm the sign-out. The rest of the app is inert meanwhile.
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import type { SaveIssueKind, SaveReport } from '../saves';
import { SignOutFlow } from '../signout';
import { Modal } from './ui';

/** One sign-out flow for the app; `onSignedOut` runs only after the server confirmed it. */
export function useSignOut(onSignedOut: () => void) {
  const latest = useRef(onSignedOut);
  latest.current = onSignedOut;
  return useMemo(() => new SignOutFlow({ logout: () => api.logout(), onSignedOut: () => latest.current() }), []);
}

const RETRYABLE: SaveIssueKind[] = ['queued', 'held', 'offline', 'server', 'inflight', 'direct'];
const noop = () => undefined;

function Issues({ report }: { report: SaveReport }) {
  return (
    <ul className="signout-issues">
      {report.issues.map((i, n) => (
        <li key={n} className={`is-${i.outcome}`}>
          {i.count > 1 && i.kind !== 'draft' ? `${i.count} changes: ` : ''}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

export function SignOutDialog({ flow }: { flow: SignOutFlow }) {
  const phase = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  const busy = phase.step !== 'idle';
  // Nothing behind the dialog can be edited or focused while signing out.
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    root.inert = busy;
    return () => {
      root.inert = false;
    };
  }, [busy]);
  if (!busy) return null;

  let dialog: React.ReactNode;
  switch (phase.step) {
    case 'saving':
    case 'signing-out':
      dialog = (
        <Modal title="Signing out" onClose={noop}>
          <p role="status">{phase.step === 'saving' ? 'Sending unsaved changes first…' : 'Signing out…'}</p>
        </Modal>
      );
      break;
    case 'blocked': {
      const kinds = phase.report.issues.map((i) => i.kind);
      dialog = (
        <Modal
          title="Some changes are not confirmed as saved"
          onClose={flow.stay}
          footer={
            <>
              <button type="button" className="btn danger" onClick={flow.askDiscard}>
                Sign out without saving…
              </button>
              {kinds.some((k) => RETRYABLE.includes(k)) && (
                <button type="button" className="btn" onClick={() => void flow.retry()}>
                  Retry saving
                </button>
              )}
              <button type="button" className="btn primary" onClick={flow.stay} autoFocus>
                Stay
              </button>
            </>
          }
        >
          <p>Sign-out has not been requested. When you chose Sign out, PlanB could not confirm these as saved:</p>
          <Issues report={phase.report} />
          {kinds.some((k) => k === 'inflight' || k === 'direct' || k === 'uncertain') && (
            <p className="muted small">Saves already sent may still complete; PlanB has no answer for them yet.</p>
          )}
          {kinds.includes('auth') && <p className="muted small">The server answered some saves as signed out, so those edits cannot be saved from this page.</p>}
          {kinds.includes('conflict') && <p className="muted small">Choose Stay to pick Keep mine or Use newer.</p>}
        </Modal>
      );
      break;
    }
    case 'confirm': {
      const { issues } = phase.report;
      const has = (...k: SaveIssueKind[]) => issues.some((i) => k.includes(i.kind));
      dialog = (
        <Modal
          title="Sign out without saving?"
          onClose={flow.back}
          footer={
            <>
              <button type="button" className="btn" onClick={flow.back} autoFocus>
                Back
              </button>
              <button type="button" className="btn danger" onClick={() => void flow.confirmDiscard()}>
                Discard and sign out
              </button>
            </>
          }
        >
          <p>These are removed from this device once PlanB confirms you are signed out. They cannot be recovered.</p>
          <Issues report={phase.report} />
          {has('inflight', 'direct') && <p className="small">Changes already sent cannot be recalled: the server may still save them.</p>}
          {has('rejected', 'uncertain') && <p className="small">Messages about changes that were not saved, or may not have been, are dismissed.</p>}
          {issues.some((i) => i.kind === 'draft' && /kept in this browser/.test(i.message)) && (
            <p className="small">PlanB also deletes the copy of an unsaved drawing kept in this browser, and tells you if it cannot.</p>
          )}
        </Modal>
      );
      break;
    }
    case 'signed-out':
      dialog = (
        <Modal
          title="Signed out"
          onClose={flow.stay}
          footer={
            <button type="button" className="btn primary" onClick={flow.stay} autoFocus>
              OK
            </button>
          }
        >
          <p role="alert">
            You are signed out. This browser refused to delete its copy of: {phase.notDeleted.join('; ')}. Anyone using this browser profile may be able to
            restore it; clear this site’s data in the browser settings to remove it.
          </p>
        </Modal>
      );
      break;
    case 'unconfirmed':
      dialog = (
        <Modal
          title="Could not confirm sign-out"
          onClose={flow.stay}
          footer={
            <>
              <button type="button" className="btn" onClick={flow.stay}>
                Stay
              </button>
              <button type="button" className="btn primary" onClick={() => void flow.tryAgain()} autoFocus>
                Try again
              </button>
            </>
          }
        >
          <p role="alert">
            PlanB did not confirm that you are signed out ({phase.message}). This device may or may not still be signed in. New saves are paused; requests
            already sent may still complete.
          </p>
          {phase.discard && <p className="small">Your unsaved changes have not been discarded.</p>}
        </Modal>
      );
      break;
  }
  return createPortal(dialog, document.body);
}
