import { useState } from 'react';
import { buildChecklist, filmSlot, type ChecklistOrder } from '../../shared/checklist';
import { capturedCount, formatTime, outcomeCounts, outcomeSummary, totalSeconds, type Shot } from '../../shared/model';
import { JournalRefs, OutcomeControl, SkipReason } from '../components/Outcome';
import { assetUrl, type User } from '../api';
import { Shell } from '../components/Shell';
import { useEpisodeSync } from '../sync';
import { TopBar } from '../components/TopBar';
import { Logo, Segmented } from '../components/ui';
import { href } from '../router';
import { SaveStatus } from './Planner';

/** Filming checklist: derived from the same scenes and shots, readable on a phone and printable. */
export function ChecklistPage({ id, user, onSignOut }: { id: string; user: User; onSignOut: () => void }) {
  const sync = useEpisodeSync(id);
  const { episode, engine } = sync;
  const [order, setOrder] = useState<ChecklistOrder>('story');
  const [sketches, setSketches] = useState(true);
  const [details, setDetails] = useState(true);

  if (sync.loadError) return <p className="error center">{sync.loadError}</p>;
  if (!episode) return <div className="boot">Loading checklist…</div>;
  const groups = buildChecklist(episode, order);
  const hasLocations = episode.scenes.some((s) => s.location.trim());
  const hasSlots = episode.scenes.some((s) => s.filmDay || s.filmStop);
  const byLocation = order === 'location';
  const allShots = episode.scenes.flatMap((s) => s.shots);
  const setOutcome = (sceneId: string, shot: Shot, fields: Partial<Shot>) =>
    engine.queue({ op: 'updateShot', sceneId, shotId: shot.id, fields: fields as never });

  return (
    <Shell user={user} onSignOut={onSignOut} episodeId={id} tab="checklist">
    <div className="page checklist-page">
      <TopBar
        crumb={
          <>
            <a href={href.planner(episode.id)}>← {episode.title}</a>
          </>
        }
      >
        <SaveStatus sync={sync} />
        <button type="button" className="btn ghost" onClick={() => window.print()}>
          Print / PDF
        </button>
      </TopBar>
      <main className="checklist">
        <header className="checklist-head">
          <Logo size="md" />
          <p className="eyebrow">Filming checklist</p>
          <h1>{episode.title}</h1>
          <p className="muted">
            {episode.scenes.length} scenes · planned {formatTime(totalSeconds(episode))} · {outcomeSummary(outcomeCounts(allShots))} ·
            revision {episode.revision} · {new Date(episode.updatedAt).toLocaleString()}
          </p>
          <p className="muted small print-note">
            ○ open · ✓ filmed (reported, not reviewed) · ✕ skipped on purpose (no footage). Scene numbers follow story order{order === 'filming' ? '; listed in filming order (day, then stop)' : ''}.
          </p>
          <div className="checklist-options no-print">
            <Segmented<ChecklistOrder>
              ariaLabel="Checklist order"
              value={order}
              options={[
                { value: 'story', label: 'Story order' },
                { value: 'filming', label: 'Filming order' },
                { value: 'location', label: 'By location' },
              ]}
              onChange={setOrder}
            />
            <label className="check">
              <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
              <span>Scene notes</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={sketches} onChange={(e) => setSketches(e.target.checked)} />
              <span>Sketches</span>
            </label>
          </div>
          {order === 'filming' && !hasSlots && (
            <p className="muted small no-print">No filming days set yet. Give each scene a filming day and stop in the Plan tab (Filming order), or ask your agent to.</p>
          )}
          {order === 'location' && !hasLocations && <p className="muted small no-print">No locations set yet.</p>}
        </header>
        {groups.map((g, gi) => (
          <section key={gi} className="checklist-group">
            {byLocation && <h2 className="group-title">📍 {g.label ?? 'No location given'}</h2>}
            {order === 'filming' && <h2 className="group-title">🎬 {g.label ?? 'No filming day set'}</h2>}
            {g.scenes.map(({ number, start, scene }) => {
              const counts = capturedCount(scene);
              return (
                <article key={scene.id} className="checklist-scene">
                  <header>
                    <h3>
                      <span className="scene-num">{number}</span> {scene.title}
                    </h3>
                    <span className="muted small">
                      {order === 'filming'
                        ? `Edit position ${formatTime(start)}–${formatTime(start + scene.durationSeconds)} · ${formatTime(scene.durationSeconds)} on screen`
                        : `${formatTime(start)}–${formatTime(start + scene.durationSeconds)} · ${formatTime(scene.durationSeconds)}`}{' '}
                      ·{' '}
                      {scene.status === 'ready' ? 'Ready to film' : 'Draft'} · {outcomeSummary(counts)}
                      {filmSlot(scene) && <> · <b>{filmSlot(scene)}</b></>} · <code>{scene.id}</code>
                    </span>
                  </header>
                  {details && (
                    <dl className="scene-notes">
                      {scene.location && !byLocation && (
                        <>
                          <dt>Location</dt>
                          <dd>{scene.location}</dd>
                        </>
                      )}
                      {scene.purpose && (
                        <>
                          <dt>Purpose</dt>
                          <dd>{scene.purpose}</dd>
                        </>
                      )}
                      {scene.description && (
                        <>
                          <dt>What happens</dt>
                          <dd>{scene.description}</dd>
                        </>
                      )}
                      {scene.audio && (
                        <>
                          <dt>Sound</dt>
                          <dd>{scene.audio}</dd>
                        </>
                      )}
                      {scene.voiceover && (
                        <>
                          <dt>VO</dt>
                          <dd>{scene.voiceover}</dd>
                        </>
                      )}
                      {scene.notes && (
                        <>
                          <dt>Notes</dt>
                          <dd>{scene.notes}</dd>
                        </>
                      )}
                    </dl>
                  )}
                  {sketches && scene.storyboard && (
                    <img className="checklist-sketch" src={assetUrl(scene.storyboard.previewAssetId, 480)} alt={scene.storyboard.description || 'Storyboard sketch'} />
                  )}
                  <ul className="checklist-shots">
                    {scene.shots.map((shot) => (
                      <li key={shot.id} className={`is-${shot.outcome}`}>
                        <OutcomeControl shot={shot} onChange={(f) => setOutcome(scene.id, shot, f)} />
                        <span className="print-box" aria-hidden>
                          {shot.outcome === 'filmed' ? '☑' : shot.outcome === 'skipped' ? '☒' : '☐'}
                        </span>
                        <span className="shot-text">
                          {shot.framing && <strong>{shot.framing}: </strong>}
                          {shot.description}
                          {shot.cameraNotes && <span className="muted as-block small">{shot.cameraNotes}</span>}
                          {(shot.gear ?? []).length > 0 && (
                            <span className="muted as-block small">
                              🎒 {(shot.gear ?? []).map((id) => (episode.gear ?? []).find((g) => g.id === id)?.name).filter(Boolean).join(' · ')}
                            </span>
                          )}
                          <SkipReason shot={shot} onChange={(skipReason) => setOutcome(scene.id, shot, { outcome: 'skipped', skipReason })} />
                          <JournalRefs refs={shot.journalRefs} />
                        </span>
                        <span className={`priority-tag ${shot.priority}`}>{shot.priority === 'essential' ? 'Essential' : 'Optional'}</span>
                      </li>
                    ))}
                    {!scene.shots.length && <li className="muted small">No shots listed.</li>}
                  </ul>
                </article>
              );
            })}
          </section>
        ))}
        {!episode.scenes.length && <p className="muted">No scenes yet.</p>}
      </main>
    </div>
    </Shell>
  );
}
