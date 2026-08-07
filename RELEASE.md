# Release Flow

This repository has one canonical release flow.

For the full package-script and artifact-shape map, see [docs/packaging.md](/docs/packaging.md).

## Source Of Truth

- Release version source of truth: [packages/opencorvus/package.json](/packages/opencorvus/package.json).
- `script/sync-version.ts` owns the explicit OpenCorvus release-family target registry. It synchronizes the CLI, Overlay, internal workspace packages, Visual Studio Code extension, native process supervisor, Tauri configuration, and Bun/Cargo lock entries from that source.
- `packages/web` keeps its independent documentation-site version and is not a release-family target.

Use:

```bash
bun run version:bump 0.0.23beta
```

`version:bump` accepts compact product input such as `0.0.8beta` and canonical SemVer input such as `v0.0.8-beta`. Stored package/native metadata is always canonical SemVer (`0.0.8-beta`), while Overlay derives the compact label (`v0.0.8beta`) from the same value.

Validate:

```bash
bun run version:check
```

## Canonical CI Workflow

- Canonical workflow: `.github/workflows/build.yml`
- Trigger sources:
  - tag push `v*`
  - manual dispatch with `version`

Version inputs accept compact prerelease and canonical SemVer forms, but stored repo versions are normalized to canonical SemVer. The tag-triggered GitHub release workflow still listens to `v*` tags.

The workflow does all of the following in one pipeline:

1. Sync and verify `opencorvus` + `overlay` versions
2. Run the native GUI installer matrix on Linux / Linux ARM64 / macOS ARM64 / macOS x64 / Windows x64
3. Validate and upload GUI assets into the GitHub Release
4. Publish the same GUI platform directories on the `release` branch

`build-overlays.yml` is debug-only and is not the canonical release path.

The portable CLI matrix and Linux remote-service bundles remain explicit
operational commands. They are validated package surfaces, but they are not
inputs to the canonical GUI-only GitHub release workflow. Their artifact shapes
and commands are documented in [docs/packaging.md](/docs/packaging.md).

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
- The release workflow validates GUI asset names and required files with:

```bash
bun ./script/check-release-assets.ts overlay ... --require-bundle
```

## Release Expectations

Successful release means:

- GUI executable and installer bundles exist for every supported platform
- Overlay launches bundled `opencorvus`
- Overlay reaches `online`
- Overlay and opencorvus versions are aligned in repo metadata

Portable CLI and Linux remote-service bundle acceptance is performed separately
with `bun run package:binary-matrix` and `bun run package:linux-binary` on their
supported native hosts.
