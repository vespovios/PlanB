import { useEffect, useState } from 'react';
import { randomId } from '../../shared/ids';
import { GEAR_KINDS, type Episode, type EpisodeSummary, type GearItem } from '../../shared/model';
import { api } from '../api';
import type { EpisodeSync } from '../sync';
import { TextField } from '../components/ui';

export const GEAR_KIND_LABELS: Record<GearItem['kind'], string> = {
  camera: 'Camera',
  lens: 'Lens',
  support: 'Support / mount',
  audio: 'Audio',
  light: 'Light',
  power: 'Power',
  storage: 'Storage',
  other: 'Other',
};

/** Kit list for the episode. Shots refer to these items; the agent only suggests gear from here. */
export function KitList({ episode, engine }: { episode: Episode; engine: EpisodeSync }) {
  const gear = episode.gear ?? [];
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GearItem['kind']>('camera');
  const [others, setOthers] = useState<EpisodeSummary[]>([]);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .episodes()
      .then((r) => setOthers(r.episodes.filter((e) => e.id !== episode.id)))
      .catch(() => undefined);
  }, [episode.id]);

  const usage = (id: string) => episode.scenes.reduce((n, s) => n + s.shots.filter((sh) => sh.gear?.includes(id)).length, 0);

  const add = () => {
    const n = name.trim();
    if (!n) return;
    engine.queue({ op: 'addGear', id: randomId('ge'), item: { name: n, kind } });
    setName('');
  };

  const copyFrom = async (otherId: string) => {
    setCopyMsg(null);
    try {
      const { episode: other } = await api.episode(otherId);
      const have = new Set(gear.map((g) => g.name.trim().toLowerCase()));
      const items = (other.gear ?? []).filter((g) => !have.has(g.name.trim().toLowerCase()));
      if (!items.length) return setCopyMsg('Nothing new to copy: that episode has no other kit.');
      for (const g of items) engine.queue({ op: 'addGear', id: randomId('ge'), item: { name: g.name, kind: g.kind, notes: g.notes } });
      setCopyMsg(`Copied ${items.length} item${items.length === 1 ? '' : 's'} from “${other.title}”.`);
    } catch (e) {
      setCopyMsg((e as Error).message);
    }
  };

  return (
    <div className="kit-list">
      <p className="muted small">
        What you are actually taking: cameras, lenses, mounts and tripods, microphones, power. Shots can then name the gear they need, and the agent only suggests gear from
        this list.
      </p>
      {gear.length > 0 && (
        <ul className="kit-items">
          {gear.map((g) => {
            const used = usage(g.id);
            return (
              <li key={g.id} className="kit-item">
                <TextField
                  className="kit-name"
                  ariaLabel="Gear name"
                  required
                  value={g.name}
                  maxLength={80}
                  onChange={(v) => engine.queue({ op: 'updateGear', gearId: g.id, fields: { name: v } }, 700)}
                  onBlur={() => void engine.flush()}
                />
                <select aria-label="Kind" value={g.kind} onChange={(e) => engine.queue({ op: 'updateGear', gearId: g.id, fields: { kind: e.target.value as GearItem['kind'] } })}>
                  {GEAR_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {GEAR_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <TextField
                  className="kit-notes"
                  ariaLabel="Gear notes"
                  placeholder="Notes (battery count, mount type…)"
                  value={g.notes}
                  onChange={(v) => engine.queue({ op: 'updateGear', gearId: g.id, fields: { notes: v } }, 700)}
                  onBlur={() => void engine.flush()}
                />
                <span className="muted small kit-usage">{used ? `${used} shot${used === 1 ? '' : 's'}` : 'unused'}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${g.name}`}
                  title={used ? `Also removes it from ${used} shot${used === 1 ? '' : 's'}` : 'Remove'}
                  onClick={() => engine.queue({ op: 'removeGear', gearId: g.id })}
                >
                  🗑
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="kit-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DJI Osmo Action 5, chest mount, Rode Wireless GO" aria-label="New gear name" />
        <select aria-label="New gear kind" value={kind} onChange={(e) => setKind(e.target.value as GearItem['kind'])}>
          {GEAR_KINDS.map((k) => (
            <option key={k} value={k}>
              {GEAR_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <button className="btn" disabled={!name.trim()}>
          + Gear
        </button>
      </form>
      {others.length > 0 && (
        <div className="row wrap kit-copy">
          <label className="muted small" htmlFor="kit-copy">
            Copy kit from
          </label>
          <select id="kit-copy" value="" onChange={(e) => e.target.value && void copyFrom(e.target.value)}>
            <option value="">another episode…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          {copyMsg && <span className="muted small">{copyMsg}</span>}
        </div>
      )}
    </div>
  );
}

/** Gear used by a shot: chips to remove, a dropdown to add from the kit list. */
export function ShotGear({ gear, value, onChange }: { gear: GearItem[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!gear.length) return null;
  const chosen = value.map((id) => gear.find((g) => g.id === id)).filter((g): g is GearItem => !!g);
  const rest = gear.filter((g) => !value.includes(g.id));
  return (
    <div className="shot-gear">
      {chosen.map((g) => (
        <button key={g.id} type="button" className={`gear-chip kind-${g.kind}`} title={`Remove ${g.name}`} onClick={() => onChange(value.filter((x) => x !== g.id))}>
          {g.name} ✕
        </button>
      ))}
      {rest.length > 0 && (
        <select className="spec-select" aria-label="Add gear to shot" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">+ Gear</option>
          {rest.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({GEAR_KIND_LABELS[g.kind]})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
