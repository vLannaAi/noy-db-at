#!/usr/bin/env node
//
// version-set — move the whole workspace to one version, in one act.
//
// WHY THIS, AND NOT CHANGESETS.
//
// Changesets' central value is computing a dependency closure over a lockstep
// line: which siblings must move because something they depend on moved. This
// repo has five packages and (today) ZERO internal edges, so there is no
// closure to compute. Adopting changesets would import pre-mode, pre.json
// consumed-changeset tracking and a version-normalization story to solve a
// problem this repo does not have.
//
// It would also mean inheriting release machinery's failure semantics, which is
// the part most likely to be wrong in a new context. Core's own
// version-advanced.mjs compared versions wrongly wherever one ran out of
// segments — it REFUSED 0.7.0-pre.18 -> 0.7.0 as "did not advance" and ACCEPTED
// 0.7.0 -> 0.7.0-pre.18, a real regression — and 18 green releases could not
// have caught it, because inside a pre line both versions have equal segment
// counts and the faulty branch never executes. Exiting pre mode is the first
// run that reaches it.
//
// So this script deliberately does NOT compare versions or decide what the next
// one is. It takes the version it is given and applies it. Deciding is a human
// act here; the machine's job is only to make sure the decision lands
// EVERYWHERE, which is the part a human reliably gets wrong.
//
//   pnpm version:set 0.7.1
//   pnpm version:set 0.8.0-pre.0
//
// Then: `pnpm check:versions-uniform` (did it land everywhere) and
//       `pnpm check:not-already-published` (is it ours to ship).
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]

if (!target || !semver.valid(target)) {
  console.error(
    `\nUsage: pnpm version:set <version>\n\n` +
      (target ? `   "${target}" is not a valid semver version.\n` : '   No version given.\n') +
      `   e.g. pnpm version:set 0.7.1   ·   pnpm version:set 0.8.0-pre.0\n`,
  )
  process.exit(1)
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const pkgDirs = readdirSync(ROOT).filter(
  (d) =>
    !d.startsWith('.') &&
    d !== 'node_modules' &&
    d !== 'scripts' &&
    existsSync(join(ROOT, d, 'package.json')),
)

const names = new Set(pkgDirs.map((d) => readJson(join(ROOT, d, 'package.json')).name))
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']
const changes = []

for (const dir of pkgDirs) {
  const file = join(ROOT, dir, 'package.json')
  // Edited as TEXT, not re-serialized from the parsed object: rewriting the
  // whole file would silently reformat key order and spacing across five
  // manifests, burying the two lines that actually changed in a diff nobody
  // can review.
  let text = readFileSync(file, 'utf8')
  const json = JSON.parse(text)

  if (json.version !== target) {
    const before = text
    text = text.replace(
      /(^\s*"version":\s*)"[^"]*"/m,
      (_, lead) => `${lead}${JSON.stringify(target)}`,
    )
    if (text === before) {
      console.error(`✗ ${dir}/package.json: could not rewrite the version field`)
      process.exit(1)
    }
    changes.push(`${json.name}  version  ${json.version} → ${target}`)
  }

  // Internal ranges move with the line. Vacuous today (no internal edges) and
  // kept anyway: the day one is added, the alternative is a sibling range
  // pointing at a version that does not exist — which resolves fine inside the
  // workspace and ERESOLVEs for the consumer.
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(json[field] ?? {})) {
      if (!names.has(dep)) continue
      // NO { includePrerelease: true } here — see check-versions-uniform.mjs. With
      // the flag this line SKIPPED a stale-tuple range (^0.7.0 at target
      // 0.7.1-pre.0) as already-satisfied, so version-set silently declined to
      // normalise exactly the edges that break consumer resolution. The mitigation
      // and the defect were one bug with opposite signs.
      if (semver.satisfies(target, range)) continue
      const next = `^${target}`
      const re = new RegExp(`("${dep.replace('/', '\\/')}":\\s*)"[^"]*"`)
      if (!re.test(text)) {
        console.error(`✗ ${dir}/package.json: could not rewrite ${field}["${dep}"]`)
        process.exit(1)
      }
      text = text.replace(re, (_, lead) => `${lead}${JSON.stringify(next)}`)
      changes.push(`${json.name}  ${field}["${dep}"]  ${range} → ${next}`)
    }
  }

  writeFileSync(file, text)
}

if (!changes.length) {
  console.log(`✓ already on ${target}; nothing to change`)
  process.exit(0)
}

console.log(`\nSet the workspace to ${target}:\n`)
for (const c of changes) console.log(`   ${c}`)
console.log(
  `\nNext:\n` +
    `   pnpm install                       # the lockfile must follow\n` +
    `   pnpm check:versions-uniform        # did it land everywhere\n` +
    `   pnpm check:not-already-published   # is this version ours to ship\n`,
)
