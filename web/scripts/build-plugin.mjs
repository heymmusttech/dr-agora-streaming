/**
 * Builds the embeddable plugin: src/plugin/dpr-live.ts (+ its CSS, inlined) →
 * public/plugin/dpr-live.js (one minified IIFE, no dependencies) and public/plugin/dpr-live.css.
 * `npm run build:plugin` (also part of `dev` and `build`); `--watch` rebuilds on change.
 */
import { build, context } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outdir = join(root, 'public', 'plugin')
mkdirSync(outdir, { recursive: true })

const options = {
  entryPoints: [join(root, 'src/plugin/dpr-live.ts')],
  outfile: join(outdir, 'dpr-live.js'),
  bundle: true,
  format: 'iife',
  target: ['es2019', 'safari13'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  loader: { '.css': 'text' },
  banner: { js: '/*! dpr-live.js — duPont REGISTRY Live plugin · docs/PLUGIN-API.md */' },
}

copyFileSync(join(root, 'src/plugin/dpr-live.css'), join(outdir, 'dpr-live.css'))

if (process.argv.includes('--watch')) {
  const ctx = await context(options)
  await ctx.watch()
  console.log('[plugin] watching src/plugin …')
} else {
  const result = await build({ ...options, metafile: true })
  const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0
  console.log(`[plugin] public/plugin/dpr-live.js ${(bytes / 1024).toFixed(1)} kB`)
}
