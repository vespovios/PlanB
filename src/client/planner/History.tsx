import { useEffect, useState } from 'react';
import type { RevisionInfo } from '../../shared/model';
import { api, ApiError } from '../api';
import type { EpisodeSync } from '../sync';
import { Confirm, Modal } from '../components/ui';

type Reverted = { revision: number; authorLabel: string; summary: string }[];

/** Revision history with undo/restore. Restoring creates a new revision; nothing is erased. */
export function HistoryDialog({ episodeId, engine, onClose, onRestored }: { episodeId: string; engine: EpisodeSync; onClose: () => void; onRestored: (msg: string) => void }) {
  const [revisions, setRevisions] = useState<RevisionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The confirmation is tied to the revision it was shown for: if anything new is saved while the
  // dialog is open, the server rejects the stale base and the list is shown again.
  const [pending, setPending] = useState<{ target: number; base: number; reverted: Reverted } | null>(null);

  const load = () =>
    api
      .revisions(episodeId)
      .then((r) => setRevisions(r.revisions))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const restore = async (target: number, acknowledgedBase?: number) => {
    setError(null);
    let base = acknowledgedBase ?? 0;
    try {
      if (acknowledgedBase === undefined) {
        await engine.flush();
        if (engine.hasUnsaved) {
          setError('Some edits are not saved yet (or need a Keep mine / Use newer choice). Resolve them first so a restore cannot discard them.');
          return;
        }
        base = engine.confirmed!.revision;
      }
      const { episode } = await api.restore(episodeId, target, base, acknowledgedBase !== undefined);
      engine.adopt(episode);
      setPending(null);
      onRestored(`Restored the episode as it was at revision ${target}. This is saved as revision ${episode.revision}; nothing was erased.`);
      void load();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body.code === 'later_revisions') {
        setPending({ target, base, reverted: err.body.revertedRevisions as Reverted });
      } else if (err.status === 409) {
        setPending(null);
        setError('The episode changed while you were looking (a newer revision was saved). The list has been refreshed; please choose again.');
        await engine.refresh();
        void load();
      } else setError(err.message);
    }
  };

  const latest = revisions?.[0]?.revision;
  return (
    <Modal title="History" onClose={onClose} wide>
      <p className="muted small">
        Every save by you or your agent is a revision. <strong>Undo</strong> returns the episode to how it was before that change;{' '}
        <strong>Go back here</strong> returns to that exact version. Both save a new revision, so you can always change your mind.
      </p>
      {error && <p className="error">{error}</p>}
      {!revisions && !error && <p className="muted">Loading…</p>}
      <ol className="history">
        {revisions?.map((r) => (
          <li key={r.revision} className={r.authorKind === 'agent' ? 'agent' : ''}>
            <div className="history-main">
              <span className="history-rev">#{r.revision}</span>
              <span className={`author ${r.authorKind}`}>{r.authorLabel}</span>
              <span className="history-summary">{r.summary}</span>
              <span className="muted small">{new Date(r.createdAt).toLocaleString()}</span>
            </div>
            <div className="history-actions">
              {r.revision > 1 && (
                <button type="button" className="btn small" onClick={() => restore(r.revision - 1)}>
                  Undo
                </button>
              )}
              {r.revision !== latest && (
                <button type="button" className="btn small" onClick={() => restore(r.revision)}>
                  Go back here
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {pending && (
        <Confirm
          title="Later changes will also be reverted"
          message={
            <>
              <p>Going back to revision {pending.target} also reverts these later changes:</p>
              <ul className="reverted">
                {pending.reverted.map((r) => (
                  <li key={r.revision}>
                    #{r.revision} · {r.authorLabel}: {r.summary}
                  </li>
                ))}
              </ul>
              <p className="muted small">They stay in History and can be restored again.</p>
            </>
          }
          confirmLabel="Revert all of these"
          danger
          onCancel={() => setPending(null)}
          onConfirm={() => restore(pending.target, pending.base)}
        />
      )}
    </Modal>
  );
}
