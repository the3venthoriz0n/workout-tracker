// Bundles the API (and its dependencies) into dist/ so the runtime image needs no node_modules.
import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  // Some CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
})
