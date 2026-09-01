#!/usr/bin/env node
//
// check-versions-uniform — this repo publishes as ONE version line.
//
// WHY THIS EXISTS.
//
// This repo has no changesets and no dependency-closure tooling, deliberately:
// there is exactly one version line here and (today) zero internal package
// edges, so there is no closure to compute. `pnpm version:set <v>` moves every
// package at once. That is the whole mechanism.
//
// The thing a hand-run script cannot give you is a guarantee that it RAN
// everywhere. A partial bump — four packages moved, one missed — is silent:
// it builds, it typechecks, the suite is green, and it only surfaces at publish
// time as a version nobody meant to ship, or as a sibling range pointing at a
// version that does not exist. That failure mode is the one this file exists
// for, and it is the reason the check is an INVARIANT over the output ("all
// versions are equal") rather than an assertion about any particular version
// string. An assertion you have to edit at every release is one you stop
// reading.
//
//   node scripts/check-versions-uniform.mjs
//
// Exit 1 if the workspace is not on a single version, or if any internal
// range fails to admit it.
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

const pkgDirs = readdirSync(ROOT).filter(
  (d) =>
    !d.startsWith('.') &&
    d !== 'node_modules' &&
    d !== 'scripts' &&
    existsSync(join(ROOT, d, 'package.json')),
)

const pkgs = pkgDirs.map((d) => ({ dir: d, json: readJson(join(ROOT, d, 'package.json')) }))
const names = new Set(pkgs.map((p) => p.json.name))
const problems = []

// ── Invariant 1: one version across the workspace ────────────────────────
const versions = new Map()
for (const { dir, json } of pkgs) {
  if (!json.version) {
    problems.push(`${json.name} (${dir}/package.json) has no version field`)
    continue
  }
  if (!versions.has(json.version)) versions.set(json.version, [])
  versions.get(json.version).push(json.name)
}

if (versions.size > 1) {
  problems.push(
    `the workspace is on ${versions.size} different versions — it must be on exactly one:\n` +
      [...versions.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([v, who]) => `        ${v.padEnd(16)} ${who.sort().join(', ')}`)
        .join('\n'),
  )
}

const theVersion = versions.size === 1 ? [...versions.keys()][0] : null

// ── Invariant 2: every INTERNAL range admits that version ────────────────
//
// Counted and reported even when zero, deliberately. This repo currently has
// no internal edges at all, so this half is vacuous TODAY — and a check that
// is silently vacuous is indistinguishable from one that passed. Print the
// number so a reader can tell "nothing to check" from "everything checked".
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']
let internalEdges = 0

for (const { json } of pkgs) {
  for (const field of DEP_FIELDS) {
    for (const [dep, range] of Object.entries(json[field] ?? {})) {
      if (!names.has(dep)) continue
      internalEdges++
      if (theVersion === null) continue
      if (!semver.satisfies(theVersion, range, { includePrerelease: true })) {
        problems.push(
          `${json.name} → ${field}["${dep}"] = "${range}", which does NOT admit the workspace version ${theVersion}`,
        )
      }
    }
  }
}

if (problems.length) {
  console.error(`\n✗ version line is not uniform:\n`)
  for (const p of problems) console.error(`   ${p}`)
  console.error(
    `\nThis repo moves as ONE version line. Use \`pnpm version:set <version>\`,\n` +
      `which sets every package and rewrites internal ranges together.\n`,
  )
  process.exit(1)
}

console.log(
  `✓ all ${pkgs.length} package(s) on ${theVersion}; ` +
    `${internalEdges} internal range(s) admit it` +
    (internalEdges === 0 ? ' (none exist yet — this half of the check is vacuous today)' : ''),
)
