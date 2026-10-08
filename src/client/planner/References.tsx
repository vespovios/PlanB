import { useRef, useState } from 'react';
import { LIMITS, type Attachment, type ImageAttachment, type Scene } from '../../shared/model';
import { randomId } from '../../shared/ids';
import { ApiError, api, assetUrl } from '../api';
import type { EpisodeSync } from '../sync';
import { Confirm, Modal, TextField } from '../components/ui';

export function References({ scene, engine, episodeId }: { scene: Scene; engine: EpisodeSync; episodeId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkForm, setLinkForm] = useState<{ id: string; label: string; url: string } | null>(null);
  const [viewing, setViewing] = useState<ImageAttachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const images = scene.attachments.filter((a): a is ImageAttachment => a.kind === 'image');
  const links = scene.attachments.filter((a) => a.kind === 'link');

  const upload = async (file: File) => {
    setError(null);
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setError('Only PNG and JPEG images can be attached.');
    if (file.size > LIMITS.imageBytes) return setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MiB; the limit is 10 MiB.`);
    setBusy(true);
    try {
      const { asset } = await api.upload(episodeId, file, file.name);
      engine.rememberAsset(asset.id, asset);
      const label = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
      const attachmentId = randomId('at');
      await engine.commitNow(
        [
          { op: 'addImage', sceneId: scene.id, id: attachmentId, assetId: asset.id, label },
          // The first image becomes the card thumbnail unless one is already chosen.
          ...(scene.thumbnailAttachmentId ? [] : [{ op: 'updateScene' as const, sceneId: scene.id, fields: { thumbnailAttachmentId: attachmentId } }]),
        ],
        `Added image reference to "${scene.title}"`,
      );
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="references">
      {images.length > 0 && (
        <ul className="ref-images">
          {images.map((a) => (
            <li key={a.id}>
              <button type="button" className="ref-thumb" onClick={() => setViewing(a)} aria-label={`View ${a.label || 'image'}`}>
                <img src={assetUrl(a.assetId, 320)} alt={a.caption || a.label} loading="lazy" />
                {scene.thumbnailAttachmentId === a.id && <span className="badge">Card</span>}
                {scene.storyboard?.backgroundAttachmentId === a.id && <span className="badge alt">Sketch bg</span>}
              </button>
              <span className="ref-label">{a.label || 'Image'}</span>
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && (
        <ul className="ref-links">
          {links.map((a) => (
            <LinkRow key={a.id} attachment={a} scene={scene} engine={engine} />
          ))}
        </ul>
      )}
      <div className="ref-actions">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button type="button" className="btn small" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : '+ Image'}
        </button>
        <button type="button" className="btn small" onClick={() => setLinkForm({ id: randomId('at'), label: '', url: 'https://' })}>
          + Link
        </button>
        <span className="muted small">PNG/JPEG up to 10 MiB</span>
      </div>
      {linkForm && (
        <form
          className="link-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await engine.commitNow([{ op: 'addLink', sceneId: scene.id, id: linkForm.id, label: linkForm.label.trim(), url: linkForm.url.trim() }]);
              setLinkForm(null);
            } catch (err) {
              setError((err as Error).message.replace(/^Operation \d+ \(\w+\): /, ''));
            }
          }}
        >
          <input placeholder="Label, e.g. Route map" value={linkForm.label} onChange={(e) => setLinkForm({ ...linkForm, label: e.target.value })} aria-label="Link label" required />
          <input placeholder="https://…" type="url" value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} aria-label="Link URL" required />
          <button className="btn small primary">Add link</button>
          <button type="button" className="btn small" onClick={() => setLinkForm(null)}>
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {viewing && (
        <ImageViewer
          attachment={scene.attachments.find((a) => a.id === viewing.id) as ImageAttachment | undefined}
          scene={scene}
          engine={engine}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}

function LinkRow({ attachment, scene, engine }: { attachment: Extract<Attachment, { kind: 'link' }>; scene: Scene; engine: EpisodeSync }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="ref-link">
      {editing ? (
        <div className="stack">
          <TextField
            ariaLabel="Link label"
            required
            value={attachment.label}
            onChange={(v) => engine.queue({ op: 'updateAttachment', sceneId: scene.id, attachmentId: attachment.id, fields: { label: v } }, 700)}
          />
          <TextField
            ariaLabel="Link caption"
            placeholder="Caption (optional)"
            value={attachment.caption}
            onChange={(v) => engine.queue({ op: 'updateAttachment', sceneId: scene.id, attachmentId: attachment.id, fields: { caption: v } }, 700)}
          />
          <div className="row">
            <button type="button" className="btn small" onClick={() => setEditing(false)}>
              Done
            </button>
            <button type="button" className="btn small danger" onClick={() => engine.queue({ op: 'removeAttachment', sceneId: scene.id, attachmentId: attachment.id })}>
              Remove link
            </button>
          </div>
        </div>
      ) : (
        <>
          <a href={attachment.url} target="_blank" rel="noopener noreferrer">
            ↗ {attachment.label}
          </a>
          {attachment.caption && <span className="muted small"> — {attachment.caption}</span>}
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        </>
      )}
    </li>
  );
}

function ImageViewer({ attachment, scene, engine, onClose }: { attachment?: ImageAttachment; scene: Scene; engine: EpisodeSync; onClose: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!attachment) return null;
  const isBackground = scene.storyboard?.backgroundAttachmentId === attachment.id;
  const remove = async () => {
    setError(null);
    try {
      const sb = scene.storyboard;
      await engine.commitNow([
        // Detaching the background keeps the drawing; the preview is re-rendered without the photo.
        ...(isBackground && sb
          ? [
              {
                op: 'saveStoryboard' as const,
                sceneId: scene.id,
                storyboard: { schemaVersion: 1 as const, width: sb.width, height: sb.height, description: sb.description, objects: sb.objects, backgroundAttachmentId: null },
              },
            ]
          : []),
        { op: 'removeAttachment', sceneId: scene.id, attachmentId: attachment.id },
      ]);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setConfirmRemove(false);
    }
  };
  return (
    <Modal title={attachment.label || 'Image reference'} onClose={onClose} wide>
      <div className="image-viewer">
        <a href={assetUrl(attachment.assetId)} target="_blank" rel="noopener" className="image-full">
          <img src={assetUrl(attachment.assetId)} alt={attachment.caption || attachment.label} />
        </a>
        <p className="muted small">
          {attachment.width}×{attachment.height} · {(attachment.bytes / 1024).toFixed(0)} KiB · tap the image to open it full size
        </p>
        <TextField
          label="Label"
          value={attachment.label}
          onChange={(v) => engine.queue({ op: 'updateAttachment', sceneId: scene.id, attachmentId: attachment.id, fields: { label: v } }, 700)}
        />
        <TextField
          label="Caption"
          multiline
          value={attachment.caption}
          placeholder="What this reference shows (optional)"
          onChange={(v) => engine.queue({ op: 'updateAttachment', sceneId: scene.id, attachmentId: attachment.id, fields: { caption: v } }, 700)}
        />
        <div className="row wrap">
          <label className="check">
            <input
              type="checkbox"
              checked={scene.thumbnailAttachmentId === attachment.id}
              onChange={(e) =>
                engine.queue({ op: 'updateScene', sceneId: scene.id, fields: { thumbnailAttachmentId: e.target.checked ? attachment.id : null } })
              }
            />
            <span>Use as card thumbnail{scene.storyboard ? ' (the storyboard preview is shown first)' : ''}</span>
          </label>
          <span className="spacer" />
          <button type="button" className="btn small danger" onClick={() => setConfirmRemove(true)}>
            Remove image
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
      {confirmRemove && (
        <Confirm
          title="Remove image?"
          message={
            isBackground ? (
              <p>
                This image is the background of this scene’s storyboard. Removing it will <strong>detach it from the drawing</strong>: your drawn arrows,
                shapes and labels stay, on a blank background. Earlier versions remain in History.
              </p>
            ) : (
              <p>The image will be removed from this scene. Earlier versions remain in History.</p>
            )
          }
          confirmLabel={isBackground ? 'Detach and remove' : 'Remove'}
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={remove}
        />
      )}
    </Modal>
  );
}
