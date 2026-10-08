import { useEffect, useState } from 'react';
import type { EpisodeSummary } from '../../shared/model';
import { formatTime } from '../../shared/model';
import { api, type User } from '../api';
import { Confirm, Modal } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { href, navigate } from '../router';

export function EpisodesPage({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EpisodeSummary | null>(null);

  const load = () =>
    api
      .episodes()
      .then((r) => setEpisodes(r.episodes))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="page">
      <TopBar>
        <a className="btn ghost" href={href.settings()}>
          Settings
        </a>
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </TopBar>
      <main className="episodes">
        <div className="episodes-head">
          <div>
            <p className="eyebrow">Signed in as {user.name || user.email}</p>
            <h1>Episodes</h1>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>
            + New episode
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {episodes === null && !error && <p className="muted">Loading…</p>}
        {episodes?.length === 0 && (
          <div className="empty">
            <p>No episodes yet.</p>
            <p className="muted">Start with a title. You can add an outline, scenes and shots in any order.</p>
          </div>
        )}
        <ul className="episode-list">
          {episodes?.map((e) => (
            <li key={e.id} className="episode-item">
              <a href={href.planner(e.id)} className="episode-link">
                <span className="episode-title">{e.title}</span>
                <span className="episode-meta">
                  <span className={`status-chip ${e.status}`}>{e.status === 'ready' ? 'Ready for filming' : 'Draft'}</span>
                  {e.sceneCount} scene{e.sceneCount === 1 ? '' : 's'} · {formatTime(e.totalSeconds)}
                  {e.targetSeconds ? ` of ${formatTime(e.targetSeconds)}` : ''} · updated {new Date(e.updatedAt).toLocaleString()}
                </span>
              </a>
              <button className="icon-btn" aria-label={`Delete ${e.title}`} onClick={() => setDeleting(e)}>
                🗑
              </button>
            </li>
          ))}
        </ul>
      </main>
      {creating && <NewEpisode onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm
          title="Delete episode?"
          message={
            <>
              <p>
                “{deleting.title}” will be removed from your list. The administrator can still recover it from the server for 30 days.
              </p>
            </>
          }
          confirmLabel="Delete episode"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteEpisode(deleting.id).catch((e) => setError(e.message));
            setDeleting(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function NewEpisode({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [example, setExample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="New episode" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const { episode } = await api.createEpisode(title, example);
            navigate(href.planner(episode.id));
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="new-title">Title</label>
          <input id="new-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Heading for the mountains" required />
        </div>
        <label className="check">
          <input type="checkbox" checked={example} onChange={(e) => setExample(e.target.checked)} />
          <span>
            Start with the example opening sequence
            <span className="muted small as-block">Four illustrative motorcycle-trip scenes you can edit or delete.</span>
          </span>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !title.trim()}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
