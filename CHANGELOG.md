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

- **An expired justification, one clause of which reached maintainers as a live
  error.** `release.yml`'s prerelease-routing guard told anyone who tripped it
  that `@latest` was *"already broken here (17 deprecated 0.5.0 versions)"*.
  Every clause was false for this repo, measured 2026-09-01: five packages, not
  17; `@0.5.0` deprecated is empty for all five (controlled against a
  known-deprecated package, so the empty result is an answer and not a broken
  query); `@latest` is `0.7.0`, a healthy stable; and the stable the comment
  called "blocked" has shipped.

  The **guard is correct and stays** — a semver prerelease routed to `@latest` is
  a real hazard. Only its justification expired, so the condition was replaced
  with the reason, which cannot. The "17" was traced to its origin:
  `check-peer-floor.mjs`'s header records noy-db-to's #89 being repaired by
  deprecating 17 `to-*` versions, and `release.yml` had re-pointed that number at
  `at-*` packages.

- **Three more borrowed justifications corrected in place**, all telling another
  repo's incident as this repo's own: `check-peer-floor.mjs` claimed "1717 tests"
  (this repo has 95) and "currently two" distinct peer floors (measured: one),
  and attributed noy-db-to's #89/#84 locally; `align-dist-tags.mjs` said "this
  repo has the scar" about a `to-browser-fs` incident that happened elsewhere.
  The reasoning transfers exactly and was kept; the attribution did not and was
  fixed. Stating someone else's incident as your own is how a justification
  survives past the point anyone can check it.

- **`check-peer-floor.mjs` called these packages "stores".** They are sealing-key
  providers. In this family the prefix is the layer, not a naming convention, so
  the vocabulary is load-bearing rather than cosmetic.

### Changed

- **Two guards in the `notify-docs` job made reachable in the cases they name.**
  Neither could have shipped a wrong doc-sync issue — the step fails either way —
  but each was dead code in exactly the situation it was written for.

  *The empty-list guard could not fire on an empty glob* (**was live**). The list
  was built by globbing `at-*/package.json` and running node per match; with no
  matches bash leaves the glob literal, node throws `MODULE_NOT_FOUND`, and
  `set -euo pipefail` kills the step before `COUNT` is computed — a stack trace
  instead of the message written for the operator. Now enumerated inside node,
  and mutation-checked with controls: empty tree → the guard's own message;
  one package → `COUNT=1`; private-only → refused. The private exclusion is new
  behaviour: the root manifest is not published, so it must not be listed.

  *`| head -1` under `pipefail`* (**latent, not live**). `head` closing the pipe
  can SIGPIPE the producer, which `pipefail` propagates and `set -e` turns into
  exit 141. Replaced with a `jq`-side first-match, removing the pipe.

  ⚠️ **This one was never reachable here, and the first analysis overstated it.**
  `gh issue list --limit 20` emits at most ~100 bytes, and at 20 lines the
  construct exits 0 in 15 of 15 runs. The claim that it "would have died in the
  duplicate case" was mechanism-verified but consequence-unrun.

  ⚠️ **And the safety margin is a race, not a threshold.** At 100 lines the same
  command exits 141 in **13 of 15 runs** and 0 in the other 2 — it depends on the
  producer still writing when `head` closes, not on a size cutoff. So the fix is
  kept for a reason that survives: the `jq` form cannot start failing if
  `--limit` is ever raised, whereas the pipe form would begin failing
  intermittently, in the duplicate case only — the worst possible place for a
  latent bug.

### Removed

- **The `docs-bridge` job, which could never have run.** It invoked
  `scripts/docs-bridge/build-payload.mjs` and
  `scripts/__tests__/docs-bridge-capabilities.test.ts`, neither of which was
  extracted into this repo. Being `continue-on-error: true`, a release would have
  published, the job would have died at "Build payload", and **the run would
  still have reported green** — producing neither half of the proof pair.

  Porting the scripts was not the fix: noy-db-to's `build-payload.mjs` filters
  `d.name.startsWith('to-')`, which matches nothing here, so a verbatim port
  trades a job that fails green for one that fails red and still never notifies
  docs. The intended replacement is a direct `gh issue create` — what
  noy-db-docs actually consumes is the issue body — but that needs a token
  scoped to their repo and their agreement, so it is **not yet wired**. The
  honest interim state is the job absent rather than lying; noy-db-docs has a
  documented fallback for the no-issue case.

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
