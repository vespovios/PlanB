// Starts a throwaway PlanB server for browser tests: fresh data dir, two accounts, built client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planb-e2e-'));
const port = Number(process.env.E2E_PORT ?? 8799);
const config = loadConfig({
  dataDir,
  port,
  host: '127.0.0.1',
  staticDir: path.resolve('dist/client'),
  secureCookies: false,
  publicUrl: `http://127.0.0.1:${port}`,
});
const app = await buildApp(config);
await app.services.auth.createUser('creator@example.com', 'Creator', 'creator-password-1');
await app.services.auth.createUser('someone@example.com', 'Someone', 'someone-password-1');
const token = app.services.auth.createAgentToken(app.services.auth.findUserByEmail('creator@example.com')!.id, 'E2E agent');
fs.writeFileSync(path.join(os.tmpdir(), 'planb-e2e-token'), token.token);
await app.listen({ host: config.host, port });
console.log(`e2e server on ${port}, data ${dataDir}`);
