// Bundles the server (TypeScript) into dist/server; npm packages stay external.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/main.ts', 'src/server/cli.ts'],
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
