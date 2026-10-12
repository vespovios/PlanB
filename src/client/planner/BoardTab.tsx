// Storyboard board: every scene's sketch in story order, click to draw or edit.
import { formatTime, sceneNumber, type Episode } from '../../shared/model';
import { CUT_TYPES, term } from '../../shared/vocab';
import { assetUrl } from '../api';
import { Icon, sceneColour } from '../components/Icon';

export function BoardTab({ episode, onEdit }: { episode: Episode; onEdit: (sceneId: string) => void }) {
  const done = episode.scenes.filter((s) => s.storyboard).length;
  return (
    <section className="board-tab">
      <div className="board-head">
        <p className="muted">
          {done} of {episode.scenes.length} scenes sketched · click a frame to draw or edit
        </p>
      </div>
      <ol className="board-grid">
        {episode.scenes.map((s, i) => {
          const cut = term(CUT_TYPES, s.cutToNext);
          return (
            <li key={s.id} className="board-frame">
              <button type="button" className="board-img" onClick={() => onEdit(s.id)} aria-label={`${s.storyboard ? 'Edit' : 'Draw'} storyboard for ${s.title}`}>
                {s.storyboard ? (
                  <img src={assetUrl(s.storyboard.previewAssetId, 480)} alt={s.storyboard.description || s.title} loading="lazy" />
                ) : (
                  <span className="board-empty">
                    <Icon name="pencil" size={22} /> Draw
                  </span>
                )}
                <span className="board-num" style={{ background: sceneColour(i) }}>
                  {sceneNumber(i)}
                </span>
                <span className="board-time">{formatTime(s.durationSeconds)}</span>
              </button>
              <div className="board-caption">
                <b>{s.title.replace(/^\d+\s*·\s*/, '')}</b>
                {s.storyboard?.description && <span className="muted small">{s.storyboard.description}</span>}
                {cut && i < episode.scenes.length - 1 && <span className="cut-chip">→ {cut.label}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
