/**
 * Tests for the docs-bridge payload builder.
 *
 * ⚠️ RUN BY `node --test`, NOT by vitest, and that is deliberate. This repo's
 * vitest.config.ts globs `at-*` + '/vitest.config.ts' only, so a test file under
 * scripts/ would sit in the tree and NEVER RUN — which is exactly the failure
 * the payload exists to prevent, one level up: an artefact that looks present
 * and checks nothing. The alternative, adding a `scripts` vitest project, moves
 * this repo's documented 91-passed/4-skipped baseline, which the wrapper records
 * as an invariant. So: `pnpm check:docs-bridge`, wired into CI next to the other
 * check: gates.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractSection } from './changelog.mjs'
import { buildPayload, assertValid, isFirstPublishFromError, REPO } from './build-payload.mjs'

const never = () => false
const always = () => true

function fixture(pkgs, { rootChangelog = null, pkgChangelogs = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'at-bridge-'))
  for (const [name, pj] of Object.entries(pkgs)) {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, 'package.json'), JSON.stringify(pj))
    if (pkgChangelogs[name]) writeFileSync(join(dir, name, 'CHANGELOG.md'), pkgChangelogs[name])
  }
  if (rootChangelog !== null) writeFileSync(join(dir, 'CHANGELOG.md'), rootChangelog)
  return dir
}
const P = (name, version = '1.0.0', extra = {}) => ({ name: `@noy-db/${name}`, version, ...extra })
const build = (dir, isFirstPublish = never) =>
  buildPayload({ rootDir: dir, tag: 'v1.0.0', channel: 'next', runUrl: 'u', isFirstPublish })

// ── extractSection ──────────────────────────────────────────────────────────

test('extractSection reads a bare heading, this repo house style', () => {
  assert.equal(extractSection('## 1.0.0\n\nbody text\n', '1.0.0'), 'body text')
})

test('extractSection reads a Keep a Changelog heading', () => {
  assert.equal(extractSection('## [1.0.0] — 2026-09-05\n\nbody\n', '1.0.0'), 'body')
})

test('extractSection stops at the next section', () => {
  assert.equal(extractSection('## 1.0.0\nkeep\n## 0.9.0\ndrop\n', '1.0.0'), 'keep')
})

test('extractSection matches the version EXACTLY — a stable must not match its prerelease', () => {
  // The bug this guards: `0.7.1` matching `## 0.7.1-pre.0` would attribute a
  // prerelease's prose to the stable that follows it.
  assert.equal(extractSection('## 1.0.0-pre.0\nprerelease body\n', '1.0.0'), null)
  assert.equal(extractSection('## 1.0.0\nstable body\n', '1.0.0-pre.0'), null)
})

test('extractSection returns null for a missing or empty section', () => {
  assert.equal(extractSection('## 2.0.0\nbody\n', '1.0.0'), null)
  assert.equal(extractSection('## 1.0.0\n\n\n## 0.9.0\nx\n', '1.0.0'), null)
})

// ── package set ─────────────────────────────────────────────────────────────

test('package set comes from top-level at-* dirs, sorted, and ignores others', () => {
  const dir = fixture({ 'at-env': P('at-env'), 'at-aws-kms': P('at-aws-kms'), scripts: P('nope') })
  const p = build(dir)
  assert.deepEqual(p.packages.map((x) => x.dir), ['at-aws-kms', 'at-env'])
  rmSync(dir, { recursive: true, force: true })
})

test('refuses to emit an empty payload when no at-* dirs exist', () => {
  // An empty `packages` array is schema-valid on the consumer side and would
  // silently describe a release with no packages (spec §3.1).
  const dir = fixture({ 'packages': P('wrong-layout') })
  // Asserts the DIRECTORY-specific message, not the shared "refusing to emit an
  // empty payload" phrase: the all-private guard ends with the same words, so a
  // loose match passed even with this guard deleted (caught by mutation, 23/23).
  assert.throws(() => build(dir), /no at-\* package directories found/)
  rmSync(dir, { recursive: true, force: true })
})

test('refuses when every at-* package is private', () => {
  const dir = fixture({ 'at-secret': P('at-secret', '1.0.0', { private: true }) })
  assert.throws(() => build(dir), /every at-\* package is private/)
  rmSync(dir, { recursive: true, force: true })
})

test('lockstep is asserted, not assumed', () => {
  const dir = fixture({ 'at-env': P('at-env', '1.0.0'), 'at-aws-kms': P('at-aws-kms', '1.0.1') })
  assert.throws(() => build(dir), /not in lockstep/)
  rmSync(dir, { recursive: true, force: true })
})

// ── changeType, the ordered rule ────────────────────────────────────────────

test('changeType is version-only when npm knows the name and no package changelog exists', () => {
  const dir = fixture({ 'at-env': P('at-env') })
  assert.equal(build(dir).packages[0].changeType, 'version-only')
  rmSync(dir, { recursive: true, force: true })
})

test('changeType is added on a first publish, outranking a package changelog', () => {
  const dir = fixture({ 'at-env': P('at-env') }, { pkgChangelogs: { 'at-env': '## 1.0.0\nbody\n' } })
  assert.equal(build(dir, always).packages[0].changeType, 'added')
  rmSync(dir, { recursive: true, force: true })
})

test('changeType is updated when the PACKAGE has its own changelog section', () => {
  // Unreachable in this repo today — zero per-package CHANGELOG.md — but the
  // rule is implemented rather than hardcoded so adding one starts working.
  const dir = fixture({ 'at-env': P('at-env') }, { pkgChangelogs: { 'at-env': '## 1.0.0\nper-package\n' } })
  const p = build(dir).packages[0]
  assert.equal(p.changeType, 'updated')
  assert.equal(p.changelog, 'per-package')
  rmSync(dir, { recursive: true, force: true })
})

// ── the top-level changelog ─────────────────────────────────────────────────

test('top-level changelog is the ROOT section, and is NOT copied into entries', () => {
  const dir = fixture({ 'at-env': P('at-env') }, { rootChangelog: '## 1.0.0\nrelease prose\n' })
  const p = build(dir)
  assert.equal(p.changelog, 'release prose')
  assert.equal(p.packages[0].changelog, null, 'release-scoped prose must not be attributed to a package')
  rmSync(dir, { recursive: true, force: true })
})

test('top-level changelog is null when the root section is missing', () => {
  const dir = fixture({ 'at-env': P('at-env') }, { rootChangelog: '## Unreleased\nnot a version\n' })
  assert.equal(build(dir).changelog, null)
  rmSync(dir, { recursive: true, force: true })
})

// ── shape ───────────────────────────────────────────────────────────────────

test('emits no store fields — there is no divergence gate for this family', () => {
  const dir = fixture({ 'at-env': P('at-env') })
  const p = build(dir)
  for (const k of ['shape', 'capabilities', 'txAtomic', 'conditionalBits', 'optionDependent', 'factory']) {
    assert.equal(k in p, false, `top-level ${k} must not be emitted`)
    assert.equal(k in p.packages[0], false, `packages[].${k} must not be emitted`)
  }
  rmSync(dir, { recursive: true, force: true })
})

test('emits the human-facing fields nothing reads', () => {
  const dir = fixture({ 'at-env': P('at-env', '1.0.0', { description: 'd', peerDependencies: { '@noy-db/hub': '^0.7.0' } }) })
  const p = build(dir)
  assert.equal(p.channel, 'next')
  assert.equal(p.runUrl, 'u')
  assert.equal(p.packages[0].description, 'd')
  assert.equal(p.packages[0].hubPeerRange, '^0.7.0')
  assert.equal(p.packages[0].version, '1.0.0')
  rmSync(dir, { recursive: true, force: true })
})

// ── assertValid, the pre-upload gate ────────────────────────────────────────

const valid = () => ({
  bridge: 1, repo: REPO, version: '1.0.0', tag: 'v1.0.0',
  packages: [{ name: '@noy-db/at-env', dir: 'at-env', changeType: 'version-only', changelog: null }],
})

test('assertValid accepts a well-formed payload', () => {
  assert.equal(assertValid(valid()).bridge, 1)
})

test('assertValid rejects a tag that disagrees with the version', () => {
  // A payload whose tag disagrees makes the manifest record something the git
  // tag does not say (spec §3.1).
  assert.throws(() => assertValid({ ...valid(), tag: 'v1.0.1' }), /!== "v" \+ version/)
})

test('assertValid rejects a wrong repo slug', () => {
  assert.throws(() => assertValid({ ...valid(), repo: 'vLannaAi/noy-db-as' }), /must be "vLannaAi\/noy-db-at"/)
})

test('assertValid rejects a bridge that is not the number 1', () => {
  assert.throws(() => assertValid({ ...valid(), bridge: '1' }), /must be the number 1/)
})

test('assertValid rejects an empty packages array', () => {
  assert.throws(() => assertValid({ ...valid(), packages: [] }), /packages is empty/)
})

test('assertValid rejects a fourth changeType, which would stop every partition', () => {
  const p = valid()
  p.packages[0].changeType = 'changed'
  assert.throws(() => assertValid(p), /is not added\|updated\|version-only/)
})

// ── first-publish detection ─────────────────────────────────────────────────

test('only E404 means first publish — a network failure must not be guessed', () => {
  assert.equal(isFirstPublishFromError({ stderr: 'npm error code E404' }), true)
  assert.equal(isFirstPublishFromError({ stderr: 'ETIMEDOUT' }), false)
  assert.equal(isFirstPublishFromError({}), false)
})
