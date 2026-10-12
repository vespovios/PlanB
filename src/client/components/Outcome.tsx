// Shot outcome on the shoot: open ○ / filmed ✓ / skipped ✕, one tap each, with an optional
// one-tap skip reason. Skipped is resolved but never filmed.
import { useState } from 'react';
import type { Shot, ShotOutcome } from '../../shared/model';

export const SKIP_REASONS = ['Wind too strong', 'Ran out of daylight', 'Owner unavailable', 'Covered by another shot', 'No access', 'Weather'];

const STATES: { value: ShotOutcome; mark: string; label: string }[] = [
  { value: 'open', mark: '○', label: 'Open' },
  { value: 'filmed', mark: '✓', label: 'Filmed' },
  { value: 'skipped', mark: '✕', label: 'Skipped' },
];

type Change = { outcome: ShotOutcome; skipReason?: string };

export function OutcomeControl({ shot, onChange, size = 'sm', labels = false }: { shot: Shot; onChange: (fields: Change) => void; size?: 'sm' | 'lg'; labels?: boolean }) {
  return (
    <span className={`outcome ${size} is-${shot.outcome}`} role="radiogroup" aria-label={`Outcome: ${shot.description}`} onClick={(e) => e.stopPropagation()}>
      {STATES.map((s) => (
        <button
          key={s.value}
          type="button"
          role="radio"
          aria-checked={shot.outcome === s.value}
          aria-label={s.label}
          title={s.value === 'open' ? 'Open: no outcome yet' : s.value === 'filmed' ? 'Filmed (reported, not reviewed)' : 'Skipped: deliberately dropped'}
          className={`outcome-${s.value} ${shot.outcome === s.value ? 'on' : ''}`}
          onClick={() => shot.outcome !== s.value && onChange({ outcome: s.value })}
        >
          <span aria-hidden>{s.mark}</span>
          {labels && <span className="outcome-label">{s.label}</span>}
        </button>
      ))}
    </span>
  );
}

/** Shown under a skipped shot: the reason as one tap, or a few words of your own. Never required. */
export function SkipReason({ shot, onChange }: { shot: Shot; onChange: (skipReason: string) => void }) {
  // Offer the reasons right after skipping; later, keep the row quiet until asked.
  const justSkipped = !!shot.outcomeAt && Date.now() - Date.parse(shot.outcomeAt) < 10 * 60_000;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (shot.outcome !== 'skipped') return null;
  if (shot.skipReason ? !editing : !editing && !justSkipped) {
    return (
      <span className="skip-reason" onClick={(e) => e.stopPropagation()}>
        <span className="skip-tag">Skipped{shot.skipReason ? ` · ${shot.skipReason}` : ''}</span>
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>
          {shot.skipReason ? 'change' : 'add reason'}
        </button>
      </span>
    );
  }
  const pick = (reason: string) => {
    onChange(reason);
    setEditing(false);
    setDraft('');
  };
  return (
    <span className="skip-reason choosing" role="group" aria-label="Why was it skipped? (optional)" onClick={(e) => e.stopPropagation()}>
      <span className="skip-tag">Skipped{editing ? '' : ' · why? (optional)'}</span>
      {SKIP_REASONS.map((r) => (
        <button key={r} type="button" className={`reason-chip ${shot.skipReason === r ? 'on' : ''}`} onClick={() => pick(r)}>
          {r}
        </button>
      ))}
      <form
        className="reason-other"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) pick(draft.trim().slice(0, 160));
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Other…" aria-label="Other reason" maxLength={160} />
      </form>
      {editing && !shot.skipReason && (
        <button type="button" className="link-btn" onClick={() => setEditing(false)}>
          cancel
        </button>
      )}
      {editing && shot.skipReason && (
        <button type="button" className="link-btn" onClick={() => setEditing(false)}>
          keep
        </button>
      )}
      {editing && shot.skipReason && (
        <button type="button" className="link-btn" onClick={() => pick('')}>
          clear reason
        </button>
      )}
    </span>
  );
}

/** Links to Trip Log entries about this shot (set by the journal agent). */
export function JournalRefs({ refs }: { refs: string[] }) {
  if (!refs?.length) return null;
  return (
    <span className="journal-refs" onClick={(e) => e.stopPropagation()}>
      📓{' '}
      {refs.map((r, i) => (
        <span key={r}>
          {i > 0 && ', '}
          {/^https?:\/\//.test(r) ? (
            <a href={r} target="_blank" rel="noreferrer">
              journal {i + 1}
            </a>
          ) : (
            <code>{r}</code>
          )}
        </span>
      ))}
    </span>
  );
}
