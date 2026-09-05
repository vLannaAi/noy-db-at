/**
 * Assemble docs-bridge.json for the five @noy-db/at-* sealing-key providers.
 *
 * Contract: noy-db-docs/docs/superpowers/specs/2026-09-05-as-on-at-doc-sync-sources-design.md
 * (ruled lanna-db#17). Schema is `bridge: 1`, unchanged, so noy-db-docs'
 * scripts/sync/bridge.mjs parses this repo's payload with no consumer edit.
 *
 * PARITY TARGET IS noy-db-ui's builder, NOT noy-db-to's — spec §3, and the
 * reason matters: to-* entries carry store capability fields this family has no
 * analogue for, and noy-db-to derives its package set from a hard-coded WIRING
 * table. Two consecutive noy-db-to releases shipped a broken payload because a
 * new store was missing from that table, and both runs reported success. There
 * is no table here: a sixth provider is picked up with no edit to this file.
 *
 * Divergences from noy-db-ui, each forced by this repo or by the spec:
 *
 *   - PACKAGE SET FROM TOP-LEVEL `at-*` DIRECTORIES. noy-db-ui reads
 *     `packages/`; this repo is flat (spec §3.5.2). Reading `packages/` here
 *     would find nothing and throw — loudly, which is the good case — but the
 *     prefix filter is what actually makes it correct.
 *
 *   - TOP-LEVEL `changelog`, from the ROOT CHANGELOG's `## <version>` section
 *     (spec §3.1, added 2026-09-05). It is additive under `bridge: 1`; the
 *     consumer's parseBridge checks only `bridge === 1`, that `packages` is an
 *     array, and the repo match, so this ships before the consumer reads it.
 *     For this repo it is the release's ONLY prose: every package is
 *     `version-only` and `packages[].changelog` is null throughout.
 *
 *   - NO `hasRealDelta`. noy-db-ui exports one, and porting it would be a bug
 *     here: it answers "did anything change?" from changeType and per-package
 *     changelogs ONLY, both of which predate the top-level field. In this repo
 *     every package is `version-only` with a null changelog even on a
 *     substantial release, so it would return false for a real cut and suppress
 *     the very notification it exists to trigger. Whatever consumes "is this
 *     worth reporting" must consult the top-level `changelog`.
 *
 * changeType rule, evaluated in order (spec §3.5.1, identical in all three
 * existing producers): `added` when the registry has no prior version of that
 * name; else `updated` when the PACKAGE's own CHANGELOG.md has a section for
 * this version; else `version-only`. npm already carries every at-* name, so
 * `added` is unreachable here, and no package has its own changelog, so
 * `updated` is unreachable too. Every entry is `version-only`, and that is
 * correct rather than a defect — the handover prose is what the top-level
 * `changelog` carries.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { extractSection } from './changelog.mjs'

export const REPO = 'vLannaAi/noy-db-at'
const PREFIX = 'at-'

export function buildPayload({ rootDir, tag, channel, runUrl, isFirstPublish }) {
  const dirs = readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(PREFIX))
    .filter((d) => existsSync(join(rootDir, d.name, 'package.json')))
    .map((d) => d.name)
    .sort()

  // An empty `packages` array is SCHEMA-VALID on the consumer side and silently
  // describes a release with no packages (spec §3.1). Refuse to emit one. This
  // runs in a job whose only diagnosis is the run summary, so the error names
  // what it looked for rather than leaving an ENOENT to be interpreted.
  if (dirs.length === 0) {
    throw new Error(
      `no ${PREFIX}* package directories found at ${rootDir} — refusing to emit an empty payload. ` +
      'This repo is FLAT: packages are top-level dirs, not under packages/.',
    )
  }

  const packages = dirs
    .map((dir) => JSON.parse(readFileSync(join(rootDir, dir, 'package.json'), 'utf8')))
    // The root manifest is `private: true` and is not among the at-* dirs, but a
    // private package under the prefix must not be advertised as published.
    .filter((pkg) => !pkg.private)
    .map((pkg) => {
      const dir = dirs.find((d) => JSON.parse(readFileSync(join(rootDir, d, 'package.json'), 'utf8')).name === pkg.name)
      const clPath = join(rootDir, dir, 'CHANGELOG.md')
      const changelog = existsSync(clPath) ? extractSection(readFileSync(clPath, 'utf8'), pkg.version) : null
      const changeType = isFirstPublish(pkg.name) ? 'added' : changelog !== null ? 'updated' : 'version-only'

      return {
        name: pkg.name,
        dir,
        version: pkg.version,
        description: pkg.description ?? null,
        hubPeerRange: pkg.peerDependencies?.['@noy-db/hub'] ?? null,
        changeType,
        changelog,
      }
    })

  if (packages.length === 0) {
    throw new Error(`every ${PREFIX}* package is private — refusing to emit an empty payload`)
  }

  // Lockstep is ASSERTED, not assumed (spec §3.5.3). The payload carries ONE
  // version, so a split line would make it a lie about the other four.
  // check:versions-uniform enforces this too, but that runs in CI and this runs
  // on the release path — the two see different trees.
  const versions = [...new Set(packages.map((p) => p.version))]
  if (versions.length > 1) {
    const detail = packages.map((p) => `${p.name}@${p.version}`).join(', ')
    throw new Error(
      `packages are not in lockstep (${detail}) — the payload carries one version, so this would ` +
      'misdescribe the others. Run `pnpm version:set <version>` before releasing.',
    )
  }

  const rootChangelogPath = join(rootDir, 'CHANGELOG.md')
  const changelog = existsSync(rootChangelogPath)
    ? extractSection(readFileSync(rootChangelogPath, 'utf8'), versions[0])
    : null

  return {
    bridge: 1,
    repo: REPO,
    version: versions[0],
    tag,
    channel,
    runUrl,
    changelog,
    packages,
  }
}

/**
 * The pre-upload validation of spec §3.5.4, as a function so the test can reach
 * it. `tag` is checked against `version` because a payload whose tag disagrees
 * makes the manifest record something the git tag does not say (§3.1).
 */
