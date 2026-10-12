import { useEffect, useState } from 'react';
import { randomId } from '../../shared/ids';
import { formatTime, sceneStarts, totalSeconds, type Episode, type Scene } from '../../shared/model';
import type { SyncSnapshot, EpisodeSync } from '../sync';
import { Segmented, useMediaQuery } from '../components/ui';
import { Timeline } from '../planner/Timeline';
import { Cards } from '../planner/Cards';
import { SceneDetails } from '../planner/SceneDetails';
import { ShotsPanel } from '../planner/Shots';

export type ToastState = { message: string; action?: { label: string; onClick: () => void } } | null;

interface PlanTabProps {
  episode: Episode;
  sync: SyncSnapshot & { engine: EpisodeSync };
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  setToast: (t: ToastState) => void;
}

/** The timeline/cards planner: scene details + shots above, sequence below (cards list on phones). */
export function PlanTab({ episode, sync, selectedId, setSelectedId, setToast }: PlanTabProps) {
  const { engine } = sync;
  const mobile = useMediaQuery('(max-width: 760px)');
  const [view, setView] = useState<'timeline' | 'cards'>(() => (localStorage.getItem('planb:view') as 'cards') || 'timeline');
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => localStorage.setItem('planb:view', view), [view]);

  const scenes = episode.scenes;
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

  const runtime = (
    <span className="runtime">
      <span className="muted">Planned runtime</span> <strong>{formatTime(total)}</strong>
      {episode.targetSeconds ? (
        <span className={`muted target ${total > episode.targetSeconds ? 'over' : ''}`}> / target {formatTime(episode.targetSeconds)}</span>
      ) : null}
    </span>
  );

  return (
    <>
      <main className={mobile ? 'planner mobile' : 'planner'}>
        {mobile ? (
          <section className="mobile-scenes">
            <div className="section-head">
              <h2>Scenes</h2>
              {runtime}
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
    </>
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

export function Banners({ sync, engine }: { sync: SyncSnapshot; engine: EpisodeSync }) {
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
