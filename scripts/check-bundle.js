#!/usr/bin/env node
/*
 * check-bundle.js — validate this bundle's structure and manifest.
 *
 * Run:  node scripts/check-bundle.js
 * (no npm dependencies required; use any Node.js >= 18)
 *
 * Checks that every file referenced by the manifest exists and that both
 * JavaScript entry points parse. This catches the most common cause of a
 * "plugin installed but nothing shows up" report: an incomplete `files` list.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')

let pkg
try {
  pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
} catch (e) {
  console.error(`FAIL: cannot read package.json: ${e.message}`)
  process.exit(1)
}

const problems = []
const expect = (cond, msg) => { if (!cond) problems.push(msg) }

expect(pkg.name === '@local/dsh-redmark', `unexpected package name: ${pkg.name}`)
expect(pkg.type === 'module', 'package.json must declare "type": "module"')
expect(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch, 'missing dsh.bundle.patch')
expect(pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web', 'missing dsh.client.platform=web')

// Every file the bundle needs at runtime must be listed in package.json files[].
const runtimeFiles = [
  'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg',
]
for (const ref of runtimeFiles) {
  if (!existsSync(join(root, ref))) problems.push(`missing file: ${ref}`)
  if (Array.isArray(pkg.files) && !pkg.files.includes(ref)) {
    problems.push(`package.json files[] does not include ${ref}`)
  }
}
// Locale JSON files are exported via the wildcard pattern.
for (const ref of ['locale/en.json', 'locale/zh.json']) {
  if (!existsSync(join(root, ref))) problems.push(`missing file: ${ref}`)
  if (Array.isArray(pkg.files) && !pkg.files.includes('locale/*.json')) {
    problems.push(`package.json files[] does not include locale/*.json (needed for ${ref})`)
  }
}
// Repo-level docs are expected in the source tree but need not ship in files[].
for (const ref of ['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE']) {
  if (!existsSync(join(root, ref))) problems.push(`missing doc: ${ref}`)
}
for (const ref of ['docs/architecture.md', 'docs/usage.md', '.github/workflows/ci.yml']) {
  if (!existsSync(join(root, ref))) problems.push(`missing repo asset: ${ref}`)
}

for (const js of ['index.js', 'client.js']) {
  try {
    execFileSync(process.execPath, ['--check', join(root, js)], { stdio: 'ignore' })
  } catch {
    problems.push(`syntax error in ${js}`)
  }
}

if (problems.length) {
  console.error('Bundle check FAILED:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`Bundle check OK: ${pkg.name}@${pkg.version}`)
