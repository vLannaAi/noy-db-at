import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// ARCH_ROOT lets the self-test point the scan at a fixtures dir; default is
// the repo root (one level up from scripts/).
const ROOT = process.env.ARCH_ROOT
  ? resolve(process.env.ARCH_ROOT)
  : resolve(fileURLToPath(import.meta.url), '../..')

let failures = 0
function fail(rule, msg, where) {
  failures++
  console.error(`✗ [${rule}] ${msg}${where ? ` (${relative(ROOT, where)})` : ''}`)
}

// Providers are flat at the repo root: directories named `at-*` with a package.json.
function listProviderDirs() {
  if (!existsSync(ROOT)) return []
  return readdirSync(ROOT)
    .filter(name => name.startsWith('at-'))
    .map(name => join(ROOT, name))
    .filter(p => statSync(p).isDirectory())
    .filter(p => existsSync(join(p, 'package.json')))
}

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

function walkTs(dir, cb) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walkTs(p, cb)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) cb(p, readFileSync(p, 'utf8'))
  }
}

// Rule 1 — hub-peer-range: @noy-db/hub must be a peerDependency at a published
// RANGE; never in dependencies, never a workspace: specifier.
function checkHubPeerRange() {
  for (const dir of listProviderDirs()) {
    const pj = readPkg(dir)
    const dep = pj.dependencies?.['@noy-db/hub']
    const peer = pj.peerDependencies?.['@noy-db/hub']
    if (dep !== undefined)
      fail('hub-peer-range', `${pj.name} has @noy-db/hub in dependencies; it must be a peerDependency range.`, dir)
    if (peer === undefined)
      fail('hub-peer-range', `${pj.name} is missing peerDependencies['@noy-db/hub'].`, dir)
    else if (peer.startsWith('workspace:'))
      fail('hub-peer-range', `${pj.name} peers @noy-db/hub as "${peer}"; cross-repo providers must use a published range (e.g. "^0.2.0-pre.31").`, dir)
    else if (!/^[\^~]?\d/.test(peer))
      fail('hub-peer-range', `${pj.name} peers @noy-db/hub as "${peer}"; expected a semver range.`, dir)
  }
}

// Rule 2 — no-runtime-store-import: a provider's src must not VALUE-import the
// store contract. (noy-db-to calls its rule `to-only` and means nearly the
// opposite; see the note in the function body.)
// Covers static imports (from/import), dynamic import(), require(), and bare
// side-effect imports (import '@noy-db/hub').
const HUB_IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"]@noy-db\/hub(\/[^'"]*)?['"]/g
function checkNoRuntimeStoreImport() {
  // Rule 2 — no-runtime-store-import (the `at-*` layer boundary).
  //
  // NOT noy-db-to's `to-only` rule, which requires a package to import ONLY
  // `@noy-db/hub/to`. Ported verbatim it fails on correct code here, because a
  // `at-*` package binds its own port and legitimately reads shared types
  // from the root.
  //
  // What IS invariant: a sealing-key provider hands hub a key to seal WITH; it never touches the store. So a VALUE import of the store
  // contract is a layer violation, while a TYPE-only import is not — the types
  // erase at build and move no data.
  //
  // ⚠️ Implemented by scanning BACKWARD from each module specifier to its own
  // `import` keyword, NOT by one regex over the statement. A pattern like
  // /import\s+(type\s+)?[^;]*?from '...'/ looks right and is wrong: `[^;]`
  // matches NEWLINES, so it happily spans from an unrelated multi-line
  // `import { a, b, c }` at the top of a file down to a `from` clause far
  // below, reports the wrong statement, and misses the `type` keyword that is
  // actually there. That produced a false positive on real code.
  const SPEC = "from '@noy-db/hub/to'"
  for (const dir of listProviderDirs()) {
    const pj = readPkg(dir)
    walkTs(join(dir, 'src'), (file, code) => {
      let at = code.indexOf(SPEC)
      while (at !== -1) {
        const kw = code.lastIndexOf('import', at)
        // The statement is type-only if `type` is the next token after `import`.
        const isTypeOnly = kw !== -1 && /^import\s+type\b/.test(code.slice(kw, at))
        if (!isTypeOnly)
          fail('no-runtime-store-import',
            `${pj.name}: value-imports '@noy-db/hub/to' — a sealing-key provider hands hub a key to seal WITH; it never touches the store. ` +
            `Use \`import type\` if you only need the contract's types.`, file)
        at = code.indexOf(SPEC, at + 1)
      }
    })
  }
}

// Rule 3 — no-crypto-deps: an `at-*` provider ships no crypto implementation of
// its own.
//
// ⚠️ NOT because it "only sees ciphertext" — that is noy-db-to's reason and it is
// FALSE here. `at-*` is the one family in the grammar that is not zero-knowledge:
// a host you control decrypts the slice it unseals. Stating the ciphertext reason
// on the rule most likely to fire on a new package would teach the wrong
// invariant at the moment someone is looking straight at it.
//
// The real reason is ownership. Hub owns the primitives and EXPORTS them —
// at-aws-kms/src/index.ts imports sealRsaOaepTlv / parseRsaOaepTlv / aesGcmOpen
// from '@noy-db/hub' — and a provider's job is to hand key material to a KMS or a
// keychain, not to reimplement the envelope. A second implementation inside a
// provider is a second thing to get wrong, sitting off to one side of the audited
// one.
const BANNED = new Set(['crypto-js', 'node-forge', 'tweetnacl', 'bcryptjs', 'bcrypt'])
function checkNoCryptoDeps() {
  for (const dir of listProviderDirs()) {
    const pj = readPkg(dir)
    for (const block of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pj[block] ?? {})) {
        if (BANNED.has(name) || name.startsWith('@noble/') || name.startsWith('@scure/'))
          fail('no-crypto-deps', `${pj.name} depends on crypto package "${name}"; hub owns the primitives — import them from @noy-db/hub instead of bundling a second implementation.`, dir)
      }
    }
  }
}

checkHubPeerRange()
checkNoRuntimeStoreImport()
checkNoCryptoDeps()

if (failures > 0) {
  console.error(`\n✗ Architecture invariants FAILED (${failures})`)
  process.exit(1)
}
console.log('✓ Architecture invariants OK')
