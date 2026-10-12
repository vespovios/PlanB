import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { checklistMarkdown, buildChecklist } from '../shared/checklist.js';
import { LIMITS } from '../shared/model.js';
import { AssetStore } from './assets.js';
import { Auth, LoginThrottle, type Principal } from './auth.js';
import type { Config } from './config.js';
import { openDatabase, type DB } from './db.js';
import { Episodes } from './episodes.js';
import { HttpError, badRequest, notFound } from './errors.js';
import { buildExport } from './export.js';
import { agentEpisodeView, createMcpServer } from './mcp.js';
import { storyboardSchemaDocument } from './schema-doc.js';

export { APP_VERSION } from './version.js';
import { APP_VERSION } from './version.js';
const SESSION_COOKIE = 'planb_session';
const CSRF_HEADER = 'x-planb-csrf';

export interface Services {
  db: DB;
  auth: Auth;
  episodes: Episodes;
  assets: AssetStore;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export function createServices(config: Config): Services {
  const db = openDatabase(config.dataDir);
  const assets = new AssetStore(db, config.dataDir);
  return { db, auth: new Auth(db, config.sessionDays), episodes: new Episodes(db, assets), assets };
}

export async function buildApp(config: Config, services = createServices(config)): Promise<FastifyInstance> {
  const { auth, episodes, assets } = services;
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.PLANB_LOG_LEVEL ?? 'info' },
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024 * 1024, // agent uploads arrive base64-encoded over MCP
  });
  app.decorate('services', services);
  app.addHook('onClose', async () => services.db.close());

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: LIMITS.imageBytes, files: 1, fields: 5 } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, ...err.details });
    if (err.name === 'ZodError') return reply.status(400).send({ error: 'Invalid input.' });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: `Images can be at most ${LIMITS.imageBytes / 1024 / 1024} MiB.` });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong on the server. Your change was not saved.' });
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });

  // --- Authentication ---------------------------------------------------------

  const sessionCookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.secureCookies,
  };

  /** Resolves the caller from an agent bearer token or a browser session cookie. */
  function authenticate(req: FastifyRequest, opts: { allowAgent: boolean }): Principal {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      if (!opts.allowAgent) throw new HttpError(403, 'Agent tokens cannot manage account settings.');
      const p = auth.agentPrincipal(header.slice(7).trim());
      if (!p) throw new HttpError(401, 'Invalid or revoked agent token.');
      return p;
    }
    const user = auth.sessionUser(req.cookies[SESSION_COOKIE]);
    if (!user) throw new HttpError(401, 'Please sign in.');
    // Cookie-authenticated writes must carry a custom header, which cross-site forms cannot send.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, 'Missing request header.');
    }
    return { user, kind: 'user', label: user.name || user.email };
  }
  const requireAny = async (req: FastifyRequest) => {
    req.principal = authenticate(req, { allowAgent: true });
  };
  const requireUser = async (req: FastifyRequest) => {
    req.principal = authenticate(req, { allowAgent: false });
  };
  const p = (req: FastifyRequest) => req.principal!;

  const throttle = new LoginThrottle(config.loginRateLimit.max, config.loginRateLimit.windowMs);

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: config.loginRateLimit.max * 2, timeWindow: config.loginRateLimit.windowMs } } },
    async (req, reply) => {
      const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
      if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        throw badRequest('Enter your e-mail and password.');
      }
      if (throttle.blocked(email)) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
      const user = await auth.checkCredentials(email, password);
      if (!user) {
        throttle.fail(email);
        throw new HttpError(401, 'E-mail or password is incorrect.');
      }
      throttle.succeed(email);
      const { token, expires } = auth.createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, { ...sessionCookieOptions, expires });
      return { user };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) auth.destroySession(token);
    reply.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (req) => ({ user: p(req).user }));

  app.post('/api/auth/password', { preHandler: requireUser }, async (req, reply) => {
    const { currentPassword, newPassword } = (req.body ?? {}) as Record<string, string>;
    if (!(await auth.checkCredentials(p(req).user.email, currentPassword ?? ''))) throw new HttpError(400, 'Current password is incorrect.');
    await auth.setPassword(p(req).user.id, newPassword ?? '');
    const { token, expires } = auth.createSession(p(req).user.id);
    reply.setCookie(SESSION_COOKIE, token, { ...sessionCookieOptions, expires });
    return { ok: true };
  });

  // --- Agent tokens (browser session only) -------------------------------------

  app.get('/api/tokens', { preHandler: requireUser }, async (req) => ({
    tokens: auth.listAgentTokens(p(req).user.id),
    mcpUrl: `${config.publicUrl}/mcp`,
    apiUrl: `${config.publicUrl}/api`,
  }));
  app.post('/api/tokens', { preHandler: requireUser }, async (req) => {
    const { label } = (req.body ?? {}) as { label?: string };
    return auth.createAgentToken(p(req).user.id, label ?? 'Agent');
  });
  app.delete('/api/tokens/:id', { preHandler: requireUser }, async (req) => {
    if (!auth.revokeAgentToken(p(req).user.id, (req.params as { id: string }).id)) throw notFound('Token not found');
    return { ok: true };
  });

  // --- Episodes -------------------------------------------------------------------

  type IdParams = { id: string };

  app.get('/api/episodes', { preHandler: requireAny }, async (req) => ({ episodes: episodes.list(p(req)) }));

  app.post('/api/episodes', { preHandler: requireAny }, async (req, reply) => {
    const body = (req.body ?? {}) as { title?: string; brief?: string; withExample?: boolean };
    const ep = await episodes.create(p(req), { title: body.title ?? '', brief: body.brief, withExample: body.withExample === true });
    return reply.status(201).send({ episode: ep });
  });

  app.get('/api/episodes/:id', { preHandler: requireAny }, async (req) => ({
    episode: episodes.get(p(req), (req.params as IdParams).id),
  }));

  app.delete('/api/episodes/:id', { preHandler: requireUser }, async (req) => {
    episodes.softDelete(p(req), (req.params as IdParams).id);
    return { ok: true };
  });

  app.post('/api/episodes/:id/changes', { preHandler: requireAny }, async (req) => {
    return episodes.applyChanges(p(req), (req.params as IdParams).id, req.body);
  });

  app.get('/api/episodes/:id/revisions', { preHandler: requireAny }, async (req) => ({
    revisions: episodes.revisions(p(req), (req.params as IdParams).id),
  }));

  app.get('/api/episodes/:id/revisions/:rev', { preHandler: requireAny }, async (req) => {
    const { id, rev } = req.params as { id: string; rev: string };
    return { revision: episodes.revisionSnapshot(p(req), id, Number(rev)) };
  });

  app.post('/api/episodes/:id/restore', { preHandler: requireAny }, async (req) => ({
    episode: episodes.restore(p(req), (req.params as IdParams).id, (req.body ?? {}) as Record<string, unknown>),
  }));

  app.get('/api/episodes/:id/agent-view', { preHandler: requireAny }, async (req) =>
    agentEpisodeView(episodes.get(p(req), (req.params as IdParams).id)),
  );

  app.get('/api/episodes/:id/checklist', { preHandler: requireAny }, async (req, reply) => {
    const ep = episodes.get(p(req), (req.params as IdParams).id);
    const q = req.query as { format?: string; groupByLocation?: string };
    const group = q.groupByLocation === 'true' || q.groupByLocation === '1';
    if (q.format === 'markdown') return reply.type('text/markdown; charset=utf-8').send(checklistMarkdown(ep, group));
    return { revision: ep.revision, groups: buildChecklist(ep, group) };
  });

  app.get('/api/episodes/:id/export.zip', { preHandler: requireAny }, async (req, reply) => {
    const ep = episodes.get(p(req), (req.params as IdParams).id);
    const { filename, zip } = buildExport(ep, assets, APP_VERSION);
    return reply
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'no-store')
      .send(Buffer.from(zip));
  });

  // Live updates: tells open browsers a newer revision exists so they can fetch it.
  app.get('/api/episodes/:id/events', { preHandler: requireAny }, async (req, reply) => {
    const id = (req.params as IdParams).id;
    const ep = episodes.get(p(req), id);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (revision: number) => res.write(`event: revision\ndata: ${JSON.stringify({ revision })}\n\n`);
    send(ep.revision);
    const onRevision = (revision: number) => send(revision);
    episodes.events.on(id, onRevision);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      episodes.events.off(id, onRevision);
    });
  });

  // --- Assets -------------------------------------------------------------------------

  app.post('/api/episodes/:id/assets', { preHandler: requireAny }, async (req, reply) => {
    const id = (req.params as IdParams).id;
    episodes.ownsEpisode(p(req), id);
    const file = await req.file();
    if (!file) throw badRequest('Choose an image to upload.');
    const data = await file.toBuffer();
    const row = await assets.saveUpload(p(req).user.id, id, data, file.filename);
    return reply.status(201).send({ asset: { id: row.id, mime: row.mime, bytes: row.bytes, width: row.width, height: row.height } });
  });

  app.get('/api/assets/:id', { preHandler: requireAny }, async (req, reply) => {
    const row = episodes.asset(p(req), (req.params as IdParams).id);
    if (!row) throw notFound('Image not found');
    const w = Number((req.query as { w?: string }).w);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (w) {
      const width = [160, 320, 480, 960].find((x) => x >= w) ?? 960;
      return reply.type('image/webp').send(fs.createReadStream(await assets.thumbnail(row, width)));
    }
    return reply.type(row.mime).send(fs.createReadStream(assets.filePath(row)));
  });

  app.get('/api/storyboard-schema', async () => storyboardSchemaDocument());
  app.get('/api/health', async () => ({ ok: true, version: APP_VERSION }));

  // --- MCP (Streamable HTTP, stateless, bearer token) -------------------------------

  app.post('/mcp', async (req, reply) => {
    let principal: Principal;
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Agent token required (Authorization: Bearer planb_...)');
      principal = authenticate(req, { allowAgent: true });
    } catch (e) {
      const err = e as HttpError;
      return reply
        .status(err.status ?? 401)
        .header('WWW-Authenticate', 'Bearer')
        .send({ jsonrpc: '2.0', error: { code: -32001, message: err.message }, id: null });
    }
    const server = createMcpServer(services, principal, APP_VERSION);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  const mcpMethodNotAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.status(405).header('Allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get('/mcp', mcpMethodNotAllowed);
  app.delete('/mcp', mcpMethodNotAllowed);

  // --- Web client ---------------------------------------------------------------------

  if (config.staticDir && fs.existsSync(config.staticDir)) {
    await app.register(fastifyStatic, { root: config.staticDir, index: false, wildcard: true });
    // Link-preview tags need absolute URLs, so the page carries this install's public address.
    const indexHtml = fs
      .readFileSync(path.join(config.staticDir, 'index.html'), 'utf8')
      .replaceAll('__PLANB_PUBLIC_URL__', config.publicUrl);
    const sendIndex = (_req: FastifyRequest, reply: FastifyReply) =>
      reply.type('text/html').header('Cache-Control', 'no-cache').send(indexHtml);
    app.get('/', sendIndex);
    app.get('/index.html', sendIndex);
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/mcp')) return reply.status(404).send({ error: 'Not found' });
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(indexHtml);
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Not found' }));
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}
