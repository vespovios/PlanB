import { useCallback, useEffect, useState } from 'react';
import { randomId } from '../../shared/ids';
import { formatTime, sceneStarts, totalSeconds, type Scene } from '../../shared/model';
import { useEpisodeSync, type SyncSnapshot, type EpisodeSync } from '../sync';
import { TopBar } from '../components/TopBar';
import { Disclosure, Segmented, TextField, Toast, useMediaQuery } from '../components/ui';
import { href } from '../router';
import { Timeline } from '../planner/Timeline';
import { Cards } from '../planner/Cards';
import { SceneDetails } from '../planner/SceneDetails';
import { ShotsPanel } from '../planner/Shots';
import { EpisodeBrief } from '../planner/EpisodeBrief';
import { HistoryDialog } from '../planner/History';

type ToastState = { message: string; action?: { label: string; onClick: () => void } } | null;

export function PlannerPage({ id }: { id: string }) {
  const sync = useEpisodeSync(id);
  const { episode, engine } = sync;
  const mobile = useMediaQuery('(max-width: 760px)');
  const [view, setView] = useState<'timeline' | 'cards'>(() => (localStorage.getItem('planb:view') as 'cards') || 'timeline');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => localStorage.setItem('planb:view', view), [view]);
  useEffect(() => {
    if (episode) document.title = `${episode.title} · PlanB`;
  }, [episode?.title]);

  const scenes = episode?.scenes ?? [];
  // Keep a valid selection when scenes are added, removed or replaced by a remote change.
  useEffect(() => {
    if (!episode) return;
    if (!selectedId || !scenes.some((s) => s.id === selectedId)) setSelectedId(scenes[0]?.id ?? null);
  }, [episode, selectedId]);

  if (sync.loadError) {
    return (
      <div className="page">
        <TopBar />
        <main className="center">
          <p className="error">{sync.loadError}</p>
          <a className="btn" href={href.episodes()}>
            Back to episodes
          </a>
        </main>
      </div>
    );
  }
  if (!episode) return <div className="boot">Loading episode…</div>;

  const starts = sceneStarts(episode);
  const total = totalSeconds(episode);
  const selIndex = scenes.findIndex((s) => s.id === selectedId);
  const selected: Scene | undefined = scenes[selIndex];

  const select = (sid: string) => {
    setSelectedId(sid);
    if (mobile) setSheetOpen(true);
  };
  const addScene = () => {
    const sid = randomId('sc');
    const index = selIndex >= 0 ? selIndex + 1 : scenes.length;
    engine.queue({ op: 'addScene', id: sid, index, scene: { title: 'New scene', durationSeconds: 30 } });
    setSelectedId(sid);
    if (mobile) setSheetOpen(true);
  };
  const moveScene = (sid: string, index: number) => engine.queue({ op: 'moveScene', sceneId: sid, index });
  const deleteScene = (scene: Scene) => {
    const index = scenes.findIndex((s) => s.id === scene.id);
    engine.queue({ op: 'deleteScene', sceneId: scene.id });
    setSelectedId(scenes[index + 1]?.id ?? scenes[index - 1]?.id ?? null);
    setSheetOpen(false);
    setToast({
      message: `Deleted “${scene.title}”.`,
      action: {
        label: 'Undo',
        onClick: () => {
          engine.queue({ op: 'restoreDeletedScene', sceneId: scene.id, index });
          setSelectedId(scene.id);
          setToast(null);
        },
      },
    });
  };
  const download = async () => {
    await engine.flush();
    window.location.href = `/api/episodes/${episode.id}/export.zip`;
  };
  const setStatus = (status: 'draft' | 'ready') => {
    engine.queue({ op: 'updateEpisode', fields: { status } });
    if (status === 'ready') setToast({ message: 'Marked ready for filming. This version is kept in History; the plan stays editable.' });
  };

  const actions = (
    <>
      <a className="btn ghost" href={href.checklist(episode.id)}>
        Filming checklist
      </a>
      <a className="btn ghost" href={href.document(episode.id)} title="Formatted plan to print or save as PDF">
        Plan document
      </a>
      <button type="button" className="btn ghost" onClick={download} title="ZIP with plan.json, plan.md, images and editable storyboards, for handing the plan to other tools or people">
        Download ZIP
      </button>
      <button type="button" className="btn ghost" onClick={() => setHistoryOpen(true)}>
        History
      </button>
    </>
  );

  const runtime = (
    <span className="runtime">
      <span className="muted">Planned runtime</span> <strong>{formatTime(total)}</strong>
      {episode.targetSeconds ? (
        <span className={`muted target ${total > episode.targetSeconds ? 'over' : ''}`}> / target {formatTime(episode.targetSeconds)}</span>
      ) : null}
    </span>
  );

  const header = (
    <section className="episode-card">
      <div className="episode-card-main">
        <p className="eyebrow">Episode outline · {episode.status === 'ready' ? 'Ready for filming' : 'Draft'}</p>
        <TextField className="episode-title" ariaLabel="Episode title" required value={episode.title} onChange={(v) => engine.queue({ op: 'updateEpisode', fields: { title: v } }, 700)} onBlur={() => void engine.flush()} />
        {episode.brief && !mobile && <p className="brief-line muted">{episode.brief}</p>}
      </div>
      <div className="episode-card-side">
        <Segmented
          ariaLabel="Episode status"
          value={episode.status}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'ready', label: 'Ready for filming' },
          ]}
          onChange={setStatus}
        />
        {mobile && runtime}
      </div>
      <div className="episode-card-brief">
        <Disclosure label="Brief, outline & notes" filled={!mobile && scenes.length === 0}>
          <EpisodeBrief episode={episode} engine={engine} />
        </Disclosure>
      </div>
    </section>
  );

  return (
    <div className={`page planner-page ${mobile ? 'is-mobile' : ''}`}>
      <TopBar
        crumb={
          <>
            <a href={href.episodes()}>Episodes</a> <span className="muted">/</span> <span className="crumb-title">{episode.title}</span>
          </>
        }
      >
        <SaveStatus sync={sync} />
        {mobile ? (
          <div className="menu-wrap">
            <button type="button" className="btn ghost" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              ⋯
            </button>
            {menuOpen && (
              <div className="menu" role="menu" onClick={() => setMenuOpen(false)}>
                {actions}
                <a className="btn ghost" href={href.episodes()}>
                  All episodes
                </a>
              </div>
            )}
          </div>
        ) : (
          actions
        )}
      </TopBar>

      <Banners sync={sync} engine={engine} />

      <main className={mobile ? 'planner mobile' : 'planner'}>
        {header}
        {mobile ? (
          <section className="mobile-scenes">
            <div className="section-head">
              <h2>Scenes</h2>
              <span className="muted small">Story order · tap a scene to edit</span>
            </div>
            <Cards scenes={scenes} selectedId={null} onSelect={select} onMove={moveScene} layout="list" />
            <button type="button" className="btn primary full add-scene-mobile" onClick={addScene}>
              + Scene
            </button>
          </section>
        ) : (
          <>
            <section className="workspace">
              {selected ? (
                <>
                  <div className="panel left">
                    <SceneDetails
                      key={selected.id}
                      scene={selected}
                      index={selIndex}
                      start={starts[selIndex]}
                      count={scenes.length}
                      engine={engine}
                      episodeId={episode.id}
                      onDelete={() => deleteScene(selected)}
                      onMove={(i) => moveScene(selected.id, i)}
                    />
                  </div>
                  <div className="panel right">
                    <ShotsPanel scene={selected} engine={engine} gear={episode.gear ?? []} />
                  </div>
                </>
              ) : (
                <div className="panel empty-workspace">
                  <h3>Start with a scene</h3>
                  <p className="muted">A scene only needs a title and a planned duration. Everything else is optional and can come later.</p>
                  <button type="button" className="btn primary" onClick={addScene}>
                    + Scene
                  </button>
                </div>
              )}
            </section>
            <section className="sequence">
              <div className="sequence-head">
                <div>
                  <h2>{view === 'timeline' ? 'Scene timeline' : 'Scene cards'}</h2>
                  <p className="muted">Story order</p>
                </div>
                <Segmented
                  ariaLabel="View"
                  value={view}
                  options={[
                    { value: 'timeline', label: 'Timeline' },
                    { value: 'cards', label: 'Cards' },
                  ]}
                  onChange={setView}
                />
                {runtime}
              </div>
              {view === 'timeline' ? (
                <Timeline
                  scenes={scenes}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onResize={(sid, secs) => engine.queue({ op: 'updateScene', sceneId: sid, fields: { durationSeconds: secs } })}
                  onMove={moveScene}
                />
              ) : (
                <Cards scenes={scenes} selectedId={selectedId} onSelect={setSelectedId} onMove={moveScene} layout="grid" />
              )}
              <div className="sequence-foot">
                <span className="muted">
                  {selected ? `S${String(selIndex + 1).padStart(2, '0')} · ${formatTime(starts[selIndex])}–${formatTime(starts[selIndex] + selected.durationSeconds)}` : ''}
                </span>
                <span className="spacer" />
                <button type="button" className="btn" disabled={!selected || selIndex === 0} onClick={() => selected && moveScene(selected.id, selIndex - 1)}>
                  Move earlier
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={!selected || selIndex === scenes.length - 1}
                  onClick={() => selected && moveScene(selected.id, selIndex + 1)}
                >
                  Move later
                </button>
                <button type="button" className="btn" onClick={addScene}>
                  + Scene
                </button>
              </div>
            </section>
          </>
        )}
      </main>

      {mobile && sheetOpen && selected && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label={`Scene: ${selected.title}`}>
          <div className="sheet-head">
            <button type="button" className="btn ghost" onClick={() => setSheetOpen(false)}>
              ← Scenes
            </button>
            <SaveStatus sync={sync} />
          </div>
          <div className="sheet-body">
            <SceneDetails
              key={selected.id}
              scene={selected}
              index={selIndex}
              start={starts[selIndex]}
              count={scenes.length}
              engine={engine}
              episodeId={episode.id}
              onDelete={() => deleteScene(selected)}
              onMove={(i) => moveScene(selected.id, i)}
            />
            <hr />
            <ShotsPanel scene={selected} engine={engine} gear={episode.gear ?? []} />
          </div>
        </div>
      )}

      {historyOpen && (
        <HistoryDialog
          episodeId={episode.id}
          engine={engine}
          onClose={() => setHistoryOpen(false)}
          onRestored={(message) => setToast({ message })}
        />
      )}
      {toast && <Toast onClose={closeToast} action={toast.action} timeout={toast.action ? 10_000 : 6000}>{toast.message}</Toast>}
    </div>
  );
}

