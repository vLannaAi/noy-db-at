#!/usr/bin/env node
//
// check-not-already-published — refuse a version the registry already carries.
//
// WHY THIS EXISTS.
//
// This is the executable form of the family's "git is not npm" law, pointed at
// the direction that law is rarely read in. The usual reading is that a version
// committed to a repo is not real until published, so `main` running ahead means
// downstream pins a phantom. The inverse bit this repo on 2026-09-01: the
// registry ran AHEAD of the source. Core cut and published 0.7.0 for the whole
// lockstep line after this repo's extraction snapshot was taken, so all five
// manifests said 0.7.0-pre.17 while npm carried 0.7.0 for every one of them.
//
// Nothing in the repo could see it. Every gate was green — the manifests were
// internally consistent, the peers resolved, the suite passed — because every
// one of those checks reads only local state, and the discrepancy was entirely
// between local state and the registry. It took three sessions measuring npm by
// hand to find. This file is what would have caught it in one CI run.
//
// ── The failure it prevents ──────────────────────────────────────────────
//
// Publishing a version npm already carries is EPUBLISHCONFLICT: loud, and
// therefore not the dangerous case. The dangerous case is the one above —
// discovering only at publish time that the version you were about to ship was
// never yours to ship, after a release has already cost an hour.
//
// ── Could-not-confirm is NOT clean ───────────────────────────────────────
//
// A registry read can fail for reasons that have nothing to do with the answer:
// no network on the runner, a 5xx, an expired token. Those states warrant a
// different response from "this version is taken", so they get a different exit
// code and a different message. Collapsing them would make a network blip read
// as permission to publish, which is the one direction that must never happen
// silently.
//
//   E404 for the exact version  -> that version is free                (good)
//   version resolves            -> already published                   (exit 1)
//   anything else               -> could not confirm                   (exit 2)
//
//   node scripts/check-not-already-published.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

const pkgs = readdirSync(ROOT)
  .filter(
    (d) =>
      !d.startsWith('.') &&
      d !== 'node_modules' &&
      d !== 'scripts' &&
      existsSync(join(ROOT, d, 'package.json')),
  )
  .map((d) => readJson(join(ROOT, d, 'package.json')))
  .filter((j) => !j.private)

const taken = []
const unconfirmed = []
const free = []

await Promise.all(
  pkgs.map(async (j) => {
    const spec = `${j.name}@${j.version}`
    try {
      const { stdout } = await run('npm', ['view', spec, 'version', '--json'], { timeout: 60_000 })
      const got = JSON.parse(stdout.trim() || 'null')
      if (got) taken.push(spec)
      else unconfirmed.push([spec, 'npm view returned no version and no error'])
    } catch (err) {
      const text = `${err.stderr ?? ''}${err.stdout ?? ''}${err.message ?? ''}`
      // E404 on an exact version is the ANSWER, not a failure: that version is free.
      if (/E404|code E404|is not in this registry|No match found/i.test(text)) free.push(spec)
      else unconfirmed.push([spec, text.split('\n').find((l) => l.trim()) ?? 'unknown error'])
    }
  }),
)

if (taken.length) {
  console.error(`\n✗ ${taken.length} version(s) the registry ALREADY carries:\n`)
  for (const s of taken) console.error(`   ${s}`)
  console.error(
    `\nPublishing these is EPUBLISHCONFLICT. The source is BEHIND the registry —\n` +
      `set the line forward with \`pnpm version:set <version>\` before releasing.\n`,
  )
  process.exit(1)
}

if (unconfirmed.length) {
  console.error(`\n✗ could not confirm ${unconfirmed.length} package(s) against the registry:\n`)
  for (const [s, why] of unconfirmed) console.error(`   ${s}  — ${why}`)
  console.error(
    `\nThis is NOT the same as "these versions are free" and must not be read as one.\n` +
      `Re-run when the registry is reachable.\n`,
  )
  process.exit(2)
}

console.log(`✓ ${free.length} package version(s) are unpublished and free to release`)
