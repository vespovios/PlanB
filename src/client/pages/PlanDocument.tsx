// Production pack: a printable, field-ready plan (browser Print → Save as PDF).
// Layout ideas follow professional pre-production documents (cover facts, colour-coded scene
// banners, a checkable shot list with size/angle/movement, a storyboard board, and a
// shot & cut guide) adapted for a solo creator filming on the road.
import { useMemo, useState, type ReactNode } from 'react';
import { buildChecklist, filmSlot, type ChecklistOrder } from '../../shared/checklist';
import { parseFiveLines } from '../../shared/outline';
import { GEAR_KINDS, capturedCount, formatTime, sceneNumber, sceneStarts, totalSeconds, type Episode, type GearItem, type ImageAttachment, type Scene } from '../../shared/model';
import { GEAR_KIND_LABELS } from '../planner/KitList';
import { CUT_TYPES, PACING, SHOT_ANGLES, SHOT_MOVEMENTS, SHOT_SIZES, term, type Term } from '../../shared/vocab';
import { assetUrl, type User } from '../api';
import { Shell } from '../components/Shell';
import { useEpisodeSync } from '../sync';
import { TopBar } from '../components/TopBar';
import { Logo } from '../components/ui';
import { ShotSizeIcon } from '../components/ShotIcons';
import { sceneThumbnail } from '../planner/Cards';
import { href } from '../router';

const PALETTE = ['#2f6fdf', '#d9822b', '#2e9e6a', '#a24fd0', '#d64545', '#1aa3b8', '#b8960c', '#6b7a99'];
const NO_LOCATION = '#9aa3b2';

type Section = 'cover' | 'kit' | 'story' | 'shots' | 'board' | 'breakdown' | 'guides' | 'notes';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'cover', label: 'Cover & overview' },
  { key: 'kit', label: 'Kit & packing list' },
  { key: 'story', label: 'Story outline' },
  { key: 'shots', label: 'Shot list' },
  { key: 'board', label: 'Storyboard' },
  { key: 'breakdown', label: 'Scene breakdown' },
  { key: 'guides', label: 'Shot & cut guide' },
  { key: 'notes', label: 'Loose notes' },
];

const kitOf = (t: Term) => t.kit;
const clip = (text: string, max: number) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
/** Shot reference like 4A, 4B … (scene number + letter), as on professional shot lists. */
const shotRef = (sceneIndex: number, shotIndex: number) => `${sceneIndex + 1}${shotIndex < 26 ? String.fromCharCode(65 + shotIndex) : `.${shotIndex + 1}`}`;
const cssString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

