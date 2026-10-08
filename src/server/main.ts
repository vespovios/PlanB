import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);
const prune = setInterval(() => app.services.auth.pruneSessions(), 6 * 60 * 60 * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    clearInterval(prune);
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
app.log.info(`PlanB listening on ${config.host}:${config.port}; data in ${config.dataDir}`);
