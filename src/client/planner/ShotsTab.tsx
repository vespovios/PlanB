// Shot list workspace: scene list beside the selected scene's shot table (cards on phones).
import { Fragment, useState } from 'react';
import { randomId } from '../../shared/ids';
import { capturedCount, formatTime, sceneNumber, sceneStarts, type Episode, type Scene, type Shot } from '../../shared/model';
import { SHOT_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES, term } from '../../shared/vocab';
import { assetUrl } from '../api';
import type { EpisodeSync } from '../sync';
import { Icon, Ring, sceneColour } from '../components/Icon';
import { ShotSizeIcon } from '../components/ShotIcons';
import { useMediaQuery } from '../components/ui';
import { sceneThumbnail } from './Cards';
import { ShotRow } from './Shots';
import { href, navigate } from '../router';

type Filter = 'all' | 'essential' | 'optional' | 'todo';
const shotRef = (sceneIndex: number, shotIndex: number) => `${sceneIndex + 1}${shotIndex < 26 ? String.fromCharCode(65 + shotIndex) : `.${shotIndex + 1}`}`;

interface Props {
  episode: Episode;
  engine: EpisodeSync;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
  onEditSketch: (sceneId: string) => void;
}

export function ShotsTab({ episode, engine, selectedId, setSelectedId, onEditSketch }: Props) {
  const mobile = useMediaQuery('(max-width: 760px)');
  const [filter, setFilter] = useState<Filter>('all');
  const [gearFilter, setGearFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scenes = episode.scenes;
  const index = Math.max(0, scenes.findIndex((s) => s.id === selectedId));
  const scene: Scene | undefined = scenes[index];
  const starts = sceneStarts(episode);
  const gear = episode.gear ?? [];
  const gearName = new Map(gear.map((g) => [g.id, g.name]));

  if (!scene) {
    return (
      <section className="overview-empty">
        <h2>No scenes yet</h2>
        <p className="muted">Shots belong to scenes. Add a scene in the planner first.</p>
        <a className="btn primary" href={href.episode(episode.id, 'plan')}>
          Open the planner
        </a>
      </section>
    );
  }

  const counts = {
    all: scene.shots.length,
    essential: scene.shots.filter((s) => s.priority === 'essential').length,
    optional: scene.shots.filter((s) => s.priority === 'optional').length,
    todo: scene.shots.filter((s) => !s.captured).length,
  };
  const visible = scene.shots
    .map((shot, j) => ({ shot, j }))
    .filter(({ shot }) => (filter === 'essential' ? shot.priority === 'essential' : filter === 'optional' ? shot.priority === 'optional' : filter === 'todo' ? !shot.captured : true))
    .filter(({ shot }) => !gearFilter || (shot.gear ?? []).includes(gearFilter));

  const update = (shot: Shot, fields: Partial<Shot>) => engine.queue({ op: 'updateShot', sceneId: scene.id, shotId: shot.id, fields: fields as never });
  const addShot = () => {
    const description = draft.trim();
    if (!description) return;
    const id = randomId('sh');
    engine.queue({ op: 'addShot', sceneId: scene.id, id, shot: { description, priority: 'essential' } });
    setDraft('');
    setEditing(id);
  };
  const specChips = (shot: Shot) =>
    [term(SHOT_SIZES, shot.size)?.abbr, term(SHOT_ANGLES, shot.angle)?.abbr, term(SHOT_MOVEMENTS, shot.movement)?.abbr]
      .filter(Boolean)
      .map((t) => (
        <span key={t} className="spec-chip">
          {t}
        </span>
      ));
  const gearChips = (shot: Shot) =>
    (shot.gear ?? []).map((id) => (
      <span key={id} className="gear-tag">
        {gearName.get(id)}
      </span>
    ));
  const editor = (shot: Shot, j: number) => (
    <ol className="shot-list shot-editor">
      <ShotRow shot={shot} index={j} count={scene.shots.length} scene={scene} engine={engine} gear={gear} />
    </ol>
  );
  const thumb = sceneThumbnail(scene);

  const filters = (
    <div className="filter-chips" role="toolbar" aria-label="Filter shots">
      {(
        [
          ['all', 'All'],
          ['essential', 'Essential'],
          ['optional', 'Optional'],
          ['todo', 'Not captured'],
        ] as [Filter, string][]
      ).map(([k, label]) => (
        <button key={k} type="button" className={`filter-chip ${filter === k ? 'on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
          {label} <span>{counts[k]}</span>
        </button>
      ))}
      {gear.length > 0 && (
        <select className="filter-select" aria-label="Filter by gear" value={gearFilter} onChange={(e) => setGearFilter(e.target.value)}>
          <option value="">All gear</option>
          {gear.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  const addForm = (
    <form
      className="add-shot"
      onSubmit={(e) => {
        e.preventDefault();
        addShot();
      }}
    >
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Add a shot to ${sceneNumber(index)}…`} aria-label="New shot description" />
      <button className="btn primary" disabled={!draft.trim()}>
        <Icon name="plus" size={16} /> Shot
      </button>
    </form>
  );

  if (mobile) {
    return (
      <div className="shots-mobile">
        <div className="scene-strip" role="tablist" aria-label="Scenes">
          {scenes.map((s, i) => (
            <button key={s.id} type="button" role="tab" aria-selected={i === index} className={i === index ? 'on' : ''} onClick={() => (setSelectedId(s.id), setEditing(null))}>
              <span className="scene-dot" style={{ background: sceneColour(i) }} />
              {sceneNumber(i)}
            </button>
          ))}
        </div>
        <div className="shots-mobile-head">
          <div className="eyebrow">
            {sceneNumber(index)} · {formatTime(scene.durationSeconds)} · {scene.shots.length} shots
          </div>
          <h2>{scene.title.replace(/^\d+\s*·\s*/, '')}</h2>
          {filters}
        </div>
        <ul className="shot-cards">
          {visible.map(({ shot, j }) => (
            <li key={shot.id} className={`shot-card ${shot.captured ? 'captured' : ''}`}>
              <label className="shot-card-check">
                <input type="checkbox" checked={shot.captured} onChange={(e) => update(shot, { captured: e.target.checked })} aria-label={`Captured: ${shot.description}`} />
              </label>
              <button type="button" className="shot-card-body" onClick={() => setEditing(editing === shot.id ? null : shot.id)} aria-expanded={editing === shot.id}>
                <b>
                  {shotRef(index, j)}
                  {shot.framing ? ` · ${shot.framing}` : ''}
                </b>
                <span className="shot-card-desc">{shot.description}</span>
                <span className="chip-row">
                  {specChips(shot)}
                  {shot.priority === 'essential' && <span className="spec-chip essential">★ Essential</span>}
                </span>
                {(shot.gear ?? []).length > 0 && <span className="chip-row">{gearChips(shot)}</span>}
              </button>
              {editing === shot.id && <div className="shot-card-editor">{editor(shot, j)}</div>}
            </li>
          ))}
          {!visible.length && <li className="muted small">No shots match this filter.</li>}
        </ul>
        {addForm}
      </div>
    );
  }

  return (
    <div className="shots-tab">
      <aside className="scene-pane" aria-label="Scenes">
        <div className="scene-pane-head">
          <h3>Scenes</h3>
          <span className="muted">{scenes.length}</span>
        </div>
        <ol>
          {scenes.map((s, i) => {
            const c = capturedCount(s);
            return (
              <li key={s.id}>
                <button type="button" className={`scene-pane-item ${i === index ? 'on' : ''}`} aria-current={i === index} onClick={() => (setSelectedId(s.id), setEditing(null))}>
                  <span className="scene-bar" style={{ background: sceneColour(i) }} />
                  <span className="scene-pane-text">
                    <b>
                      {sceneNumber(i)} {s.title.replace(/^\d+\s*·\s*/, '')}
                    </b>
                    <span>
                      {formatTime(s.durationSeconds)} · {s.shots.length} shot{s.shots.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <Ring value={c.total ? c.captured / c.total : 0} size={22} stroke={2.6} label={`${c.captured} of ${c.total} captured`} />
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <section className="shots-main">
        <header className="scene-head">
          <button type="button" className="scene-head-img" onClick={() => onEditSketch(scene.id)} aria-label={scene.storyboard ? 'Edit storyboard' : 'Draw storyboard'}>
            {thumb ? <img src={assetUrl(thumb, 480)} alt={scene.storyboard?.description || ''} /> : <span>+ Sketch</span>}
          </button>
          <div className="scene-head-text">
            <div className="eyebrow">
              Scene {sceneNumber(index)} · {formatTime(starts[index])}–{formatTime(starts[index] + scene.durationSeconds)}
            </div>
            <h2>{scene.title.replace(/^\d+\s*·\s*/, '')}</h2>
            <div className="meta-chips">
              <span>
                <Icon name="clock" size={14} /> {formatTime(scene.durationSeconds)}
              </span>
              {scene.location && (
                <span title={scene.location}>
                  <Icon name="pin" size={14} /> {scene.location}
                </span>
              )}
              <span className={`pill ${scene.status === 'ready' ? 'green' : 'amber'}`}>
                <i />
                {scene.status === 'ready' ? 'Ready to film' : 'Draft'}
              </span>
            </div>
            {scene.purpose && (
              <p className="scene-purpose">
                <b>Why it belongs:</b> {scene.purpose}
              </p>
            )}
            <div className="row wrap">
              <button type="button" className="btn small" onClick={() => onEditSketch(scene.id)}>
                <Icon name="pencil" size={16} /> {scene.storyboard ? 'Edit sketch' : 'Draw sketch'}
              </button>
              <button type="button" className="btn small" onClick={() => navigate(href.episode(episode.id, 'plan'))}>
                <Icon name="timeline" size={16} /> Open in planner
              </button>
            </div>
          </div>
        </header>
        {filters}
        <table className="shot-table">
          <thead>
            <tr>
              <th className="col-check" aria-label="Captured" />
              <th className="col-ref">Shot</th>
              <th>Description</th>
              <th className="col-spec">Size · angle · move</th>
              <th className="col-gear">Gear</th>
              <th className="col-pri">Priority</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ shot, j }) => (
              <Fragment key={shot.id}>
                <tr
                  className={`${shot.captured ? 'captured' : ''} ${editing === shot.id ? 'editing' : ''}`}
                  tabIndex={0}
                  aria-expanded={editing === shot.id}
                  aria-label={`Shot ${shotRef(index, j)}: ${shot.description}`}
                  onClick={() => setEditing(editing === shot.id ? null : shot.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setEditing(editing === shot.id ? null : shot.id);
                    }
                  }}
                >
                  <td className="col-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={shot.captured} onChange={(e) => update(shot, { captured: e.target.checked })} aria-label={`Captured: ${shot.description}`} />
                  </td>
                  <td className="col-ref">{shotRef(index, j)}</td>
                  <td>
                    {shot.framing && <b className="shot-framing-text">{shot.framing}</b>}
                    <span className="shot-desc-text">{shot.description}</span>
                    {shot.cameraNotes && <span className="shot-notes-text">{shot.cameraNotes}</span>}
                  </td>
                  <td className="col-spec">
                    <span className="spec-cell">
                      <ShotSizeIcon size={shot.size} />
                      <span className="chip-row">{specChips(shot)}</span>
                    </span>
                  </td>
                  <td className="col-gear">
                    <span className="chip-row">{gearChips(shot)}</span>
                  </td>
                  <td className="col-pri" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={`pill ${shot.priority === 'essential' ? 'green' : 'grey'}`} onClick={() => update(shot, { priority: shot.priority === 'essential' ? 'optional' : 'essential' })} aria-label={`Priority ${shot.priority}; click to change`}>
                      <i />
                      {shot.priority === 'essential' ? 'Essential' : 'Optional'}
                    </button>
                  </td>
                </tr>
                {editing === shot.id && (
                  <tr className="editor-row">
                    <td colSpan={6}>{editor(shot, j)}</td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={6} className="muted small">
                  No shots match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {addForm}
        <p className="muted small capture-note">Click a row to edit it. “Captured” means you filmed it; it doesn’t mean the footage has been reviewed.</p>
      </section>
    </div>
  );
}
