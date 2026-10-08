import { useState } from 'react';
import { buildChecklist } from '../../shared/checklist';
import { capturedCount, formatTime, totalSeconds } from '../../shared/model';
import { assetUrl } from '../api';
import { useEpisodeSync } from '../sync';
import { TopBar } from '../components/TopBar';
import { href } from '../router';
import { SaveStatus } from './Planner';

/** Filming checklist: derived from the same scenes and shots, readable on a phone and printable. */
export function ChecklistPage({ id }: { id: string }) {
  const sync = useEpisodeSync(id);
  const { episode, engine } = sync;
  const [byLocation, setByLocation] = useState(false);
  const [sketches, setSketches] = useState(true);
  const [details, setDetails] = useState(true);

  if (sync.loadError) return <p className="error center">{sync.loadError}</p>;
  if (!episode) return <div className="boot">Loading checklist…</div>;
  const groups = buildChecklist(episode, byLocation);
  const hasLocations = episode.scenes.some((s) => s.location.trim());
  const allShots = episode.scenes.flatMap((s) => s.shots);

  return (
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
          <p className="eyebrow">Filming checklist</p>
          <h1>{episode.title}</h1>
          <p className="muted">
            {episode.scenes.length} scenes · planned {formatTime(totalSeconds(episode))} · {allShots.filter((s) => s.captured).length}/{allShots.length} shots reported captured ·
            revision {episode.revision} · {new Date(episode.updatedAt).toLocaleString()}
          </p>
          <p className="muted small print-note">Captured = reported as filmed, not reviewed. Scene numbers follow story order.</p>
          <div className="checklist-options no-print">
            <label className="check">
              <input type="checkbox" checked={byLocation} onChange={(e) => setByLocation(e.target.checked)} disabled={!hasLocations} />
              <span>Group by location{hasLocations ? '' : ' (no locations set)'}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
              <span>Scene notes</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={sketches} onChange={(e) => setSketches(e.target.checked)} />
              <span>Sketches</span>
            </label>
          </div>
        </header>
        {groups.map((g, gi) => (
          <section key={gi} className="checklist-group">
            {byLocation && <h2 className="group-title">📍 {g.location ?? 'No location given'}</h2>}
            {g.scenes.map(({ number, start, scene }) => {
              const { captured, total } = capturedCount(scene);
              return (
                <article key={scene.id} className="checklist-scene">
                  <header>
                    <h3>
                      <span className="scene-num">{number}</span> {scene.title}
                    </h3>
                    <span className="muted small">
                      {formatTime(start)}–{formatTime(start + scene.durationSeconds)} · {formatTime(scene.durationSeconds)} ·{' '}
                      {scene.status === 'ready' ? 'Ready to film' : 'Draft'} · {captured}/{total} captured · <code>{scene.id}</code>
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
                      <li key={shot.id} className={shot.captured ? 'captured' : ''}>
                        <label>
                          <input
                            type="checkbox"
                            checked={shot.captured}
                            onChange={(e) => engine.queue({ op: 'updateShot', sceneId: scene.id, shotId: shot.id, fields: { captured: e.target.checked } })}
                          />
                          <span className="print-box" aria-hidden>
                            {shot.captured ? '☑' : '☐'}
                          </span>
                          <span className="shot-text">
                            {shot.framing && <strong>{shot.framing}: </strong>}
                            {shot.description}
                            {shot.cameraNotes && <span className="muted as-block small">{shot.cameraNotes}</span>}
                          </span>
                          <span className={`priority-tag ${shot.priority}`}>{shot.priority === 'essential' ? 'Essential' : 'Optional'}</span>
                        </label>
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
  );
}
