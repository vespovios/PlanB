// App shell: dark icon rail, optional episode switcher panel, and the phone tab bar.
import { useEffect, useState, type ReactNode } from 'react';
import { formatTime, type EpisodeSummary } from '../../shared/model';
import { api, assetUrl, type User } from '../api';
import { href, navigate, type EpisodeTab } from '../router';
import { Icon, type IconName } from './Icon';
import { Modal, useMediaQuery } from './ui';

export const EPISODE_NAV: { tab: EpisodeTab; label: string; icon: IconName }[] = [
  { tab: 'overview', label: 'Overview', icon: 'overview' },
  { tab: 'plan', label: 'Plan', icon: 'timeline' },
  { tab: 'shots', label: 'Shots', icon: 'list' },
  { tab: 'storyboard', label: 'Storyboard', icon: 'board' },
  { tab: 'kit', label: 'Kit', icon: 'bag' },
  { tab: 'notes', label: 'Notes', icon: 'notes' },
];

interface ShellProps {
  user: User;
  onSignOut: () => void;
  /** When inside an episode: its ID and active tab (for rail and tab bar). */
  episodeId?: string;
  tab?: EpisodeTab | 'checklist' | 'document';
  /** Show the episode switcher panel (desktop). */
  switcher?: boolean;
  activeEpisodeId?: string;
  /** Bumped to make the switcher reload its list. */
  switcherKey?: number;
  children: ReactNode;
  mobileMore?: ReactNode;
}

export function Shell(props: ShellProps) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const wide = useMediaQuery('(min-width: 1180px)');
  return (
    <div className={`shell ${mobile ? 'is-mobile' : ''}`}>
      {!mobile && <Rail {...props} />}
      {!mobile && props.switcher && wide && <EpisodeSwitcher activeId={props.activeEpisodeId} reloadKey={props.switcherKey} />}
      <div className="shell-main">{props.children}</div>
      {mobile && props.episodeId && <MobileTabBar episodeId={props.episodeId} tab={props.tab} more={props.mobileMore} />}
    </div>
  );
}