export function SaveStatus({ sync }: { sync: SyncSnapshot & { engine: EpisodeSync } }) {
  const labels: Record<SyncSnapshot['state'], string> = {
    loading: 'Loading…',
    saved: 'Saved',
    pending: 'Unsaved changes',
    saving: 'Saving…',
    offline: 'Not saved: offline',
    error: 'Not saved',
  };
  return (
    <span className={`save-status ${sync.state}`} role="status" aria-live="polite" title={sync.error ?? undefined}>
      <span className="dot" aria-hidden />
      {labels[sync.state]}
      {(sync.state === 'offline' || sync.state === 'error') && (
        <button type="button" className="link-btn" onClick={() => sync.engine.retry()}>
          Retry
        </button>
      )}
    </span>
  );
}

function Banners({ sync, engine }: { sync: SyncSnapshot; engine: EpisodeSync }) {
  return (
    <>
      {sync.conflict && (
        <div className="banner warn" role="alert">
          <div>
            <strong>Changed elsewhere while you were editing.</strong> A newer version (e.g. from your agent or another device) changed the same field
            {sync.conflict.items.length > 1 ? 's' : ''}:
            <ul>
              {sync.conflict.items.map((c, i) => (
                <li key={i}>
                  {c.label}: yours “{String(c.mine ?? '')}”, newer “{String(c.theirs ?? '')}”
                </li>
              ))}
            </ul>
          </div>
          <div className="row">
            <button type="button" className="btn small primary" onClick={() => engine.resolveConflict('mine')}>
              Keep mine
            </button>
            <button type="button" className="btn small" onClick={() => engine.resolveConflict('theirs')}>
              Use newer
            </button>
          </div>
        </div>
      )}
      {sync.error && (
        <div className={`banner ${sync.state === 'offline' ? 'warn' : 'error'}`} role="alert">
          <span>
            {sync.error}
            {sync.state === 'offline' && ' Your edits are kept on this page and will be sent when the connection returns.'}
          </span>
          <div className="row">
            <button type="button" className="btn small" onClick={() => engine.retry()}>
              Retry now
            </button>
            {sync.state !== 'offline' && (
              <button type="button" className="btn small" onClick={() => engine.dismissError()}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}
      {sync.notice && (
        <div className="banner info" role="status">
          <span>{sync.notice}</span>
          <button type="button" className="btn small" onClick={() => engine.dismissNotice()}>
            OK
          </button>
        </div>
      )}
    </>
  );
}
