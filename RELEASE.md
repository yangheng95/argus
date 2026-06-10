# Release Flow

This repository has one canonical release flow.

For the full package-script and artifact-shape map, see [docs/packaging.md](/docs/packaging.md).

## Source Of Truth

- Release version source of truth: [packages/opencorvus/package.json](/packages/opencorvus/package.json)
- Overlay must always match the same version:
  - [packages/overlay/package.json](/packages/overlay/package.json)
  - [packages/overlay/src-tauri/Cargo.toml](/packages/overlay/src-tauri/Cargo.toml)
  - [packages/overlay/src-tauri/tauri.conf.json](/packages/overlay/src-tauri/tauri.conf.json)

Use:

```bash
bun ./script/sync-version.ts 0.0.1
```

`sync-version.ts` accepts `0.0.1-alpha` and `v0.0.1-alpha`, then normalizes the stored repo version to `0.0.1-alpha`.

Validate:

```bash
bun ./script/sync-version.ts --check
```

## Canonical CI Workflow

- Canonical workflow: `.github/workflows/build.yml`
- Trigger sources:
  - tag push `v*`
  - manual dispatch with `version`

Version inputs accept `0.0.1-alpha` and `v0.0.1-alpha`, but stored repo versions are normalized to `0.0.1-alpha`. The tag-triggered GitHub release workflow still listens to `v*` tags.

The workflow does all of the following in one pipeline:

1. Sync and verify `opencorvus` + `overlay` versions
2. Build cross-platform OpenCorvus CLI archives
3. Build native overlay bundles on Linux / Linux ARM64 / macOS ARM64 / macOS x64 / Windows x64
4. Upload overlay assets into the same GitHub Release
5. Publish the `release` branch contents

`build-overlays.yml` is debug-only and is not the canonical release path.

Current packaging note: the canonical CI CLI package still stages overlay UI as
a sibling `ui/` directory. The local Linux single-binary package in
`script/package-linux-binary.ts` embeds the same UI into the executable under
`packages/opencorvus/dist/binary/*/opencorvus`. These are different package
shapes until the CI CLI package is migrated. The mismatch is documented in
[docs/packaging.md](/docs/packaging.md).

## Local Release Command

Use:

```bash
./script/release patch
./script/release minor
./script/release major
./script/release 0.0.1
./script/release v0.0.1
```

What it does:

1. Computes the target version
2. Runs `bun ./script/sync-version.ts <version>`
3. Dispatches `.github/workflows/build.yml`

## Local Overlay Build

Use:

```bash
bun run --cwd packages/overlay build
```

This build is bound to `opencorvus` packaging:

1. Builds the current-platform `opencorvus` binary
2. Stages it into overlay Tauri resources
3. Builds the overlay installer/bundle

## Required CI Guards

- `.github/workflows/test.yml` runs `bun ./script/sync-version.ts --check`
- If overlay and opencorvus versions drift, CI must fail
- Release workflows validate asset names and required files with:

```bash
bun ./script/check-release-assets.ts cli ...
bun ./script/check-release-assets.ts overlay ...
```

## Release Expectations

Successful release means:

- CLI archives exist for supported platforms
- Overlay bundles exist for supported platforms
- Overlay launches bundled `opencorvus`
- Overlay reaches `online`
- Overlay and opencorvus versions are aligned in repo metadata