export function assertValid(payload) {
  const problems = []
  if (payload.bridge !== 1) problems.push(`bridge is ${JSON.stringify(payload.bridge)}, must be the number 1`)
  if (payload.repo !== REPO) problems.push(`repo is ${JSON.stringify(payload.repo)}, must be ${JSON.stringify(REPO)}`)
  if (!Array.isArray(payload.packages) || payload.packages.length === 0) problems.push('packages is empty or not an array')
  if (payload.tag !== `v${payload.version}`) problems.push(`tag ${JSON.stringify(payload.tag)} !== "v" + version ${JSON.stringify(payload.version)}`)
  for (const p of payload.packages ?? []) {
    if (!['added', 'updated', 'version-only'].includes(p.changeType)) {
      // A fourth value throws in the consumer's classifyBridge and stops the
      // whole run — every partition, not just this one (spec §3.1, §5.2).
      problems.push(`${p.name}: changeType ${JSON.stringify(p.changeType)} is not added|updated|version-only`)
    }
  }
  if (problems.length) throw new Error(`docs-bridge payload is invalid:\n  - ${problems.join('\n  - ')}`)
  return payload
}

/**
 * True when a failed `npm view` means the package has never been published
 * (npm's E404). Any other failure — network, registry outage, auth — is NOT
 * first-publish; the caller rethrows rather than guessing, because
 * mislabelling one tells docs to write a brand-new page for a package that has
 * shipped for months. Same posture as check-not-already-published's third
 * state: "could not confirm" must never collapse into an answer.
 */
export function isFirstPublishFromError(err) {
  return `${err?.stderr ?? ''}${err?.stdout ?? ''}`.toString().includes('E404')
}

/** True when npm knows no version of this package other than the current one. */
export function npmIsFirstPublish(name) {
  try {
    const out = execFileSync('npm', ['view', name, 'versions', '--json'], { stdio: 'pipe' }).toString()
    const versions = JSON.parse(out)
    return (Array.isArray(versions) ? versions : [versions]).length <= 1
  } catch (err) {
    if (isFirstPublishFromError(err)) return true
    throw err
  }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const get = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1] }
  const payload = buildPayload({
    rootDir: process.cwd(),
    tag: get('--tag'),
    channel: get('--channel'),
    runUrl: get('--run-url'),
    isFirstPublish: npmIsFirstPublish,
  })
  assertValid(payload)
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}