async function printWhenImagesReady() {
  const images = [...document.querySelectorAll<HTMLImageElement>('.pk img')];
  await Promise.all(images.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
  window.print();
}

/** Each scene keeps one colour throughout the pack (banners, running order, board). */
function sceneColours(episode: Episode) {
  const map = new Map(episode.scenes.map((s, i) => [s.id, PALETTE[i % PALETTE.length]]));
  return { of: (scene: Scene) => map.get(scene.id) ?? NO_LOCATION };
}

export function PlanDocumentPage({ id, user, onSignOut }: { id: string; user: User; onSignOut: () => void }) {
  const { episode, loadError } = useEpisodeSync(id);
  const [on, setOn] = useState<Record<Section, boolean>>({ cover: true, kit: true, story: true, shots: true, board: true, breakdown: true, guides: true, notes: false });
  const [order, setOrder] = useState<ChecklistOrder>('story');
  const [scenePerPage, setScenePerPage] = useState(false);
  const [references, setReferences] = useState(true);
  const colours = useMemo(() => (episode ? sceneColours(episode) : null), [episode]);

  if (loadError) return <p className="error center">{loadError}</p>;
  if (!episode || !colours) return <div className="boot">Loading plan…</div>;

  const starts = sceneStarts(episode);
  const total = totalSeconds(episode);
  const shots = episode.scenes.flatMap((s) => s.shots);
  const essential = shots.filter((s) => s.priority === 'essential').length;
  // Only show spec columns that this plan actually uses.
  const cols = { size: shots.some((s) => s.size), angle: shots.some((s) => s.angle), movement: shots.some((s) => s.movement), gear: shots.some((s) => s.gear?.length) };
  const gearById = new Map((episode.gear ?? []).map((g) => [g.id, g]));
  const printedAt = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const footer = `${episode.title} · PlanB revision ${episode.revision}`;

  return (
    <Shell user={user} onSignOut={onSignOut} episodeId={id} tab="document">
    <div className="page plan-doc-page">
      {/* Running footer with page numbers on every printed page. */}
      <style>{`@page { size: A4; margin: 12mm 12mm 15mm; @bottom-left { content: ${cssString(footer)}; font: 7.5pt system-ui, sans-serif; color: #7a8394; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt system-ui, sans-serif; color: #7a8394; } }`}</style>
      <TopBar crumb={<a href={href.planner(episode.id)}>← {episode.title}</a>}>
        <button type="button" className="btn primary" onClick={() => void printWhenImagesReady()}>
          Print / Save as PDF
        </button>
      </TopBar>

      <div className="pk-options no-print">
        <div className="pk-option-group">
          <span className="pk-option-title">Include</span>
          {SECTIONS.map((s) => (
            <label key={s.key} className="check">
              <input type="checkbox" checked={on[s.key]} onChange={(e) => setOn({ ...on, [s.key]: e.target.checked })} />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
        <div className="pk-option-group">
          <span className="pk-option-title">Layout</span>
          <label className="pk-select">
            <span>Shot list order</span>
            <select value={order} onChange={(e) => setOrder(e.target.value as ChecklistOrder)}>
              <option value="story">Story order</option>
              <option value="filming">Filming order (day, then stop)</option>
              <option value="location">Grouped by location</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={scenePerPage} onChange={(e) => setScenePerPage(e.target.checked)} />
            <span>Scene breakdown: one scene per page</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={references} onChange={(e) => setReferences(e.target.checked)} />
            <span>Reference images in breakdown</span>
          </label>
        </div>
        <p className="muted small">Tip: in the print dialog choose “Save as PDF”, A4, and turn off the browser’s own headers and footers.</p>
      </div>

      <article className="pk">
        {on.cover && <Cover episode={episode} starts={starts} total={total} essential={essential} shots={shots.length} colours={colours} printedAt={printedAt} />}

        {on.kit && (episode.gear ?? []).length > 0 && <KitSection episode={episode} />}

        {on.story && episode.outline.trim() && (
          <PkSection title="Story outline" kicker="Story">
            {episode.brief.trim() && !on.cover && <p className="pk-lede">{episode.brief.trim()}</p>}
            <div className="pk-outline">{episode.outline.trim()}</div>
          </PkSection>
        )}

        {on.shots && (
          <PkSection title="Shot list" kicker="On location" note={`${essential} essential · ${shots.length - essential} optional · ★ = essential · tick when filmed (captured ≠ reviewed)`}>
            {buildChecklist(episode, order).map((group, gi) => (
              <div key={gi} className="pk-shot-group">
                {order === 'location' && <h3 className="pk-group-title">📍 {group.label ?? 'No location given'}</h3>}
                {order === 'filming' && <h3 className="pk-group-title">🎬 {group.label ?? 'No filming day set'}</h3>}
                {group.scenes.map(({ scene, index, start }) => (
                  <ShotTable key={scene.id} scene={scene} index={index} start={start} colour={colours.of(scene)} cols={cols} gearById={gearById} />
                ))}
              </div>
            ))}
          </PkSection>
        )}

        {on.board && episode.scenes.length > 0 && (
          <PkSection title="Storyboard" kicker="Board">
            <div className="pk-board">
              {episode.scenes.map((s, i) => {
                const thumb = sceneThumbnail(s);
                const cut = term(CUT_TYPES, s.cutToNext);
                const firstSized = s.shots.find((x) => x.size);
                return (
                  <figure key={s.id} className="pk-frame" style={{ ['--scene' as string]: colours.of(s) }}>
                    <div className="pk-frame-img">
                      {thumb ? (
                        <img src={assetUrl(thumb, 960)} alt={s.storyboard?.description || s.title} />
                      ) : (
                        <div className="pk-frame-empty">
                          {firstSized ? <ShotSizeIcon size={firstSized.size} /> : null}
                          <span>{sceneNumber(i)}</span>
                        </div>
                      )}
                      <span className="pk-frame-num">{sceneNumber(i)}</span>
                      <span className="pk-frame-time">{formatTime(s.durationSeconds)}</span>
                    </div>
                    <figcaption>
                      <strong>{s.title}</strong>
                      {s.purpose && <span className="pk-frame-purpose">{clip(s.purpose, 140)}</span>}
                      {s.voiceover && <span className="pk-frame-vo">VO: {clip(s.voiceover, 120)}</span>}
                      {cut && i < episode.scenes.length - 1 && <span className="pk-cut-chip">→ {cut.label}</span>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </PkSection>
        )}

        {on.breakdown && episode.scenes.length > 0 && (
          <PkSection title="Scene breakdown" kicker="Detail" className={scenePerPage ? 'scene-per-page' : ''}>
            {episode.scenes.map((s, i) => (
              <SceneBreakdown key={s.id} scene={s} index={i} start={starts[i]} colour={colours.of(s)} references={references} isLast={i === episode.scenes.length - 1} />
            ))}
          </PkSection>
        )}

        {on.guides && <Guides episode={episode} />}

        {on.notes && episode.notes.trim() && (
          <PkSection title="Loose notes" kicker="Notes">
            <div className="pk-pre pk-notes">{episode.notes.trim()}</div>
          </PkSection>
        )}
      </article>
    </div>
    </Shell>
  );
}

function PkSection({ title, kicker, note, className, children }: { title: string; kicker: string; note?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`pk-section ${className ?? ''}`}>
      <header className="pk-section-head">
        <span className="pk-kicker">{kicker}</span>
        <h2>{title}</h2>
        {note && <p className="pk-section-note">{note}</p>}
      </header>
      {children}
    </section>
  );
}

function Cover(props: {
  episode: Episode;
  starts: number[];
  total: number;
  essential: number;
  shots: number;
  colours: ReturnType<typeof sceneColours>;
  printedAt: string;
}) {
  const { episode, starts, total, colours } = props;
  const span = Math.max(total, episode.targetSeconds ?? 0, 1);
  const sketches = episode.scenes.filter((s) => sceneThumbnail(s));
  const fiveLines = parseFiveLines(episode.outline);
  const facts: [string, string, string?][] = [
    ['Runtime', formatTime(total), episode.targetSeconds ? `target ${formatTime(episode.targetSeconds)}` : undefined],
    ['Scenes', String(episode.scenes.length)],
    ['Shots', String(props.shots), `${props.essential} essential`],
    ['Storyboards', String(sketches.length), `of ${episode.scenes.length} scenes`],
    ['Status', episode.status === 'ready' ? 'Ready' : 'Draft'],
  ];
  return (
    <section className="pk-cover">
      <div className="pk-cover-top">
        <Logo size="lg" />
        <div className="pk-cover-meta">
          <span>Production pack</span>
          <span>
            Rev {episode.revision} · {props.printedAt}
          </span>
        </div>
      </div>
      <h1>{episode.title}</h1>
      {episode.brief.trim() && <p className="pk-lede">{episode.brief.trim()}</p>}
      <div className="pk-facts">
        {facts.map(([label, value, sub]) => (
          <div key={label} className="pk-fact">
            <span className="pk-fact-label">{label}</span>
            <span className="pk-fact-value">{value}</span>
            {sub && <span className="pk-fact-sub">{sub}</span>}
          </div>
        ))}
      </div>

      {fiveLines && (
        <div className="pk-five">
          <div className="pk-subhead">The story in five lines</div>
          <ol>
            {fiveLines.map((l, n) => (
              <li key={l.key} className={l.text ? '' : 'empty'}>
                <span className="pk-five-num">{n + 1}</span>
                <span className="pk-five-label">{l.label}</span>
                <span className="pk-five-text">{l.text || '—'}</span>
                <span className="pk-five-scenes">
                  {l.scenes
                    .filter((num) => num >= 1 && num <= episode.scenes.length)
                    .map((num) => (
                      <span key={num} className="pk-scene-chip" style={{ background: colours.of(episode.scenes[num - 1]) }}>
                        {sceneNumber(num - 1)}
                      </span>
                    ))}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {episode.scenes.length > 0 && (
        <div className="pk-runbar-wrap">
          <div className="pk-subhead">Running order</div>
          <div className="pk-runbar">
            {episode.scenes.map((s, i) => (
              <div
                key={s.id}
                className="pk-runbar-seg"
                style={{ width: `${(s.durationSeconds / span) * 100}%`, background: colours.of(s) }}
                title={`${sceneNumber(i)} ${s.title}`}
              >
                <span>{sceneNumber(i)}</span>
              </div>
            ))}
            {episode.targetSeconds && episode.targetSeconds > total && (
              <div className="pk-runbar-gap" style={{ width: `${((episode.targetSeconds - total) / span) * 100}%` }} />
            )}
          </div>
          <div className="pk-runbar-scale">
            <span>00:00</span>
            <span>{formatTime(span)}</span>
          </div>
          <table className="pk-running">
            <tbody>
              {episode.scenes.map((s, i) => {
                const c = capturedCount(s);
                return (
                  <tr key={s.id}>
                    <td>
                      <span className="pk-dot" style={{ background: colours.of(s) }} />
                      <strong>{sceneNumber(i)}</strong>
                    </td>
                    <td>{s.title}</td>
                    <td className="num">
                      {formatTime(starts[i])}–{formatTime(starts[i] + s.durationSeconds)}
                    </td>
                    <td className="num">{formatTime(s.durationSeconds)}</td>
                    <td className="pk-running-loc">{clip(s.location, 60)}</td>
                    <td className="num">
                      {c.captured}/{c.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sketches.length >= 3 && (
        <div className="pk-filmstrip">
          {sketches.slice(0, 8).map((s) => (
            <img key={s.id} src={assetUrl(sceneThumbnail(s)!, 480)} alt={s.title} />
          ))}
        </div>
      )}
      <p className="pk-cover-foot">“Captured” means you reported filming a shot; it does not mean the footage has been reviewed. Planned durations are screen time, not filming time.</p>
    </section>
  );
}

function SpecCell({ list, value }: { list: readonly Term[]; value: string | null | undefined }) {
  const t = term(list, value);
  return t ? <span title={`${t.label}: ${t.definition}`}>{t.abbr}</span> : <span className="pk-faint">—</span>;
}

interface SpecColumns {
  size: boolean;
  angle: boolean;
  movement: boolean;
  gear: boolean;
}

function ShotTable({ scene, index, start, colour, cols, gearById }: { scene: Scene; index: number; start: number; colour: string; cols: SpecColumns; gearById: Map<string, GearItem> }) {
  const sceneGear = [...new Set(scene.shots.flatMap((sh) => sh.gear ?? []))].map((id) => gearById.get(id)?.name).filter(Boolean);
  const c = capturedCount(scene);
  return (
    <div className={`pk-scene-block ${scene.shots.length <= 6 ? 'keep-together' : ''}`} style={{ ['--scene' as string]: colour }}>
      <div className="pk-banner">
        <span className="pk-banner-num">{sceneNumber(index)}</span>
        <span className="pk-banner-title">{scene.title}</span>
        <span className="pk-banner-meta">
          {formatTime(start)}–{formatTime(start + scene.durationSeconds)} · {formatTime(scene.durationSeconds)}
        </span>
        <span className="pk-banner-count">
          ☐ {c.captured}/{c.total}
        </span>
      </div>
      <div className="pk-banner-sub">
        {filmSlot(scene) && <span>🎬 {filmSlot(scene)}</span>}
        {scene.location && <span>📍 {clip(scene.location, 90)}</span>}
        {scene.purpose && <span>◎ {clip(scene.purpose, 160)}</span>}
        {scene.audio && <span>♪ {clip(scene.audio, 140)}</span>}
        {sceneGear.length > 0 && <span>🎒 {sceneGear.join(' · ')}</span>}
      </div>
      {scene.shots.length > 0 ? (
        <table className="pk-shots">
          <thead>
            <tr>
              <th className="col-check" aria-label="Filmed" />
              <th className="col-ref">Shot</th>
              {cols.size && <th className="col-size">Size</th>}
              {cols.angle && <th className="col-spec">Angle</th>}
              {cols.movement && <th className="col-spec">Move</th>}
              <th>Description</th>
              {cols.gear && <th className="col-gear">Gear</th>}
              <th className="col-pri" aria-label="Priority" />
            </tr>
          </thead>
          <tbody>
            {scene.shots.map((shot, j) => (
              <tr key={shot.id} className={shot.priority === 'essential' ? 'is-essential' : 'is-optional'}>
                <td className="col-check">
                  <span className={`pk-box ${shot.captured ? 'ticked' : ''}`}>{shot.captured ? '✓' : ''}</span>
                </td>
                <td className="col-ref">{shotRef(index, j)}</td>
                {cols.size && (
                  <td className="col-size">
                    {shot.size ? (
                      <span className="pk-size">
                        <ShotSizeIcon size={shot.size} />
                        {term(SHOT_SIZES, shot.size)?.abbr}
                      </span>
                    ) : (
                      <span className="pk-faint">—</span>
                    )}
                  </td>
                )}
                {cols.angle && (
                  <td className="col-spec">
                    <SpecCell list={SHOT_ANGLES} value={shot.angle} />
                  </td>
                )}
                {cols.movement && (
                  <td className="col-spec">
                    <SpecCell list={SHOT_MOVEMENTS} value={shot.movement} />
                  </td>
                )}
                <td>
                  {shot.framing && <strong>{shot.framing}: </strong>}
                  {shot.description}
                  {shot.cameraNotes && <span className="pk-shot-notes">{shot.cameraNotes}</span>}
                </td>
                {cols.gear && (
                  <td className="col-gear">
                    {(shot.gear ?? []).map((id) => gearById.get(id)).filter(Boolean).map((g) => (
                      <span key={g!.id} className="pk-gear-tag">
                        {g!.name}
                      </span>
                    ))}
                  </td>
                )}
                <td className="col-pri">{shot.priority === 'essential' ? '★' : <span className="pk-faint">opt</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pk-faint pk-noshots">No shots listed.</p>
      )}
    </div>
  );
}

function SceneBreakdown({ scene, index, start, colour, references, isLast }: { scene: Scene; index: number; start: number; colour: string; references: boolean; isLast: boolean }) {
  const thumb = sceneThumbnail(scene);
  const images = scene.attachments.filter((a): a is ImageAttachment => a.kind === 'image');
  const links = scene.attachments.filter((a) => a.kind === 'link');
  const cut = term(CUT_TYPES, scene.cutToNext);
  const field = (label: string, text: string, cls = '') =>
    text.trim() ? (
      <div className={`pk-field ${cls}`}>
        <h4>{label}</h4>
        <p className="pk-pre">{text.trim()}</p>
      </div>
    ) : null;
  return (
    <div className="pk-breakdown" style={{ ['--scene' as string]: colour }}>
      <div className="pk-banner">
        <span className="pk-banner-num">{sceneNumber(index)}</span>
        <span className="pk-banner-title">{scene.title}</span>
        <span className="pk-banner-meta">
          {formatTime(start)}–{formatTime(start + scene.durationSeconds)} · {formatTime(scene.durationSeconds)} · {scene.status === 'ready' ? 'Ready to film' : 'Draft'}
        </span>
      </div>
      <div className={`pk-breakdown-body ${thumb ? 'has-image' : ''}`}>
        {thumb && (
          <figure className="pk-breakdown-img">
            <img src={assetUrl(thumb, 960)} alt={scene.storyboard?.description || scene.title} />
            {scene.storyboard?.description && <figcaption>{scene.storyboard.description}</figcaption>}
          </figure>
        )}
        <div className="pk-breakdown-text">
          {scene.location && <p className="pk-loc">📍 {scene.location}</p>}
          {field('Why it belongs', scene.purpose)}
          {field('What happens', scene.description)}
        </div>
      </div>
      <div className="pk-fields">
        {scene.voiceover.trim() && (
          <div className="pk-field pk-vo">
            <h4>Voice-over</h4>
            <blockquote className="pk-pre">{scene.voiceover.trim()}</blockquote>
          </div>
        )}
        {field('Audio / music', scene.audio)}
        {field('Notes / edit intent', scene.notes, 'wide')}
      </div>
      {cut && !isLast && (
        <p className="pk-cut-line">
          <span className="pk-cut-chip">Cut to next: {cut.label}</span> {cut.use}
        </p>
      )}
      {references && (images.length > 0 || links.length > 0) && (
        <div className="pk-refs">
          <h4>References</h4>
          {images.length > 0 && (
            <div className="pk-ref-images">
              {images.map((a) => (
                <figure key={a.id}>
                  <img src={assetUrl(a.assetId, 480)} alt={a.caption || a.label} />
                  <figcaption>{[a.label, a.caption].filter(Boolean).join(' — ')}</figcaption>
                </figure>
              ))}
            </div>
          )}
          {links.length > 0 && (
            <ul className="pk-links">
              {links.map((a) => (
                <li key={a.id}>
                  {a.label}: <span className="url">{a.kind === 'link' ? a.url : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Guides({ episode }: { episode: Episode }) {
  const count = (pick: (s: Scene['shots'][number]) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const sc of episode.scenes) for (const sh of sc.shots) {
      const k = pick(sh);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const sizes = count((s) => s.size);
  const angles = count((s) => s.angle);
  const moves = count((s) => s.movement);
  const cutsUsed = new Map<string, string[]>();
  episode.scenes.forEach((s, i) => {
    if (s.cutToNext && i < episode.scenes.length - 1) {
      const list = cutsUsed.get(s.cutToNext) ?? [];
      list.push(`${sceneNumber(i)}→${sceneNumber(i + 1)}`);
      cutsUsed.set(s.cutToNext, list);
    }
  });
  const usedTag = (n: number | undefined) => (n ? <span className="pk-used">used ×{n}</span> : null);
  return (
    <section className="pk-section pk-guides">
      <header className="pk-section-head">
        <span className="pk-kicker">Reference</span>
        <h2>Shot & cut guide</h2>
        <p className="pk-section-note">Highlighted entries are used in this plan. “Kit” points to the page in your Story Starter Kit guides.</p>
      </header>
      <h3 className="pk-guide-title">Shot sizes</h3>
      <div className="pk-size-grid">
        {SHOT_SIZES.map((t) => (
          <div key={t.key} className={`pk-size-card ${sizes.has(t.key) ? 'used' : ''}`}>
            <ShotSizeIcon size={t.key} />
            <div>
              <strong>
                {t.abbr} · {t.label}
              </strong>
              {usedTag(sizes.get(t.key))}
              <p>{t.definition}</p>
              <p className="pk-faint">{t.use}</p>
              {kitOf(t) && <p className="pk-kit">Kit: {kitOf(t)}</p>}
            </div>
          </div>
        ))}
      </div>
      <div className="pk-guide-cols">
        <GuideTable title="Camera angles" list={SHOT_ANGLES} used={angles} />
        <GuideTable title="Camera movement" list={SHOT_MOVEMENTS} used={moves} />
      </div>
      <h3 className="pk-guide-title">Cut guide (for the rough edit)</h3>
      <p className="pk-pacing">
        <strong>{PACING.label}:</strong> {PACING.text} <span className="pk-kit">Kit: {PACING.kit}</span>
      </p>
      <table className="pk-guide-table pk-cuts">
        <tbody>
          {CUT_TYPES.map((t) => (
            <tr key={t.key} className={cutsUsed.has(t.key) ? 'used' : ''}>
              <td className="pk-guide-abbr">{t.label}</td>
              <td>
                {t.definition} <span className="pk-faint">{t.use}</span>
                {kitOf(t) && <span className="pk-kit"> Kit: {kitOf(t)}</span>}
                {cutsUsed.has(t.key) && <span className="pk-used">planned {cutsUsed.get(t.key)!.join(', ')}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GuideTable({ title, list, used }: { title: string; list: readonly Term[]; used: Map<string, number> }) {
  return (
    <div>
      <h3 className="pk-guide-title">{title}</h3>
      <table className="pk-guide-table">
        <tbody>
          {list.map((t) => (
            <tr key={t.key} className={used.has(t.key) ? 'used' : ''}>
              <td className="pk-guide-abbr">{t.abbr}</td>
              <td>
                <strong>{t.label}</strong> — {t.use}
                {kitOf(t) && <span className="pk-kit"> Kit: {kitOf(t)}</span>}
                {used.has(t.key) && <span className="pk-used">×{used.get(t.key)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KitSection({ episode }: { episode: Episode }) {
  const gear = episode.gear ?? [];
  const usedIn = (id: string) =>
    episode.scenes.flatMap((sc, i) => sc.shots.map((sh, j) => (sh.gear?.includes(id) ? shotRef(i, j) : null))).filter((x): x is string => !!x);
  return (
    <PkSection title="Kit & packing list" kicker="Before you leave" note="Tick as you pack. “Used in” lists the shots that need each item.">
      <div className="pk-kit-groups">
        {GEAR_KINDS.filter((k) => gear.some((g) => g.kind === k)).map((k) => (
          <div key={k} className="pk-kit-group">
            <h3 className="pk-guide-title">{GEAR_KIND_LABELS[k]}</h3>
            <table className="pk-kit-table">
              <tbody>
                {gear
                  .filter((g) => g.kind === k)
                  .map((g) => {
                    const refs = usedIn(g.id);
                    return (
                      <tr key={g.id}>
                        <td className="col-check">
                          <span className="pk-box" />
                        </td>
                        <td>
                          <strong>{g.name}</strong>
                          {g.notes && <span className="pk-shot-notes">{g.notes}</span>}
                        </td>
                        <td className="pk-kit-used">{refs.length ? `Used in ${refs.length > 12 ? `${refs.slice(0, 12).join(', ')} +${refs.length - 12}` : refs.join(', ')}` : <span className="pk-faint">not assigned</span>}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="pk-kit-extra">
        <h3 className="pk-guide-title">Every day</h3>
        <ul>
          {['Batteries charged', 'Cards formatted / space checked', 'Lenses and mic windshields clean', 'Spare cables and power bank', 'Footage backed up (evening)'].map((t) => (
            <li key={t}>
              <span className="pk-box" /> {t}
            </li>
          ))}
        </ul>
      </div>
    </PkSection>
  );
}