function Rail({ user, onSignOut, episodeId, tab }: ShellProps) {
  const [menu, setMenu] = useState(false);
  return (
    <nav className="rail" aria-label="Main">
      <a className="rail-logo" href={href.episodes()} aria-label="PlanB episodes" title="All episodes">
        <img src="/brand/icon-192.png" alt="" width={40} height={40} />
      </a>
      <a className={`rail-link ${!episodeId ? 'on' : ''}`} href={href.episodes()} title="All episodes" aria-label="All episodes">
        <Icon name="film" />
      </a>
      {episodeId && (
        <>
          <span className="rail-sep" />
          {EPISODE_NAV.map((n) => (
            <a key={n.tab} className={`rail-link ${tab === n.tab ? 'on' : ''}`} href={href.episode(episodeId, n.tab)} title={n.label} aria-label={n.label}>
              <Icon name={n.icon} />
            </a>
          ))}
          <span className="rail-sep" />
          <a className={`rail-link ${tab === 'checklist' ? 'on' : ''}`} href={href.checklist(episodeId)} title="Filming checklist" aria-label="Filming checklist">
            <Icon name="check" />
          </a>
          <a className={`rail-link ${tab === 'document' ? 'on' : ''}`} href={href.document(episodeId)} title="Production pack" aria-label="Production pack">
            <Icon name="printer" />
          </a>
        </>
      )}
      <span className="rail-spacer" />
      <a className="rail-link" href={href.settings()} title="Settings" aria-label="Settings">
        <Icon name="gear" />
      </a>
      <div className="rail-user">
        <button type="button" className="avatar" aria-label={`Account: ${user.name || user.email}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {(user.name || user.email).slice(0, 1).toUpperCase()}
        </button>
        {menu && (
          <div className="rail-menu" role="menu">
            <div className="rail-menu-head">
              <span className="muted small">Signed in as</span>
              <b>{user.name || 'you'}</b>
            </div>
            <a className="btn ghost" href={href.settings()}>
              <Icon name="gear" /> Settings
            </a>
            <button type="button" className="btn ghost" onClick={onSignOut}>
              <Icon name="logout" /> Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

export function EpisodeSwitcher({ activeId, reloadKey }: { activeId?: string; reloadKey?: number }) {
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    api
      .episodes()
      .then((r) => setEpisodes(r.episodes))
      .catch(() => setEpisodes([]));
  }, [reloadKey, activeId]);
  const q = query.trim().toLowerCase();
  const shown = (episodes ?? []).filter((e) => !q || e.title.toLowerCase().includes(q));
  const groups: [string, EpisodeSummary[]][] = [
    ['In progress', shown.filter((e) => e.sceneCount > 0)],
    ['Ideas', shown.filter((e) => e.sceneCount === 0)],
  ];
  return (
    <aside className="switcher" aria-label="Episodes">
      <div className="switcher-head">
        <h2>Episodes</h2>
        <button type="button" className="btn small primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} /> New
        </button>
      </div>
      <label className="search-field">
        <Icon name="search" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search episodes" />
      </label>
      {episodes === null && <p className="muted small">Loading…</p>}
      {groups.map(([label, list]) =>
        list.length ? (
          <div key={label}>
            <div className="eyebrow switcher-group">{label}</div>
            {list.map((e) => (
              <a key={e.id} href={href.episode(e.id)} className={`switcher-item ${e.id === activeId ? 'on' : ''}`}>
                {e.coverAssetIds[0] ? (
                  <img src={assetUrl(e.coverAssetIds[0], 160)} alt="" />
                ) : (
                  <span className="switcher-ph">
                    <Icon name="sparkle" />
                  </span>
                )}
                <span>
                  <b>{e.title}</b>
                  <span>
                    {e.sceneCount} scene{e.sceneCount === 1 ? '' : 's'} · {formatTime(e.totalSeconds)} · {e.status === 'ready' ? 'Ready' : 'Draft'}
                  </span>
                </span>
              </a>
            ))}
          </div>
        ) : null,
      )}
      {creating && <NewEpisodeModal onClose={() => setCreating(false)} />}
    </aside>
  );
}

export function NewEpisodeModal({ onClose }: { onClose: () => void }) {
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
            onClose();
            navigate(href.episode(episode.id, example ? 'overview' : 'plan'));
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

function MobileTabBar({ episodeId, tab, more }: { episodeId: string; tab?: string; more?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const items = EPISODE_NAV.filter((n) => ['overview', 'plan', 'shots', 'storyboard'].includes(n.tab));
  return (
    <>
      <nav className="tabbar" aria-label="Episode sections">
        {items.map((n) => (
          <a key={n.tab} className={tab === n.tab ? 'on' : ''} href={href.episode(episodeId, n.tab)}>
            <Icon name={n.icon} size={22} />
            <span>{n.tab === 'storyboard' ? 'Board' : n.label}</span>
          </a>
        ))}
        <button type="button" className={!items.some((n) => n.tab === tab) ? 'on' : ''} onClick={() => setOpen(true)} aria-label="More">
          <Icon name="more" size={22} />
          <span>More</span>
        </button>
      </nav>
      {open && (
        <div className="more-sheet" role="dialog" aria-label="More" onClick={() => setOpen(false)}>
          <div className="more-panel" onClick={(e) => e.stopPropagation()}>
            <a className="btn ghost" href={href.episode(episodeId, 'kit')} onClick={() => setOpen(false)}>
              <Icon name="bag" /> Kit list
            </a>
            <a className="btn ghost" href={href.episode(episodeId, 'notes')} onClick={() => setOpen(false)}>
              <Icon name="notes" /> Brief, outline & notes
            </a>
            <a className="btn ghost" href={href.checklist(episodeId)}>
              <Icon name="check" /> Filming checklist
            </a>
            <a className="btn ghost" href={href.document(episodeId)}>
              <Icon name="printer" /> Production pack
            </a>
            {more}
            <a className="btn ghost" href={href.episodes()}>
              <Icon name="film" /> All episodes
            </a>
            <a className="btn ghost" href={href.settings()}>
              <Icon name="gear" /> Settings
            </a>
          </div>
        </div>
      )}
    </>
  );
}
