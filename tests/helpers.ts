import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadConfig, type Config } from '../src/server/config.js';

process.env.NODE_ENV = 'test';

export interface TestCtx {
  app: FastifyInstance;
  dataDir: string;
  config: Config;
  cookieA: string;
  cookieB: string;
  tokenA: string;
  tokenB: string;
}

export const PASSWORD = 'correct horse battery';

export async function startApp(dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planb-test-'))) {
  const config = loadConfig({ dataDir, staticDir: null, secureCookies: false, publicUrl: 'http://localhost:0' });
  const app = await buildApp(config);
  return { app, config, dataDir };
}

export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed ${res.statusCode} ${res.body}`);
  const c = res.cookies.find((c) => c.name === 'planb_session')!;
  return `planb_session=${c.value}`;
}

export async function setup(): Promise<TestCtx> {
  const { app, config, dataDir } = await startApp();
  const { auth } = app.services;
  const a = await auth.createUser('alice@example.com', 'Alice', PASSWORD);
  const b = await auth.createUser('bob@example.com', 'Bob', PASSWORD);
  return {
    app,
    config,
    dataDir,
    cookieA: await login(app, 'alice@example.com'),
    cookieB: await login(app, 'bob@example.com'),
    tokenA: auth.createAgentToken(a.id, 'Claude').token,
    tokenB: auth.createAgentToken(b.id, 'Other').token,
  };
}

/** Browser-style request (session cookie + CSRF header). */
export function asUser(cookie: string) {
  return { cookie, 'x-planb-csrf': '1' };
}
export function asAgent(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** A small valid PNG generated with sharp. */
export async function samplePng(width = 640, height = 360, colour = '#88aadd'): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();
}

export function multipartBody(filename: string, data: Buffer, mime = 'image/png') {
  const boundary = '----planbtest' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}
