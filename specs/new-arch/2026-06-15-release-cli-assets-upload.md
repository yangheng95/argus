# Release CLI assets upload

## Problem

The release workflow packages CLI archives in `package-cli` and validates them with `check-release-assets.ts --require-archives`, but `publish-release-assets` only downloads `overlay-*` artifacts before running `gh release upload`. Release installs and Homebrew formula generation reference CLI archive URLs, so a tagged release can succeed while publishing only overlay assets.

## Call sites

| Surface | Current state | Decision |
| --- | --- | --- |
| `.github/workflows/build.yml` `package-cli` | Uploads `opencorvus-dist-${{ matrix.platform }}` containing CLI archives | Keep |
| `.github/workflows/build.yml` `publish-release-assets` | Downloads only `overlay-*` | Also download `opencorvus-dist-*` into the same release asset staging tree |
| `packages/opencorvus/script/publish.ts` | References `opencorvus-<platform>.tar.gz` / `.zip` release URLs | Keep; release upload must provide those files |
| `packages/opencorvus/test/script/release-overlay-contract.test.ts` | Covers overlay release bundles only | Extend to assert CLI artifacts are downloaded and upload step is not overlay-only |

## Validation

- `bun test --timeout 60000 test/script/release-overlay-contract.test.ts`
- Opencorvus typecheck plus root routes/docs checks.
