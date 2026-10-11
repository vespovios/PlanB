import { useState } from 'react';
import { randomId } from '../../shared/ids';
import { capturedCount, type Scene, type Shot } from '../../shared/model';
import type { EpisodeSync } from '../sync';
import { Disclosure, TextField } from '../components/ui';
import { ShotSizeIcon } from '../components/ShotIcons';
import { SHOT_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES, type Term } from '../../shared/vocab';

/** Compact select for one vocabulary list; empty means "not specified". */
function SpecSelect({ list, value, label, onChange }: { list: readonly Term[]; value: string | null | undefined; label: string; onChange: (v: string | null) => void }) {
  return (
    <select className={`spec-select ${value ? 'set' : ''}`} aria-label={label} title={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{label}</option>
      {list.map((t) => (
        <option key={t.key} value={t.key}>
          {t.abbr} · {t.label}
        </option>
      ))}
    </select>
  );
}

const TEXT_DEBOUNCE = 700;

export function ShotsPanel({ scene, engine }: { scene: Scene; engine: EpisodeSync }) {
  const [draft, setDraft] = useState('');
  const { captured, total } = capturedCount(scene);
  const add = () => {
    const description = draft.trim();
    if (!description) return;
    engine.queue({ op: 'addShot', sceneId: scene.id, id: randomId('sh'), shot: { description, priority: 'essential' } });
    setDraft('');
  };
  return (
    <div className="shots">
      <div className="panel-head">
        <h3 className="eyebrow">Shots to capture</h3>
        <span className="eyebrow muted" aria-live="polite">
          {total} shot{total === 1 ? '' : 's'}
          {total > 0 && ` · ${captured} captured`}
        </span>
      </div>
      {total === 0 && <p className="muted small">No shots yet. Start with the one to three shots this scene really needs.</p>}
      <ol className="shot-list">
        {scene.shots.map((shot, i) => (
          <ShotRow key={shot.id} shot={shot} index={i} count={total} scene={scene} engine={engine} />
        ))}
      </ol>
      <form
        className="add-shot"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a shot, e.g. Wide of both riders loading" aria-label="New shot description" />
        <button className="btn" disabled={!draft.trim()}>
          + Shot
        </button>
      </form>
      <p className="muted small capture-note">“Captured” means you filmed it. It doesn’t mean the footage has been reviewed.</p>
      <div className="optional-fields">
        <Disclosure label="Voice-over" filled={!!scene.voiceover} hint="Optional VO intent or draft wording">
          <TextField
            multiline
            ariaLabel="Voice-over"
            placeholder="VO intent or draft wording (optional)"
            value={scene.voiceover}
            onChange={(v) => engine.queue({ op: 'updateScene', sceneId: scene.id, fields: { voiceover: v } }, TEXT_DEBOUNCE)}
            onBlur={() => void engine.flush()}
          />
        </Disclosure>
        <Disclosure label="Audio / music" filled={!!scene.audio} hint="Natural sound to capture, music intent">
          <TextField
            multiline
            ariaLabel="Audio / music"
            placeholder="Natural sound to capture, music mood… (optional)"
            value={scene.audio}
            onChange={(v) => engine.queue({ op: 'updateScene', sceneId: scene.id, fields: { audio: v } }, TEXT_DEBOUNCE)}
            onBlur={() => void engine.flush()}
          />
        </Disclosure>
      </div>
    </div>
  );
}

function ShotRow({ shot, index, count, scene, engine }: { shot: Shot; index: number; count: number; scene: Scene; engine: EpisodeSync }) {
  const [notesOpen, setNotesOpen] = useState(!!shot.cameraNotes);
  const update = (fields: Partial<Shot>, debounce = 0) =>
    engine.queue({ op: 'updateShot', sceneId: scene.id, shotId: shot.id, fields }, debounce);
  return (
    <li className={`shot ${shot.captured ? 'captured' : ''}`}>
      <label className="shot-check" title="Captured: you filmed this shot">
        <input type="checkbox" checked={shot.captured} onChange={(e) => update({ captured: e.target.checked })} aria-label={`Captured: ${shot.description}`} />
        <span className="shot-num">{String(index + 1).padStart(2, '0')}</span>
        <ShotSizeIcon size={shot.size} />
      </label>
      <div className="shot-body">
        <div className="shot-line">
          <TextField
            className="shot-framing"
            ariaLabel="Framing or angle"
            placeholder="Framing"
            value={shot.framing}
            maxLength={500}
            onChange={(v) => update({ framing: v }, TEXT_DEBOUNCE)}
            onBlur={() => void engine.flush()}
          />
          <button
            type="button"
            className={`priority ${shot.priority}`}
            aria-label={`Priority: ${shot.priority}. Click to change.`}
            onClick={() => update({ priority: shot.priority === 'essential' ? 'optional' : 'essential' })}
          >
            {shot.priority === 'essential' ? 'Essential' : 'Optional'}
          </button>
        </div>
        <div className="shot-specs">
          <SpecSelect list={SHOT_SIZES} label="Size" value={shot.size} onChange={(v) => update({ size: v as Shot['size'] })} />
          <SpecSelect list={SHOT_ANGLES} label="Angle" value={shot.angle} onChange={(v) => update({ angle: v as Shot['angle'] })} />
          <SpecSelect list={SHOT_MOVEMENTS} label="Move" value={shot.movement} onChange={(v) => update({ movement: v as Shot['movement'] })} />
        </div>
        <TextField
          multiline
          rows={1}
          className="shot-desc"
          ariaLabel="Shot description"
          required
          value={shot.description}
          onChange={(v) => update({ description: v }, TEXT_DEBOUNCE)}
          onBlur={() => void engine.flush()}
        />
        {notesOpen ? (
          <TextField
            multiline
            rows={1}
            className="shot-notes"
            ariaLabel="Camera notes"
            placeholder="Camera notes (lens, movement, why this framing)…"
            value={shot.cameraNotes}
            onChange={(v) => update({ cameraNotes: v }, TEXT_DEBOUNCE)}
            onBlur={() => void engine.flush()}
          />
        ) : null}
        <div className="shot-tools">
          {!notesOpen && (
            <button type="button" className="link-btn" onClick={() => setNotesOpen(true)}>
              + camera notes
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="icon-btn" aria-label="Move shot up" disabled={index === 0} onClick={() => engine.queue({ op: 'moveShot', sceneId: scene.id, shotId: shot.id, index: index - 1 })}>
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Move shot down"
            disabled={index === count - 1}
            onClick={() => engine.queue({ op: 'moveShot', sceneId: scene.id, shotId: shot.id, index: index + 1 })}
          >
            ↓
          </button>
          <button type="button" className="icon-btn" aria-label="Delete shot" onClick={() => engine.queue({ op: 'deleteShot', sceneId: scene.id, shotId: shot.id })}>
            🗑
          </button>
        </div>
      </div>
    </li>
  );
}
