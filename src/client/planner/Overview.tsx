// Episode overview dashboard: progress, running order, five lines and open questions.
import { formatTime, sceneNumber, totalSeconds, type Episode } from '../../shared/model';
import { parseFiveLines } from '../../shared/outline';
import { Icon, Ring, sceneColour } from '../components/Icon';
import { href, navigate } from '../router';

const stripDay = (loc: string) => loc.replace(/^(Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday)( morning| evening| afternoon)? · /i, '');

export function openQuestions(notes: string): string[] {
  return notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^Question:/i.test(l))
    .map((l) => l.replace(/^Question:\s*/i, ''))
    .filter(Boolean);
}

export function Overview({ episode, onOpenScene }: { episode: Episode; onOpenScene: (sceneId: string) => void }) {
  const total = totalSeconds(episode);
  const target = episode.targetSeconds;
  const shots = episode.scenes.flatMap((s) => s.shots);
  const captured = shots.filter((s) => s.captured).length;
  const essential = shots.filter((s) => s.priority === 'essential').length;
  const sketches = episode.scenes.filter((s) => s.storyboard).length;
  const gear = episode.gear ?? [];
  const longest = Math.max(1, ...episode.scenes.map((s) => s.durationSeconds));
  const five = parseFiveLines(episode.outline);
  const questions = openQuestions(episode.notes);

  const kpis = [
    { ring: target ? total / target : total ? 1 : 0, colour: target && total > target ? '#d4504f' : '#2e9e57', value: formatTime(total), label: target ? `of ${formatTime(target)} target` : 'planned runtime', tab: 'plan' as const },
    { ring: shots.length ? captured / shots.length : 0, colour: '#3a7bd5', value: `${captured}/${shots.length}`, label: 'shots captured', tab: 'shots' as const },
    { ring: shots.length ? essential / shots.length : 0, colour: '#16191f', value: String(essential), label: 'essential shots', tab: 'shots' as const },
    { ring: episode.scenes.length ? sketches / episode.scenes.length : 0, colour: '#9a5bd3', value: `${sketches}/${episode.scenes.length}`, label: 'storyboards', tab: 'storyboard' as const },
    { ring: gear.length ? 1 : 0, colour: '#e08a2e', value: String(gear.length), label: 'kit items', tab: 'kit' as const },
  ];

  if (!episode.scenes.length) {
    return (
      <section className="overview-empty">
        <h2>Start planning</h2>
        <p className="muted">
          Write a short brief and an optional five-line outline, then add scenes with a title and a planned duration. Or ask your connected agent for a first draft.
        </p>
        <div className="row wrap">
          <a className="btn primary" href={href.episode(episode.id, 'plan')}>
            <Icon name="plus" /> Add the first scene
          </a>
          <a className="btn" href={href.episode(episode.id, 'notes')}>
            <Icon name="notes" /> Brief & outline
          </a>
        </div>
      </section>
    );
  }

  return (
    <div className="overview">
      <div className="kpis">
        {kpis.map((k) => (
          <a key={k.label} className="kpi" href={href.episode(episode.id, k.tab)}>
            <Ring value={k.ring} colour={k.colour} size={42} stroke={4.5} />
            <span>
              <b>{k.value}</b>
              <span className="muted small">{k.label}</span>
            </span>
          </a>
        ))}
      </div>
      <div className="overview-grid">
        <section className="box">
          <h3>
            Running order <span className="muted">· {episode.scenes.length} scenes, story order</span>
          </h3>
          <ol className="running">
            {episode.scenes.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenScene(s.id)} aria-label={`Open ${sceneNumber(i)} ${s.title}`}>
                  <span className="scene-tag" style={{ background: sceneColour(i) }}>
                    {sceneNumber(i)}
                  </span>
                  <span className="running-title">
                    <b>{s.title.replace(/^\d+\s*·\s*/, '')}</b>
                    {s.location && <span className="muted"> · {stripDay(s.location)}</span>}
                  </span>
                  <span className="running-bar">
                    <i style={{ width: `${(s.durationSeconds / longest) * 100}%`, background: sceneColour(i) }} />
                  </span>
                  <span className="running-time">{formatTime(s.durationSeconds)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <div className="overview-side">
          <section className="box">
            <h3>The story in five lines</h3>
            {five ? (
              <ol className="five-lines">
                {five.map((l, n) => (
                  <li key={l.key}>
                    <span className="five-num">{n + 1}</span>
                    <span className="five-label">{l.label}</span>
                    <span className={l.text ? '' : 'muted'}>{l.text || '—'}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">
                Optional. Add lines starting with Setup:, Desire:, Conflict:, Change: and Result: to the{' '}
                <a href={href.episode(episode.id, 'notes')}>story outline</a> and they appear here.
              </p>
            )}
          </section>
          <section className="box">
            <h3>
              Open questions{' '}
              {questions.length > 0 && (
                <span className="pill amber">
                  <i />
                  {questions.length}
                </span>
              )}
            </h3>
            {questions.length ? (
              <ul className="questions">
                {questions.slice(0, 6).map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            ) : (
              <p className="muted small">None. Lines in the loose notes that start with “Question:” are collected here.</p>
            )}
            {questions.length > 6 && (
              <a className="link-btn" href={href.episode(episode.id, 'notes')} onClick={(e) => (e.preventDefault(), navigate(href.episode(episode.id, 'notes')))}>
                All {questions.length} questions in Notes →
              </a>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
