import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('package.json is a complete DSH bundle manifest', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.name, '@local/dsh-redmark')
  assert.equal(pkg.version, '4.0.9')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.private, true)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  for (const f of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg']) {
    assert.ok(pkg.files.includes(f), `package.json files[] missing ${f}`)
  }
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.exports['./icon'], './icon.svg')
})

test('cordis.patch.yml inserts the bundle', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /insert:/)
  assert.match(patch, /@local\/dsh-redmark/)
  assert.match(patch, /id:\s*dsh-redmark/)
})

test('locale files carry title and description', () => {
  for (const lang of ['en', 'zh']) {
    const meta = JSON.parse(read(`locale/${lang}.json`)).meta
    assert.ok(meta.title && meta.title.length > 0)
    assert.ok(meta.description && meta.description.length > 0)
  }
})

test('host half declares its webServer inject and route constants', () => {
  const src = read('index.js')
  assert.match(src, /export const inject = \['webServer'\]/)
  assert.match(src, /export function apply\(ctx\)/)
  assert.match(src, /\/dsh-redmark/)
  assert.match(src, /TRACE_MAX_BYTES = 1024 \* 1024/)
  assert.match(src, /MAX_LIST = 500/)
  assert.match(src, /MAX_NOTE = 2000/)
  assert.match(src, /MAX_DB_BYTES = 16 \* 1024 \* 1024/)
})

test('client half registers the panel, slots and jump-back machinery', () => {
  const src = read('client.js')
  assert.match(src, /window\.__ModuleLoader__\.load/)
  assert.match(src, /PANEL_ID = 'dsh-redmark'/)
  assert.match(src, /sidebar\.panellist/)
  assert.match(src, /conversation\.chat\.assistant-actions/)
  assert.match(src, /TURN_ROW_SELECTOR = '\[data-chat-turn\]'/)
  assert.match(src, /function startFollowGuard/)
  assert.match(src, /function jumpViaRail/)
  assert.match(src, /function railHandle/)
  assert.match(src, /anchorStore/)
})

test('client half guards session-scoped jumps and passage centring', () => {
  const src = read('client.js')
  // The sessions service must be injected for openState to be readable.
  assert.match(src, /const inject = \[[^\]]*'sessions'\]/)
  assert.match(src, /function sessionSnapshot\(sessionId\)/)
  assert.match(src, /openState === 'loading'/)
  assert.match(src, /openState === 'error'/)
  assert.match(src, /SESSION_CONTENT_SELECTOR = '\[data-conversation-session\]'/)
  assert.match(src, /querySelector\('\[data-conversation-session="' \+ escaped \+ '"\]'\)/)
  assert.match(src, /function sessionRoot\(sessionId\)/)
  assert.match(src, /async function centrePassage\(bm, sessionId, budgetMs\)/)
  assert.match(src, /async function revealQuotedNode\(bm, sessionId\)/)
  assert.match(src, /function nodeStepOf/)
  assert.match(src, /still-loading/)
  assert.match(src, /jump\.quotePending/)
})

test('legacy localStorage keys and mirror files are adopted, not dropped', () => {
  const client = read('client.js')
  assert.match(client, /LEGACY_STORE_PREFIX = 'dsh\.session-bookmarks\.'/)
  assert.match(client, /LEGACY_ENDPOINT = '\/session-bookmarks'/)
  assert.match(client, /store: migrated legacy key/)
  const host = read('index.js')
  assert.match(host, /LEGACY_FILE = join\(HOME, 'session-bookmarks\.json'\)/)
  assert.match(host, /readFile\(LEGACY_FILE/)
})

test('no real secrets are checked in', () => {
  const env = read('.env.example')
  assert.match(env, /DSH_HOME=/)
  // The example must not contain a real key of any kind.
  assert.doesNotMatch(env, /sk-[A-Za-z0-9]{16,}/)
  assert.doesNotMatch(env, /OPENAI_ADMIN_KEY\s*=\s*[A-Za-z0-9]/)
})
