import { useState } from 'react';
import { formatTime, parseTime, type Episode } from '../../shared/model';
import { STORY_STARTER } from '../../shared/ops';
import type { EpisodeSync } from '../sync';
import { Disclosure, TextField } from '../components/ui';

const TEXT_DEBOUNCE = 700;

/** Brief, optional story outline and loose notes. Collapsible so the checklist stays quick to use. */
export function EpisodeBrief({ episode, engine, expanded = false }: { episode: Episode; engine: EpisodeSync; expanded?: boolean }) {
  const set = (fields: Partial<Episode>, debounce = TEXT_DEBOUNCE) => engine.queue({ op: 'updateEpisode', fields: fields as never }, debounce);
  const flush = () => void engine.flush();
  const [target, setTarget] = useState(episode.targetSeconds ? formatTime(episode.targetSeconds) : '');

  const appendNote = (label: string) => {
    const sep = episode.notes && !episode.notes.endsWith('\n') ? '\n' : '';
    set({ notes: `${episode.notes}${sep}${label}: ` }, 0);
  };

  return (
    <div className="brief">
      <TextField
        label="Brief"
        multiline
        rows={2}
        placeholder="What is this episode about, and who is it for?"
        value={episode.brief}
        onChange={(v) => set({ brief: v })}
        onBlur={flush}
      />
      <div className="field target-field">
        <label htmlFor="target-runtime">Target runtime (optional, m:ss)</label>
        <input
          id="target-runtime"
          inputMode="numeric"
          placeholder="e.g. 10:00"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => {
            const v = target.trim() ? parseTime(target) : null;
            if (target.trim() && !v) return setTarget(episode.targetSeconds ? formatTime(episode.targetSeconds) : '');
            if (v !== episode.targetSeconds) set({ targetSeconds: v }, 0);
            setTarget(v ? formatTime(v) : '');
          }}
        />
      </div>
      <Disclosure label="Story outline" filled={!!episode.outline} defaultOpen={expanded || !!episode.outline} hint="Optional thinking aid">
        <p className="muted small">
          Optional. Write freely, or use the five-beat starter as prompts: rename, skip or delete any of them. A beat can span several scenes; the outline never changes
          your timeline.
        </p>
        <TextField
          multiline
          rows={5}
          ariaLabel="Story outline"
          placeholder="What does the viewer discover? What changes from start to end?"
          value={episode.outline}
          onChange={(v) => set({ outline: v })}
          onBlur={flush}
        />
        {!episode.outline.trim() && (
          <button type="button" className="btn small" onClick={() => set({ outline: STORY_STARTER }, 0)}>
            Insert starter: Setup · Desire · Conflict · Change · Result
          </button>
        )}
      </Disclosure>
      <Disclosure label="Loose notes" filled={!!episode.notes} defaultOpen={expanded || !!episode.notes} hint="Ideas, observations from filming, open questions">
        <TextField
          multiline
          rows={4}
          ariaLabel="Loose notes"
          placeholder="Ideas and observations. Label items Planned / Observed / Question so they stay distinct."
          value={episode.notes}
          onChange={(v) => set({ notes: v })}
          onBlur={flush}
        />
        <div className="row wrap">
          <span className="muted small">Add line:</span>
          {['Planned', 'Observed', 'Question'].map((l) => (
            <button key={l} type="button" className="btn small" onClick={() => appendNote(l)}>
              {l}:
            </button>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
