# Changelog — `noy-db-at`

The five `@noy-db/at-*` sealing-key providers move as **one version line**, so this
is one changelog for the repo rather than one per package.

It is written by hand. There is no changesets setup here deliberately: changesets'
central value is computing a dependency closure over a lockstep line, and this repo
has five packages and zero internal edges, so there is no closure to compute.
See `scripts/version-set.mjs` for the full reasoning.

**This file is not published.** Every package's `files` array is
`["dist", "README.md", "LICENSE"]`, so no changelog ships in any tarball. A mistake
here is amendable in place — unlike `@noy-db/hub`, which ships its `CHANGELOG.md`
and must therefore correct a bad entry *alongside*, in the next one.

---

## Unreleased

### Fixed

- **The version baseline was behind the registry.** All five manifests said
  `0.7.0-pre.17` while npm carried `0.7.0` for every package: core cut and
  published `0.7.0` for the whole lockstep line on 2026-09-01, after this repo's
  extraction snapshot was taken.

  The **code was never behind — only the manifests.** Verified by comparing the
  `sourcesContent` embedded in each published `0.7.0` tarball's
  `dist/index.js.map` against this tree's `src/`: byte-identical across all five.
  The tarballs ship no `src/`, so the sourcemap was the only query that could
  answer this without a local build, and unlike diffing `dist/` it cannot be
  defeated by tsup or banner drift.

- **Hub peer ranges narrowed from `^0.7.0-pre.17` to `^0.7.0`**, matching what
  published `0.7.0` declares. The prerelease caret was the **wider** range — it
  reaches forward into its stable *and* admits the whole 0.7 pre line — so keeping
  it would silently have re-widened what `0.7.0` narrowed.

- **Nineteen exact dev pins on core** (`hub`, `on-shamir`, `to-memory`,
  `test-sealer-conformance`) moved to `0.7.0` as a unit. Found by grepping for the
  **old version string** after the edit was believed complete; re-reading the edit
  would have shown five happy versions and confirmed nothing.

- **A release would have failed before publishing.** `release.yml`'s verify gate
  read the version from the **root** `package.json` as "the lockstep canonical",
  a step ported verbatim from `noy-db-to`. This repo's root manifest is
  `private: true` and carries no `version`, so the check compared the string
  `undefined` against the tag and could never pass. Replaced with a per-package
  tag check that reads the packages actually being published.

- **`release.yml`'s consumer-facing examples named `@noy-db/to-aws-s3`**, carried
  over from `noy-db-to`. Corrected to `@noy-db/at-env`. Both workflow headers also
  described these packages as "storage adapters"; they are sealing-key providers.

### Added

- **`pnpm version:set <version>`** — sets every package to one version and rewrites
  any internal range to match. It deliberately does **not** decide what the next
  version is or compare versions: core's own release comparator inverted semver in
  both directions, and 18 green releases could not have caught it because the
  faulty branch is unreachable until a pre line exits. Deciding is a human act;
  the machine's job is making the decision land everywhere.

- **`pnpm check:versions-uniform`** — every package on one version, every internal
  range admitting it. Written as an invariant over the output rather than a pinned
  string, so it is not edited every release. This is the guard a hand-run bump
  lacks: a partial bump builds, typechecks and tests green, and surfaces only at
  publish time. Runs in CI.

- **`pnpm check:not-already-published`** — refuses a version the registry already
  carries. The executable form of the family's *git is not npm* law, aimed at the
  direction that bit this repo: the registry running **ahead** of the source, which
  no local gate can see because every local gate reads only local state.

  It distinguishes three states, and the third is why it exists in this shape:
  `0` free, `1` already published, `2` **could not confirm** (registry unreachable).
  Collapsing "could not confirm" into "free" would let a network blip read as
  permission to publish.

  It runs on the **release path, not in CI**: between releases a repo's current
  version *is* published, so on a pull request it would be correctly and
  permanently red.

### Known

- **`at-azure-keyvault` binds no conformance kit.** The other four bind
  `@noy-db/test-sealer-conformance`. A green suite there is the same author
  checking their own reading, which is precisely what an external kit exists to
  break. Tracked as `noy-db-at#5`.

- **The `docs-bridge` job in `release.yml` cannot run here.** It invokes
  `scripts/docs-bridge/build-payload.mjs` and
  `scripts/__tests__/docs-bridge-capabilities.test.ts`, neither of which exists in
  this repo — both were left behind at extraction. Because the job is
  `continue-on-error: true`, a release would publish, the job would fail at "Build
  payload", and **the run would still report green**, with neither half of the
  documented proof pair (payload asset attached, doc-sync issue filed in
  `noy-db-docs`) produced. Whether to port the scripts or drop the job is a
  cross-repo decision and is not being made here.
