// Shown when moving to another page (or tab) would drop work that is not confirmed as saved. The
// page stays as it was behind it; nothing moves until the user decides.
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { NavigationGuard } from '../navigation';
import type { SaveIssueKind } from '../saves';
import { Modal } from './ui';
import { useInertApp } from './SignOutDialog';

const RETRYABLE: SaveIssueKind[] = ['queued', 'held', 'offline', 'server', 'inflight', 'direct'];
const noop = () => undefined;

export function LeaveDialog({ guard }: { guard: NavigationGuard }) {
  const phase = useSyncExternalStore(guard.subscribe, guard.getSnapshot);
  useInertApp(phase.step !== 'idle');
  // 'moving': approved, the history step is landing; nothing to ask, the page stays inert meanwhile.
  if (phase.step === 'idle' || phase.step === 'moving') return null;

  let dialog: React.ReactNode;
  if (phase.step === 'saving') {
    dialog = (
      <Modal title="Saving before you leave" onClose={noop}>
        <p role="status">Sending unsaved changes first…</p>
      </Modal>
    );
  } else if (phase.step === 'left') {
    dialog = (
      <Modal
        title="Changes discarded"
        onClose={guard.stay}
        footer={
          <button type="button" className="btn primary" onClick={guard.stay} autoFocus>
            OK
          </button>
        }
      >
        <p role="alert">This browser refused to delete its copy of: {phase.notDeleted.join('; ')}.</p>
      </Modal>
    );
  } else {
    const kinds = phase.report.issues.map((i) => i.kind);
    const scene = phase.scope !== 'page' && phase.scope.zone === 'scene';
    const list = (
      <ul className="signout-issues">
        {phase.report.issues.map((i, n) => (
          <li key={n}>
            {i.count > 1 && i.kind !== 'draft' ? `${i.count} changes: ` : ''}
            {i.message}
          </li>
        ))}
      </ul>
    );
    dialog =
      phase.step === 'blocked' ? (
        <Modal
          title={scene ? 'Leave this scene?' : 'Leave this page?'}
          onClose={guard.stay}
          footer={
            <>
              <button type="button" className="btn danger" onClick={guard.askDiscard}>
                Leave without saving…
              </button>
              {phase.scope === 'page' && kinds.some((k) => RETRYABLE.includes(k)) && (
                <button type="button" className="btn" onClick={() => void guard.retry()}>
                  Retry saving
                </button>
              )}
              <button type="button" className="btn primary" onClick={guard.stay} autoFocus>
                Stay
              </button>
            </>
          }
        >
          <p>You have not left yet. When you tried to, PlanB could not confirm these as saved:</p>
          {list}
          {kinds.some((k) => k === 'inflight' || k === 'direct' || k === 'uncertain') && (
            <p className="muted small">Saves already sent may still complete; PlanB has no answer for them yet.</p>
          )}
          {kinds.includes('conflict') && <p className="muted small">Choose Stay to pick Keep mine or Use newer.</p>}
          {phase.scope !== 'page' && <p className="muted small">Text typed but not added yet, and an open drawing, are not saved automatically.</p>}
        </Modal>
      ) : (
        <Modal
          title="Leave without saving?"
          onClose={guard.back}
          footer={
            <>
              <button type="button" className="btn" onClick={guard.back} autoFocus>
                Back
              </button>
              <button type="button" className="btn danger" onClick={guard.confirmDiscard}>
                Discard and leave
              </button>
            </>
          }
        >
          <p>These are removed from this device and cannot be recovered:</p>
          {list}
          {kinds.some((k) => k === 'inflight' || k === 'direct') && <p className="small">Changes already sent cannot be recalled: the server may still save them.</p>}
          {kinds.some((k) => k === 'draft') && (
            <p className="small">PlanB also deletes the copy of an unsaved drawing kept in this browser, and tells you if it cannot.</p>
          )}
        </Modal>
      );
  }
  return createPortal(dialog, document.body);
}
