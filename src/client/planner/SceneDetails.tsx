import { useId, useState } from 'react';
import { formatTime, sceneNumber, type Scene } from '../../shared/model';
import { assetUrl } from '../api';
import type { EpisodeSync } from '../sync';
import { Confirm, Disclosure, DurationField, Modal, Segmented, TextField } from '../components/ui';
import { References } from './References';
import { CUT_TYPES } from '../../shared/vocab';
import { StoryboardEditor } from '../storyboard/StoryboardEditor';

const TEXT_DEBOUNCE = 700;

interface Props {
  scene: Scene;
  index: number;
  start: number;
  count: number;
  engine: EpisodeSync;
  episodeId: string;
  onDelete: () => void;
  onMove: (index: number) => void;
}

export function SceneDetails({ scene, index, start, count, engine, episodeId, onDelete, onMove }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (fields: Partial<Scene>, debounce = TEXT_DEBOUNCE) =>
    engine.queue({ op: 'updateScene', sceneId: scene.id, fields: fields as never }, debounce);
  const flush = () => void engine.flush();

  return (
    <div className="scene-details">
      <div className="panel-head">
        <h3 className="eyebrow">
          Scene {String(index + 1).padStart(2, '0')} · {sceneNumber(index)}
        </h3>
        <span className="eyebrow muted">Planned screen time</span>
      </div>
      <div className="title-row">
        <TextField label="Scene title" required value={scene.title} onChange={(v) => set({ title: v })} onBlur={flush} maxLength={200} />
        <DurationField label="Seconds" value={scene.durationSeconds} onChange={(v) => set({ durationSeconds: v }, 400)} />
      </div>
      <div className="scene-meta muted small">
        {sceneNumber(index)} · {formatTime(start)}–{formatTime(start + scene.durationSeconds)} · ID <code>{scene.id}</code>
      </div>
      <div className="status-row">
        <span className="label">Planning status</span>
        <Segmented
          ariaLabel="Planning status"
          value={scene.status}
          options={[
            { value: 'draft', label: 'Draft' },
            { value: 'ready', label: 'Ready to film' },
          ]}
          onChange={(v) => set({ status: v }, 0)}
        />
      </div>
      <TextField
        label="What happens"
        multiline
        rows={3}
        placeholder="The visible action on screen"
        value={scene.description}
        onChange={(v) => set({ description: v })}
        onBlur={flush}
      />
      <TextField
        label="Why it belongs in the episode"
        multiline
        placeholder="What should the viewer understand or feel here?"
        value={scene.purpose}
        onChange={(v) => set({ purpose: v })}
        onBlur={flush}
      />
      <div className="optional-fields">
        <Disclosure label="Location / route" filled={!!scene.location}>
          <TextField
            ariaLabel="Location or route context"
            placeholder="Where this happens, or the route section"
            value={scene.location}
            onChange={(v) => set({ location: v })}
            onBlur={flush}
          />
        </Disclosure>
        <Disclosure label="Filming order" filled={!!scene.filmDay || !!scene.filmStop} hint="When this gets filmed, separate from story order: shooting day and stop">
          <div className="film-slot">
            <SlotSelect label="Filming day" prefix="Day" max={14} value={scene.filmDay ?? null} onChange={(v) => set({ filmDay: v }, 0)} />
            <SlotSelect label="Stop" prefix="Stop" max={30} value={scene.filmStop ?? null} onChange={(v) => set({ filmStop: v }, 0)} />
          </div>
          <p className="muted small">The filming checklist and production pack can list scenes in this order. Story order stays as it is.</p>
        </Disclosure>
        <Disclosure label="Notes / edit intent" filled={!!scene.notes || !!scene.cutToNext} hint="General notes, e.g. leave a pause or match movement for a transition">
          <div className="field">
            <label htmlFor={`cut-${scene.id}`}>Cut to the next scene</label>
            <select
              id={`cut-${scene.id}`}
              value={scene.cutToNext ?? ''}
              onChange={(e) => set({ cutToNext: (e.target.value || null) as Scene['cutToNext'] }, 0)}
            >
              <option value="">Not decided</option>
              {CUT_TYPES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} — {c.use}
                </option>
              ))}
            </select>
          </div>
          <TextField
            multiline
            ariaLabel="General and edit notes"
            placeholder="General notes, e.g. hold a pause here, or match the movement for a transition"
            value={scene.notes}
            onChange={(v) => set({ notes: v })}
            onBlur={flush}
          />
        </Disclosure>
        <Disclosure label="References" filled={scene.attachments.length > 0} count={scene.attachments.length}>
          <References scene={scene} engine={engine} episodeId={episodeId} />
        </Disclosure>
        <StoryboardSection scene={scene} engine={engine} episodeId={episodeId} />
      </div>
      <div className="scene-actions">
        <button type="button" className="btn small" disabled={index === 0} onClick={() => onMove(index - 1)}>
          Move earlier
        </button>
        <button type="button" className="btn small" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
          Move later
        </button>
        <span className="spacer" />
        <button type="button" className="btn small danger-text" onClick={() => setConfirmDelete(true)}>
          Delete scene
        </button>
      </div>
      {confirmDelete && (
        <Confirm
          title="Delete scene?"
          message={
            <p>
              “{scene.title}” and its {scene.shots.length} shot{scene.shots.length === 1 ? '' : 's'}
              {scene.storyboard ? ', storyboard' : ''}
              {scene.attachments.length ? ' and references' : ''} will be removed. You can undo this straight away or restore it later from History.
            </p>
          }
          confirmLabel="Delete scene"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
        />
      )}
    </div>
  );
}

