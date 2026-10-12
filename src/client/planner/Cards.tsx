import { useRef, useState } from 'react';
import { capturedCount, formatTime, outcomeSummary, sceneNumber, sceneStarts, type Scene } from '../../shared/model';
import { assetUrl } from '../api';
import { capturePointer } from '../components/ui';

export function sceneThumbnail(scene: Scene): string | null {
  // Prefer the saved storyboard preview; otherwise the creator's chosen image reference.
  if (scene.storyboard) return scene.storyboard.previewAssetId;
  const att = scene.attachments.find((a) => a.id === scene.thumbnailAttachmentId && a.kind === 'image');
  return att && att.kind === 'image' ? att.assetId : null;
}

interface Props {
  scenes: Scene[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, index: number) => void;
  layout: 'grid' | 'list';
}

/** Ordered storyboard cards. Same scenes and order as the timeline; no status columns. */
export function Cards({ scenes, selectedId, onSelect, onMove, layout }: Props) {
  const starts = sceneStarts({ scenes });
  const [drag, setDrag] = useState<{ id: string; pointerId: number; over: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const overIndex = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-card-index]') as HTMLElement | null;
    return el ? Number(el.dataset.cardIndex) : null;
  };

  return (
    <ol
      ref={listRef}
      className={`cards ${layout}`}
      aria-label="Scenes in story order"
      onPointerMove={(e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const over = overIndex(e.clientX, e.clientY);
        if (over !== null && over !== drag.over) setDrag({ ...drag, over });
      }}
      onPointerUp={(e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const from = scenes.findIndex((s) => s.id === drag.id);
        if (drag.over !== from) onMove(drag.id, drag.over);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {scenes.map((s, i) => {
        const thumb = sceneThumbnail(s);
        const c = capturedCount(s);
        const total = c.total;
        const dragging = drag?.id === s.id;
        const dropHere = drag && !dragging && drag.over === i;
        return (
          <li
            key={s.id}
            data-card-index={i}
            className={`card ${s.id === selectedId ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${dropHere ? 'drop-target' : ''}`}
          >
            <button type="button" className="card-main" onClick={() => onSelect(s.id)} aria-current={s.id === selectedId}>
              <span className="card-thumb" aria-hidden={!thumb}>
                {thumb ? <img src={assetUrl(thumb, 320)} alt="" loading="lazy" /> : <span className="card-thumb-empty" aria-hidden>{sceneNumber(i)}</span>}
              </span>
              <span className="card-body">
                <span className="card-top">
                  <span className="card-num">{sceneNumber(i)}</span>
                  <span className={`status-chip ${s.status}`}>{s.status === 'ready' ? 'Ready' : 'Draft'}</span>
                </span>
                <span className="card-title">{s.title}</span>
                <span className="card-meta">
                  {formatTime(s.durationSeconds)}
                  <span className="muted"> · at {formatTime(starts[i])}</span>
                  {total > 0 && (
                    <span className="muted" title="Filmed (reported) · skipped on purpose · still open">
                      {' '}
                      · {outcomeSummary(c)}
                    </span>
                  )}
                </span>
              </span>
            </button>
            <div className="card-tools">
              <span
                className="drag-handle"
                role="presentation"
                title="Drag to reorder"
                onPointerDown={(e) => {
                  e.preventDefault();
                  capturePointer(listRef.current, e.pointerId);
                  setDrag({ id: s.id, pointerId: e.pointerId, over: i });
                }}
              >
                ⠿
              </span>
              <button type="button" className="icon-btn" aria-label={`Move ${s.title} earlier`} disabled={i === 0} onClick={() => onMove(s.id, i - 1)}>
                {layout === 'list' ? '↑' : '←'}
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${s.title} later`}
                disabled={i === scenes.length - 1}
                onClick={() => onMove(s.id, i + 1)}
              >
                {layout === 'list' ? '↓' : '→'}
              </button>
            </div>
          </li>
        );
      })}
      {!scenes.length && <li className="cards-empty muted">No scenes yet. Add the first one with “+ Scene”.</li>}
    </ol>
  );
}
