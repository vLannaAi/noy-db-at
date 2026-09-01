# `@noy-db/at-*` — sealing-key providers for noy-db

The **`at-` family**: *sealed **at** a trusted host*. Each package hands hub a key to seal with,
bound to the published `@noy-db/hub/at` port.

⚠️ **This is the one family in the noy-db grammar that is NOT zero-knowledge.** A host you control
can decrypt the slice it unseals — that is the point of it, and the reason the prefix is a layer
rather than a naming convention. Everything else (`to-`, `in-`, `on-`, `by-`) never sees key
material it can use; these providers do, in a scoped way.

| package | host |
|---|---|
| `at-aws-kms` · `at-gcp-kms` · `at-azure-keyvault` | cloud KMS |
| `at-macos-keychain` | OS keychain |
| `at-env` | environment variable — for development and CI |

Extracted from the `noy-db` monorepo so hub can iterate without republishing this family.

## Binding

Every member declares `@noy-db/hub` as a caret-ranged **peer** and imports `@noy-db/hub/at`. None
imports the store contract — a sealing provider yields a key; it never touches storage.

```bash
npm i @noy-db/hub @noy-db/at-aws-kms
```

## Develop

```bash
pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck
pnpm check:architecture
pnpm check:peer-floor
```

Tests run against **no real cloud service** — every provider is mock-tested, and a few
credential-gated cases skip by design (the same ones skip in the monorepo).

## Coverage

Four of five bind the published `@noy-db/test-sealer-conformance` kit. **`at-azure-keyvault` does
not**, so it has no external-author verification — its suite is written by the same author as its
code. Do not read a green run there as a kit run.

Publishing happens from a **GitHub Release** triggering `release.yml`, never a raw `npm publish`.
Pre-1.0: public APIs may still change.