function StoryboardSection({ scene, engine, episodeId }: { scene: Scene; engine: EpisodeSync; episodeId: string }) {
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sb = scene.storyboard;
  return (
    <>
      {sb ? (
        <section className="disclosure storyboard-section">
          <div className="disclosure-head static">
            <span>Storyboard</span>
          </div>
          <button type="button" className="storyboard-preview" onClick={() => setViewing(true)} aria-label="View storyboard larger">
            <img src={assetUrl(sb.previewAssetId, 960)} alt={sb.description || `Storyboard for ${scene.title}`} />
          </button>
          {sb.description && <p className="small">{sb.description}</p>}
          <div className="row">
            <button type="button" className="btn small primary" onClick={() => setEditing(true)}>
              ✎ Edit drawing
            </button>
            <span className="spacer" />
            <button type="button" className="btn small danger-text" onClick={() => setConfirmDelete(true)}>
              Delete drawing
            </button>
          </div>
        </section>
      ) : (
        <button type="button" className="chip-add" onClick={() => setEditing(true)}>
          ✎ Draw / Storyboard
        </button>
      )}
      {editing && <StoryboardEditor scene={scene} engine={engine} episodeId={episodeId} onClose={() => setEditing(false)} />}
      {viewing && sb && (
        <Modal title={`Storyboard · ${scene.title}`} onClose={() => setViewing(false)} wide>
          <img className="storyboard-large" src={assetUrl(sb.previewAssetId)} alt={sb.description || `Storyboard for ${scene.title}`} />
          {sb.description && <p>{sb.description}</p>}
        </Modal>
      )}
      {confirmDelete && (
        <Confirm
          title="Delete drawing?"
          message={<p>The storyboard for “{scene.title}” will be removed. Reference images stay. You can restore it from History.</p>}
          confirmLabel="Delete drawing"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            engine.queue({ op: 'deleteStoryboard', sceneId: scene.id });
          }}
        />
      )}
    </>
  );
}

function SlotSelect(props: { label: string; prefix: string; max: number; value: number | null; onChange: (v: number | null) => void }) {
  const id = useId();
  const options = Array.from({ length: Math.max(props.max, props.value ?? 0) }, (_, i) => i + 1);
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Not set</option>
        {options.map((n) => (
          <option key={n} value={n}>
            {props.prefix} {n}
          </option>
        ))}
      </select>
    </div>
  );
}
