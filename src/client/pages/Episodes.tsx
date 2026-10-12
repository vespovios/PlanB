import { useEffect, useState } from 'react';
import { formatTime, type EpisodeSummary } from '../../shared/model';
import { api, assetUrl, type User } from '../api';
import { Confirm } from '../components/ui';
import { Icon, Ring } from '../components/Icon';
import { NewEpisodeModal, Shell } from '../components/Shell';
import { href } from '../router';

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
    <Shell user={user} onSignOut={onSignOut}>
      <main className="episodes">
        <div className="episodes-head">
          <div>
            <p className="eyebrow">Signed in as {user.name || user.email}</p>
            <h1>Episodes</h1>
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New episode
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {episodes === null && !error && <p className="muted">Loading…</p>}
        {episodes?.length === 0 && (
          <div className="empty">
            <p>No episodes yet.</p>
            <p className="muted">Start with a title. You can add an outline, scenes and shots in any order, or ask your agent for a first draft.</p>
          </div>
        )}
        <ul className="episode-grid">
          {episodes?.map((e) => (
            <li key={e.id} className="episode-card-item">
              <a href={href.episode(e.id)} className="episode-link">
                <span className="episode-cover">
                  {e.coverAssetIds.length ? (
                    e.coverAssetIds.slice(0, 3).map((a) => <img key={a} src={assetUrl(a, 320)} alt="" />)
                  ) : (
                    <span className="episode-cover-empty">
                      <Icon name="sparkle" size={22} />
                    </span>
                  )}
                </span>
                <span className="episode-body">
                  <span className="episode-title">{e.title}</span>
                  <span className="episode-meta">
                    <span className={`pill ${e.status === 'ready' ? 'green' : e.sceneCount ? 'amber' : 'grey'}`}>
                      <i />
                      {e.status === 'ready' ? 'Ready for filming' : e.sceneCount ? 'Draft' : 'Idea'}
                    </span>
                    {e.sceneCount} scene{e.sceneCount === 1 ? '' : 's'} · updated {new Date(e.updatedAt).toLocaleDateString()}
                  </span>
                  <span className="episode-stats">
                    <span>
                      <Ring value={e.targetSeconds ? e.totalSeconds / e.targetSeconds : 0} colour={e.targetSeconds && e.totalSeconds > e.targetSeconds ? '#d4504f' : '#2e9e57'} size={28} stroke={3} />
                      {formatTime(e.totalSeconds)}
                      {e.targetSeconds ? <span className="muted"> / {formatTime(e.targetSeconds)}</span> : null}
                    </span>
                    <span>
                      <Ring value={e.shotCount ? e.capturedCount / e.shotCount : 0} colour="#3a7bd5" size={28} stroke={3} />
                      {e.capturedCount}/{e.shotCount} shots
                    </span>
                    <span>
                      <Ring value={e.sceneCount ? e.storyboardCount / e.sceneCount : 0} colour="#9a5bd3" size={28} stroke={3} />
                      {e.storyboardCount}/{e.sceneCount} sketches
                    </span>
                  </span>
                </span>
              </a>
              <button className="icon-btn episode-delete" aria-label={`Delete ${e.title}`} onClick={() => setDeleting(e)}>
                🗑
              </button>
            </li>
          ))}
        </ul>
      </main>
      {creating && <NewEpisodeModal onClose={() => setCreating(false)} />}
      {deleting && (
        <Confirm
          title="Delete episode?"
          message={<p>“{deleting.title}” will be removed from your list. The administrator can still recover it from the server for 30 days.</p>}
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
    </Shell>
  );
}
