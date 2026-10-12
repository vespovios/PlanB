// Accounts, browser sessions and revocable agent tokens.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { randomId } from '../shared/ids.js';
import { now, type DB } from './db.js';
import { HttpError } from './errors.js';

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 96 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

// A fixed hash used to spend the same time on unknown e-mail addresses.
let dummyHash: string | null = null;

export const MIN_PASSWORD_LENGTH = 10;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

export interface User {
  id: string;
  email: string;
  name: string;
}

/** Who is making a request: the account owner in a browser, or an agent acting for that owner. */
export interface Principal {
  user: User;
  kind: 'user' | 'agent';
  label: string;
  tokenId?: string;
}

export class Auth {
  constructor(
    private db: DB,
    private sessionDays: number,
  ) {}

  async createUser(email: string, name: string, password: string): Promise<User> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD_LENGTH} characters`);
    // People are shown by name everywhere in PlanB; the e-mail is only the sign-in.
    if (!name.trim()) throw new HttpError(400, 'Enter a name');
    const normalised = this.checkNewEmail(email);
    const user = { id: randomId('us'), email: normalised, name: name.trim() };
    this.db
      .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, user.email, user.name, await hashPassword(password), now());
    return user;
  }

  async setPassword(userId: string, password: string) {
    if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD_LENGTH} characters`);
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), userId);
    // Changing a password signs out every other browser session.
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  /** Changes the sign-in e-mail. Sessions, tokens and episodes stay with the account. */
  setEmail(userId: string, email: string): string {
    const normalised = this.checkNewEmail(email, userId);
    this.db.prepare('UPDATE users SET email = ? WHERE id = ?').run(normalised, userId);
    return normalised;
  }

  setName(userId: string, name: string) {
    if (!name.trim()) throw new HttpError(400, 'Enter a name');
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), userId);
  }

  private checkNewEmail(email: string, exceptUserId?: string): string {
    const normalised = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(normalised)) throw new HttpError(400, 'Enter a valid e-mail address');
    const exists = this.db.prepare('SELECT id FROM users WHERE email = ?').get(normalised) as { id: string } | undefined;
    if (exists && exists.id !== exceptUserId) throw new HttpError(409, 'An account with that e-mail already exists');
    return normalised;
  }

  /** Lets `memberId` see and edit all of `ownerId`'s episodes. */
  share(ownerId: string, memberId: string) {
    if (ownerId === memberId) throw new HttpError(400, 'An account already has its own episodes');
    this.db.prepare('INSERT OR IGNORE INTO account_shares (owner_id, member_id, created_at) VALUES (?, ?, ?)').run(ownerId, memberId, now());
  }

  unshare(ownerId: string, memberId: string): boolean {
    return this.db.prepare('DELETE FROM account_shares WHERE owner_id = ? AND member_id = ?').run(ownerId, memberId).changes > 0;
  }

  listShares(): { owner: string; member: string; created_at: string }[] {
    return this.db
      .prepare(
        `SELECT o.name AS owner, m.name AS member, s.created_at FROM account_shares s
         JOIN users o ON o.id = s.owner_id JOIN users m ON m.id = s.member_id ORDER BY s.created_at`,
      )
      .all() as never;
  }

  listUsers(): (User & { created_at: string })[] {
    return this.db.prepare('SELECT id, email, name, created_at FROM users ORDER BY created_at').all() as never;
  }

  findUserByEmail(email: string): User | undefined {
    return this.db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email.trim().toLowerCase()) as User | undefined;
  }

  async checkCredentials(email: string, password: string): Promise<User | null> {
    const row = this.db
      .prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
    if (!row) {
      dummyHash ??= await hashPassword('planb-timing-equaliser');
      await verifyPassword(password, dummyHash);
      return null;
    }
    if (!(await verifyPassword(password, row.password_hash))) return null;
    return { id: row.id, email: row.email, name: row.name };
  }

  createSession(userId: string): { token: string; expires: Date } {
    const token = randomToken();
    const expires = new Date(Date.now() + this.sessionDays * 86_400_000);
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), userId, now(), expires.toISOString());
    return { token, expires };
  }

  sessionUser(token: string | undefined): User | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(sha256(token)) as (User & { expires_at: string }) | undefined;
    if (!row) return null;
    if (row.expires_at < now()) {
      this.destroySession(token);
      return null;
    }
    return { id: row.id, email: row.email, name: row.name };
  }

  destroySession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  pruneSessions() {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  }

  // --- Agent tokens -------------------------------------------------------

  createAgentToken(userId: string, label: string) {
    const clean = label.trim().slice(0, 80) || 'Agent';
    const secret = `planb_${randomToken()}`;
    const id = randomId('tk');
    this.db
      .prepare('INSERT INTO agent_tokens (id, user_id, label, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, userId, clean, sha256(secret), secret.slice(0, 12), now());
    return { id, label: clean, token: secret };
  }

  listAgentTokens(userId: string) {
    return this.db
      .prepare(
        'SELECT id, label, prefix, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC',
      )
      .all(userId);
  }

  revokeAgentToken(userId: string, tokenId: string): boolean {
    const r = this.db
      .prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
      .run(now(), tokenId, userId);
    return r.changes > 0;
  }

  agentPrincipal(secret: string): Principal | null {
    const row = this.db
      .prepare(
        `SELECT t.id AS token_id, t.label, u.id, u.email, u.name FROM agent_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
      )
      .get(sha256(secret)) as (User & { token_id: string; label: string }) | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.token_id);
    return {
      user: { id: row.id, email: row.email, name: row.name },
      kind: 'agent',
      label: `Agent: ${row.label}`,
      tokenId: row.token_id,
    };
  }
}

/** Simple in-memory failure counter per e-mail, alongside the per-IP rate limit on the login route. */
export class LoginThrottle {
  private failures = new Map<string, { count: number; first: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  blocked(email: string) {
    const f = this.failures.get(email.trim().toLowerCase());
    if (!f) return false;
    if (Date.now() - f.first > this.windowMs) {
      this.failures.delete(email.trim().toLowerCase());
      return false;
    }
    return f.count >= this.max;
  }
  fail(email: string) {
    const key = email.trim().toLowerCase();
    const f = this.failures.get(key);
    if (!f || Date.now() - f.first > this.windowMs) this.failures.set(key, { count: 1, first: Date.now() });
    else f.count++;
  }
  succeed(email: string) {
    this.failures.delete(email.trim().toLowerCase());
  }
}
