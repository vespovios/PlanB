// Episode workspace: header (cover on Overview), tabs, and the tab content.
import { useCallback, useEffect, useState } from 'react';
import { formatTime, totalSeconds } from '../../shared/model';
import type { User } from '../api';
import { assetUrl } from '../api';
import { useEpisodeSync } from '../sync';
import { EPISODE_NAV, Shell } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Segmented, TextField, Toast, useMediaQuery } from '../components/ui';
import { href, navigate, type EpisodeTab } from '../router';
import { Banners, PlanTab, SaveStatus, type ToastState } from './Planner';
import { Overview, openQuestions } from '../planner/Overview';
import { ShotsTab } from '../planner/ShotsTab';
import { BoardTab } from '../planner/BoardTab';
import { KitList } from '../planner/KitList';
import { EpisodeBrief } from '../planner/EpisodeBrief';
import { HistoryDialog } from '../planner/History';
import { StoryboardEditor } from '../storyboard/StoryboardEditor';
import { sceneThumbnail } from '../planner/Cards';

export function EpisodePage({ id, tab, user, onSignOut }: { id: string; tab: EpisodeTab; user: User; onSignOut: () => void }) {
  const sync = useEpisodeSync(id);
  const { episode, engine } = sync;
  const mobile = useMediaQuery('(max-width: 760px)');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sketchFor, setSketchFor] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (episode) document.title = `${episode.title} · PlanB`;
  }, [episode?.title]);
  // Keep a valid scene selection shared by the Plan and Shots tabs.
  useEffect(() => {
    if (!episode) return;
    if (!selectedId || !episode.scenes.some((s) => s.id === selectedId)) setSelectedId(episode.scenes[0]?.id ?? null);
  }, [episode, selectedId]);

  const shell = (children: React.ReactNode, more?: React.ReactNode) => (
    <Shell user={user} onSignOut={onSignOut} episodeId={id} tab={tab} switcher={tab === 'overview'} activeEpisodeId={id} mobileMore={more}>
      {children}
    </Shell>
  );

  if (sync.loadError) {
    return shell(
      <main className="center">
        <p className="error">{sync.loadError}</p>
        <a className="btn" href={href.episodes()}>
          Back to episodes
        </a>
      </main>,
    );
  }
  if (!episode) return shell(<div className="boot">Loading episode…</div>);

  const download = async () => {
    await engine.flush();
    window.location.href = `/api/episodes/${episode.id}/export.zip`;
  };
  const setStatus = (status: 'draft' | 'ready') => {
    engine.queue({ op: 'updateEpisode', fields: { status } });
    if (status === 'ready') setToast({ message: 'Marked ready for filming. This version is kept in History; the plan stays editable.' });
  };
  const shots = episode.scenes.flatMap((s) => s.shots);
  const counts: Partial<Record<EpisodeTab, string>> = {
    plan: String(episode.scenes.length),
    shots: String(shots.length),
    storyboard: `${episode.scenes.filter((s) => s.storyboard).length}/${episode.scenes.length}`,
    kit: String((episode.gear ?? []).length),
    notes: String(openQuestions(episode.notes).length || '') || undefined,
  };
  const actions = (
    <div className="ep-actions">
      <a className="btn" href={href.document(episode.id)} title="Printable production pack (print or save as PDF)">
        <Icon name="printer" /> {mobile ? 'Pack' : 'Production pack'}
      </a>
      {!mobile && (
        <>
          <button type="button" className="btn" onClick={download} title="ZIP with plan.json, plan.md, images and editable storyboards, for handing the plan to other tools or people">
            <Icon name="download" /> ZIP
          </button>
          <button type="button" className="btn" onClick={() => setHistoryOpen(true)}>
            <Icon name="history" /> History
          </button>
        </>
      )}
    </div>
  );
  const title = (
    <TextField
      className="ep-title"
      ariaLabel="Episode title"
      required
      wrap={mobile}
      value={episode.title}
      onChange={(v) => engine.queue({ op: 'updateEpisode', fields: { title: v } }, 700)}
      onBlur={() => void engine.flush()}
    />
  );
  const status = (
    <Segmented
      ariaLabel="Episode status"
      value={episode.status}
      options={[
        { value: 'draft', label: 'Draft' },
        { value: 'ready', label: 'Ready for filming' },
      ]}
      onChange={setStatus}
    />
  );
  const covers = episode.scenes.map((s) => sceneThumbnail(s)).filter((x): x is string => !!x);

  const header =
    tab === 'overview' && !mobile ? (
      <header className="ep-cover">
        <div className="ep-cover-strip" aria-hidden>
          {covers.slice(0, 6).map((a) => (
            <img key={a} src={assetUrl(a, 480)} alt="" />
          ))}
        </div>
        <div className="ep-cover-over">
          <div className="ep-cover-top">
            <span className="pill amber">
              <i />
              {episode.status === 'ready' ? 'Ready for filming' : 'Draft'} · revision {episode.revision}
            </span>
            <SaveStatus sync={sync} />
            <span className="spacer" />
            {actions}
          </div>
          {title}
          {episode.brief && <p className="ep-cover-brief">{episode.brief}</p>}
          <div className="ep-cover-status">{status}</div>
        </div>
      </header>
    ) : (
      <header className={`ep-head ${mobile ? 'mobile' : ''}`}>
        <div className="ep-head-main">
          {!mobile && (
            <div className="eyebrow">
              <a href={href.episodes()}>Episodes</a> / {EPISODE_NAV.find((n) => n.tab === tab)?.label}
            </div>
          )}
          {title}
        </div>
        <div className="ep-head-side">
          <SaveStatus sync={sync} />
          {!mobile && status}
          {actions}
        </div>
      </header>
    );

  const sketchScene = episode.scenes.find((s) => s.id === sketchFor);
  const openScene = (sceneId: string) => {
    setSelectedId(sceneId);
    navigate(href.episode(episode.id, 'plan'));
  };

  let content: React.ReactNode;
  switch (tab) {
    case 'plan':
      content = <PlanTab episode={episode} sync={sync} selectedId={selectedId} setSelectedId={setSelectedId} setToast={setToast} />;
      break;
    case 'shots':
      content = <ShotsTab episode={episode} engine={engine} selectedId={selectedId} setSelectedId={setSelectedId} onEditSketch={setSketchFor} />;
      break;
    case 'storyboard':
      content = <BoardTab episode={episode} onEdit={setSketchFor} />;
      break;
    case 'kit':
      content = (
        <section className="tab-page">
          <h2>Kit list</h2>
          <KitList episode={episode} engine={engine} />
        </section>
      );
      break;
    case 'notes':
      content = (
        <section className="tab-page">
          <h2>Brief, outline & notes</h2>
          <EpisodeBrief episode={episode} engine={engine} expanded />
        </section>
      );
      break;
    default:
      content = <Overview episode={episode} onOpenScene={openScene} />;
  }

  return shell(
    <div className={`ep-page tab-${tab}`}>
      {header}
      {!mobile && (
        <nav className="ep-tabs" aria-label="Episode sections">
          {EPISODE_NAV.map((n) => (
            <a key={n.tab} className={tab === n.tab ? 'on' : ''} href={href.episode(episode.id, n.tab)} aria-current={tab === n.tab ? 'page' : undefined}>
              {n.label}
              {counts[n.tab] && <span className="tab-count">{counts[n.tab]}</span>}
            </a>
          ))}
        </nav>
      )}
      {mobile && tab === 'overview' && (
        <div className="ep-mobile-status">
          {status}
          <span className="muted small">
            {episode.scenes.length} scenes · {shots.length} shots · {formatTime(totalSeconds(episode))}
          </span>
        </div>
      )}
      <Banners sync={sync} engine={engine} />
      {content}
      {sketchScene && <StoryboardEditor scene={sketchScene} engine={engine} episodeId={episode.id} onClose={() => setSketchFor(null)} />}
      {historyOpen && <HistoryDialog episodeId={episode.id} engine={engine} onClose={() => setHistoryOpen(false)} onRestored={(message) => setToast({ message })} />}
      {toast && (
        <Toast onClose={closeToast} action={toast.action} timeout={toast.action ? 10_000 : 6000}>
          {toast.message}
        </Toast>
      )}
    </div>,
    <>
      <button type="button" className="btn ghost" onClick={download}>
        <Icon name="download" /> Download ZIP
      </button>
      <button type="button" className="btn ghost" onClick={() => setHistoryOpen(true)}>
        <Icon name="history" /> History
      </button>
    </>,
  );
}
