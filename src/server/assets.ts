// Private image storage: uploaded references and server-rendered storyboard previews.
// Files are immutable and named by asset ID; rows tie each file to an owner and an episode.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type Metadata, type OverlayOptions } from 'sharp';
import { LIMITS } from '../shared/model.js';
import { randomId } from '../shared/ids.js';
import { annotationsSvg, type StoryboardInput } from '../shared/storyboard.js';
import { now, type DB } from './db.js';
import { HttpError } from './errors.js';

export interface AssetRow {
  id: string;
  owner_id: string;
  episode_id: string;
  kind: 'upload' | 'preview';
  mime: 'image/png' | 'image/jpeg';
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  file: string;
  original_name: string | null;
  created_at: string;
}

sharp.cache(false);

export class AssetStore {
  readonly assetsDir: string;
  readonly cacheDir: string;

  constructor(
    private db: DB,
    dataDir: string,
  ) {
    this.assetsDir = path.join(dataDir, 'assets');
    this.cacheDir = path.join(dataDir, 'cache');
    fs.mkdirSync(this.assetsDir, { recursive: true });
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  filePath(row: Pick<AssetRow, 'file'>) {
    return path.join(this.assetsDir, row.file);
  }

  get(id: string): AssetRow | undefined {
    return this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetRow | undefined;
  }

  /** Only returns the asset when the requesting account owns it. */
  getOwned(id: string, ownerId: string): AssetRow | undefined {
    const row = this.get(id);
    return row && row.owner_id === ownerId ? row : undefined;
  }

  forEpisode(episodeId: string): AssetRow[] {
    return this.db.prepare('SELECT * FROM assets WHERE episode_id = ?').all(episodeId) as AssetRow[];
  }

  /** Validates image content on the server; the client-declared type is not trusted. */
  async saveUpload(ownerId: string, episodeId: string, data: Buffer, originalName: string | null): Promise<AssetRow> {
    if (data.length > LIMITS.imageBytes) {
      throw new HttpError(413, `Images can be at most ${LIMITS.imageBytes / 1024 / 1024} MiB.`);
    }
    let meta: Metadata;
    try {
      meta = await sharp(data, { limitInputPixels: LIMITS.imageMaxPixels }).metadata();
    } catch {
      throw new HttpError(415, 'That file is not a readable PNG or JPEG image.');
    }
    if (meta.format !== 'png' && meta.format !== 'jpeg') {
      throw new HttpError(415, 'Only PNG and JPEG images can be attached.');
    }
    // Report the displayed (EXIF-oriented) size.
    const swap = (meta.orientation ?? 1) >= 5;
    const width = (swap ? meta.height : meta.width) ?? 0;
    const height = (swap ? meta.width : meta.height) ?? 0;
    if (!width || !height || width > LIMITS.imageMaxSide || height > LIMITS.imageMaxSide || width * height > LIMITS.imageMaxPixels) {
      throw new HttpError(
        413,
        `Images can be at most ${LIMITS.imageMaxSide}×${LIMITS.imageMaxSide} pixels (${LIMITS.imageMaxPixels / 1_000_000} megapixels).`,
      );
    }
    try {
      await sharp(data).stats(); // decodes the full image so truncated files are rejected
    } catch {
      throw new HttpError(415, 'That image appears to be damaged or incomplete.');
    }
    const mime = meta.format === 'png' ? 'image/png' : 'image/jpeg';
    return this.insert({ ownerId, episodeId, kind: 'upload', mime, data, width, height, originalName });
  }

  /** Writes the file first; the row is inserted by the caller's transaction (see writeFileForRow). */
  prepareFile(id: string, episodeId: string, ext: 'png' | 'jpg', data: Buffer): string {
    const rel = path.join(episodeId, `${id}.${ext}`);
    const full = path.join(this.assetsDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, full);
    return rel;
  }

  insertRow(row: AssetRow) {
    this.db
      .prepare(
        `INSERT INTO assets (id, owner_id, episode_id, kind, mime, bytes, width, height, sha256, file, original_name, created_at)
         VALUES (@id, @owner_id, @episode_id, @kind, @mime, @bytes, @width, @height, @sha256, @file, @original_name, @created_at)`,
      )
      .run(row);
  }

  private insert(a: {
    ownerId: string;
    episodeId: string;
    kind: 'upload' | 'preview';
    mime: 'image/png' | 'image/jpeg';
    data: Buffer;
    width: number;
    height: number;
    originalName: string | null;
    id?: string;
  }): AssetRow {
    const id = a.id ?? randomId('as');
    const file = this.prepareFile(id, a.episodeId, a.mime === 'image/png' ? 'png' : 'jpg', a.data);
    const row: AssetRow = {
      id,
      owner_id: a.ownerId,
      episode_id: a.episodeId,
      kind: a.kind,
      mime: a.mime,
      bytes: a.data.length,
      width: a.width,
      height: a.height,
      sha256: crypto.createHash('sha256').update(a.data).digest('hex'),
      file,
      original_name: a.originalName?.slice(0, 200) ?? null,
      created_at: now(),
    };
    this.insertRow(row);
    return row;
  }

  /**
   * Renders a storyboard document to PNG. The background image is fitted without distortion
   * (contain), exactly like the editor's preserveAspectRatio="xMidYMid meet".
   */
  async renderStoryboard(doc: StoryboardInput, background: AssetRow | null): Promise<Buffer> {
    const composites: OverlayOptions[] = [];
    if (background) {
      const fitted = await sharp(this.filePath(background))
        .rotate()
        .resize(doc.width, doc.height, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
      composites.push({ input: fitted, top: 0, left: 0 });
    }
    composites.push({ input: Buffer.from(annotationsSvg(doc)), top: 0, left: 0 });
    return sharp({ create: { width: doc.width, height: doc.height, channels: 3, background: '#ffffff' } })
      .composite(composites)
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  /** Smaller cached copy for cards and thumbnails. Not part of backups; regenerated on demand. */
  async thumbnail(row: AssetRow, width: number): Promise<string> {
    const target = path.join(this.cacheDir, `${row.id}-w${width}.webp`);
    if (!fs.existsSync(target)) {
      const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
      await sharp(this.filePath(row)).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
      fs.renameSync(tmp, target);
    }
    return target;
  }

  removeFiles(rows: Pick<AssetRow, 'file' | 'id'>[]) {
    for (const r of rows) {
      fs.rmSync(this.filePath(r), { force: true });
      for (const f of fs.readdirSync(this.cacheDir)) if (f.startsWith(`${r.id}-`)) fs.rmSync(path.join(this.cacheDir, f), { force: true });
    }
  }
}
