/**
 * Extract the verbatim markdown body of a CHANGELOG section for `version`.
 * Returns null when there is no such section.
 *
 * Used for BOTH halves of the payload, which read the same way but mean
 * different things:
 *
 *   - the root CHANGELOG's `## <version>` section  → the payload's top-level
 *     `changelog`, the release's only prose (spec §3.1, added 2026-09-05)
 *   - a package's own CHANGELOG.md section         → `packages[].changelog`
 *
 * ⚠️ This repo has ZERO per-package CHANGELOG.md files and one root file, so
 * the second call always returns null today. The rule is implemented anyway
 * rather than hardcoding null, because §3.5.1's changeType rule is ordered and
 * a per-package changelog added later must start working without an edit here.
 * Hardcoding would make that a silent no-op.
 *
 * Heading forms: both `## 0.7.1-pre.0` (this repo) and `## [0.7.1-pre.0] — date`
 * (Keep a Changelog, which noy-db-ui uses) are accepted, so a later change of
 * house style does not silently classify every package `version-only`. That is
 * not hypothetical: noy-db-ui records porting a bare-heading matcher into a
 * Keep-a-Changelog repo, where it matched nothing and the bridge reported
 * success while never opening a doc-sync issue.
 *
 * Matching is EXACT on the version: `0.7.1` must not match `0.7.1-pre.0`.
 */
const SECTION = /^##\s+(?:\[([^\]]+)\]|(\S+))/

function headingVersion(line) {
  const m = SECTION.exec(line)
  return m ? (m[1] ?? m[2]) : null
}

export function extractSection(changelogText, version) {
  const lines = changelogText.split('\n')
  const start = lines.findIndex((l) => headingVersion(l) === version)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break }
  }
  return lines.slice(start + 1, end).join('\n').trim() || null
}
