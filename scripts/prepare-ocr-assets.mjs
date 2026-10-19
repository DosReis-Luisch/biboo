import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile, rm, copyFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Explicit allowlist: no network, glob copying, timestamps, or generated Git assets.
const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const packageRoot = (name) => dirname(require.resolve(`${name}/package.json`))
const engine = packageRoot('tesseract.js')
// Resolve the actual core dependency used by the installed Tesseract package.
const core = dirname(createRequire(join(engine, 'package.json')).resolve('tesseract.js-core/package.json'))
const sources = [
  ['worker', join(engine, 'dist/worker.min.js'), 'worker.min.js'],
  ['core', join(core, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  ['wasm', join(core, 'tesseract-core-lstm.wasm'), 'tesseract-core-lstm.wasm'],
  ...['nld', 'por'].map((language) => [language, join(packageRoot(`@tesseract.js-data/${language}`), `4.0.0_best_int/${language}.traineddata.gz`), `${language}.traineddata.gz`]),
]
// Read every required input before replacing the owned output directory.
const files = await Promise.all(sources.map(async ([key, source, filename]) => {
  const bytes = await readFile(source)
  return { key, filename, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}))
const digest = createHash('sha256').update(files.map((file) => `${file.filename}:${file.sha256}`).join('\n')).digest('hex').slice(0, 16)
const outputRoot = resolve(root, 'public/ocr-assets')
// Only this literal, ignored, generated directory is replaced.
await rm(outputRoot, { recursive: true, force: true })
const output = join(outputRoot, digest)
await mkdir(output, { recursive: true })
const entries = {}
for (const file of files) {
  await writeFile(join(output, file.filename), file.bytes)
  entries[file.key] = { path: `/ocr-assets/${digest}/${file.filename}`, bytes: file.bytes.length, sha256: file.sha256 }
}
await copyFile(join(engine, 'dist/worker.min.js.LICENSE.txt'), join(output, 'worker.LICENSE.txt'))
await copyFile(join(core, 'LICENSE'), join(output, 'core.LICENSE.txt'))
for (const language of ['nld', 'por']) {
  await copyFile(join(packageRoot(`@tesseract.js-data/${language}`), 'README.md'), join(output, `${language}.README.md`))
}
await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify({ version: 1, worker: entries.worker, core: entries.core, wasm: entries.wasm, languages: { nld: entries.nld, por: entries.por } }, null, 2)}\n`)
