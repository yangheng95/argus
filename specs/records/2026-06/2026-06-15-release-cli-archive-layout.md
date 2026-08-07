# Release CLI archive layout

## Problem

The release workflow builds baseline and musl CLI variants, but `Package CLI archive` only archives `opencorvus-${{ matrix.platform }}`. The installer can request `linux-x64-baseline`, `linux-x64-musl`, or `linux-x64-baseline-musl`, and macOS/Windows x64 can request `*-baseline`, so those archives would be missing. The archive command also stores the outer directory name, while `install` and the generated Homebrew formula expect the extracted archive root to contain `opencorvus` directly.

## Call sites

| Surface                                                       | Current state                                             | Decision                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| `.github/workflows/build.yml` `Build CLI (native + baseline)` | Produces native and baseline dist directories             | Package every matching `opencorvus-${{ matrix.platform }}*` directory    |
| `.github/workflows/build.yml` `Build CLI (musl, Linux only)`  | Adds musl and baseline-musl directories with `--no-clean` | Include them in the same archive loop and validation list                |
| `.github/workflows/build.yml` `Package CLI archive`           | Archives the wrapper directory                            | Archive directory contents so extraction yields `opencorvus` at the root |
| `script/check-release-assets.ts`                              | Validates every platform listed in `--platforms`          | Pass every discovered variant platform to validation                     |
| `install` and `packages/opencorvus/script/publish.ts`         | Expect root-level `opencorvus` after extraction           | Keep; release archives must match this contract                          |

## Validation

- Extend release workflow contract tests for archive loop and layout commands.
- Extend `check-release-assets` tests for variant archive validation.
- Run script tests plus typecheck/routes/docs before push.
