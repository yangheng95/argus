# Windows Channel Bundle Path Repair And Matrix Package

## Recall

| Item | Evidence / constraint |
| --- | --- |
| User request | Perform the package matrix. |
| Acceptance criteria | Build the canonical Graphical User Interface (GUI) installer matrix first and the portable Command-Line Interface (CLI) binary matrix second; package and independently validate the native Windows x64 rows; report every non-host row as skipped; preserve the source tree and running OpenCorvus/Overlay processes. |
| Hard constraints | Use `bun run package:gui-installer-matrix` and `bun run package:binary-matrix` as the only artifact owners. Do not use `--skip-build`, cross-compile claims, fallback imports, copied dependency trees, a second runtime source, a new worktree, Git reset/stash, hook bypass, or process restart/refresh. Commit subjects start with `dsw-33987`; pushes use `legacy-remote`. |
| Sources read | Repository `AGENTS.md`; `docs/packaging.md`; `RELEASE.md`; root package scripts; `script/package-gui-installer-matrix.ts`; `script/package-binary-matrix.ts`; `2026-07-22-channel-package-closure-boundary-repair.md`; current branch/status/remotes/version history; channel bundle source and focused tests. |
| Starting evidence | `v0.0.14beta` and `legacy-remote/v0.0.14beta` were equal at `fcf71f46c8`; divergence was `0 0`; the tracked worktree was clean; `bun run version:check` accepted `0.0.14-beta`. The first GUI matrix attempt exposed missing installed workspace/OpenClaw dependencies. `bun install --frozen-lockfile` restored them without a tracked diff. |
| Failure chronology | After dependency restoration, the original GUI matrix reached the static OpenClaw channel closure and Bun 1.3.13 crashed with `Expected pretty file path to have only forward slashes` for the Windows path of `source-map-support.js`. A focused run with Bun 1.3.14 reproduced the identical compiler panic, proving that a retry or local Bun upgrade is not a repair. |
| Whole-repository grep | `buildOpenClawNodeBundle` in `packages/channel-runtime/src/openclaw-build.ts` is the only static channel bundle owner and is called by production and local native builders plus runtime preparation. `packages/channel-runtime/test/openclaw-adapter.test.ts` and `packages/opencorvus/test/script/build-artifact.test.ts` execute the real closure. `source-map-support` enters only through `openclaw -> @homebridge/ciao`; ciao's root `lib/index.js` performs `require("source-map-support/register")` solely to install TypeScript stack-trace mapping. The generated sidecar must remain one self-contained Node bundle with no non-Node external imports or copied package tree. |
| Independent agent feedback | None requested; active collaboration policy forbids unrequested delegation. |

## Root Cause

Commit `d51c4f26f0` removed the OpenClaw application runtime and every
`@openclaw/*` dependency because those providers are now planned catalog entries,
but the lockfile retained the complete retired dependency closure. Bun therefore
continued to hoist OpenClaw, `@homebridge/ciao`, and `source-map-support` into the
workspace installation. During the compiled runtime's dynamic plugin closure,
Bun 1.3.13 visited that unowned CommonJS module and crashed while formatting its
absolute Windows path.

The observable panic is a Bun compiler defect, but the repository trigger is a
dual-source dependency graph: manifests say the application runtime is absent
while `bun.lock` says it is present. A source-map plugin cannot repair that
contradiction because the production closure reaches the resolved physical module
without invoking that plugin's resolver. The root repair is to remove the retired
lock closure and keep the existing thin channel contracts as the sole source.

## Plan

1. Regenerate `bun.lock` from the current manifests so OpenClaw,
   `@openclaw/*`, `@homebridge/ciao`, and their exclusive transitive closure are
   absent; verify a frozen install accepts the result.
2. Extend the existing native-artifact test so planned channel providers are
   absent from both the channel manifest and lockfile.
3. Remove the disproven source-map plugin experiment rather than retain dead
   compatibility code, then run focused tests, typecheck, document health, and
   the original GUI matrix command from a clean immutable commit.
4. Run the CLI binary matrix, independently validate artifact names, Portable
   Executable (PE) architecture, version, sizes, and SHA-256 (Secure Hash
   Algorithm 256-bit) values, then review the final worktree and remote equality.

## Verification Ledger

- The original `bun run package:gui-installer-matrix` command reproduced the
  Windows-only Bun compiler panic after the Software Development Kit (SDK) and
  Vite production builds completed. The failing input was the real
  `node_modules/.bun/node_modules/source-map-support/source-map-support.js`
  path; no installer artifact was accepted from that failed attempt.
- A source-map plugin experiment handled isolated bare and absolute imports but
  did not intercept the real compiled plugin closure; the original GUI command
  reproduced the identical panic. That disproven code and its synthetic tests
  are removed rather than retained as dead compatibility logic.
- Moving the 22 exact retired dependency directories/links out of
  `node_modules/.bun` made the real `overlay-server` compile pass through payload
  generation, 117 embedded UI files, the Windows x64 executable, and the native
  process-supervisor release build. The moved dependency tree and the obsolete
  generated channel bundle remain recoverable under the system temporary
  directory `opencorvus-stale-openclaw-20260722-0925`, outside repository
  source and scratch audits.
- Regenerating the lockfile against the default registry removed every OpenClaw,
  `@openclaw/*`, `@homebridge/ciao`, and `source-map-support` orphan record plus
  its exclusive transitive closure. `bun install --frozen-lockfile` accepts the
  regenerated lock without changes.
- The lock-closure repair was committed and pushed as `f3a321574c`. The first
  complete matrix proof used immutable commit `e3bdfb7e45`; after remote
  changes added the Research Studio payload and Chat scroll repair, the native
  rows were rebuilt from `40077b540b` so the final artifacts contain those
  production inputs. The subsequent remote commits through `aaea1bce30` change
  only tests and verification records, not package inputs.
- `bun run package:gui-installer-matrix` completed first. Its real checker
  accepted the Windows x64 runtime, MSI (Microsoft Installer), and NSIS
  (Nullsoft Scriptable Install System) installer. Linux x64, Linux ARM64,
  Darwin x64, and Darwin ARM64 were truthfully skipped because this host is
  Windows x64.
- `bun run package:binary-matrix` completed second. It produced both the
  Windows x64 portable CLI and its baseline variant plus their archives. The
  same four non-Windows host rows were skipped rather than cross-compiled or
  claimed without native verification.
- Independent release checks accepted the GUI directory and both CLI archive
  rows. Both CLI executables report `0.0.15-beta`; the GUI runtime and both CLI
  executables have PE machine `0x8664` (AMD64, 64-bit x86 architecture).
- Final artifact evidence:

  | Artifact | Bytes | SHA-256 |
  | --- | ---: | --- |
  | `packages/overlay/dist-artifacts/windows-x64/opencorvus-overlay.exe` | 198,370,816 | `ffc082d56719287f9eeffbfcf434e38aaf1e6c55eecde3af1eca54a551527554` |
  | `packages/overlay/dist-artifacts/windows-x64/OpenCorvus_0.0.15-beta_x64_en-US.msi` | 189,558,784 | `01c813b380ecdc86be022e0ed2e7bbac7ad78c0b3959fb007f53abddcd31ed27` |
  | `packages/overlay/dist-artifacts/windows-x64/OpenCorvus_0.0.15-beta_x64-setup.exe` | 188,484,552 | `d10420e09eca9c05275d8b1be96d7638ac83d4db0715be0fa891e1cccf1b9fa3` |
  | `packages/opencorvus/dist/opencorvus-windows-x64/opencorvus.exe` | 155,308,032 | `8aa6d9c2fa89c6f04f19d41d99490e5f4e61030e9681a5e81c3f9bb543b19383` |
  | `packages/opencorvus/dist/opencorvus-windows-x64.tar.gz` | 141,470,233 | `c2fe401e5543fbc87132e354b9ce8ae1273bf6782c6ece1c46b4fab0ed08a621` |
  | `packages/opencorvus/dist/opencorvus-windows-x64-baseline/opencorvus.exe` | 154,582,016 | `920edf3262732e377f3258b4908da8d929defac8680b9cd30e8fe4aef4f435bd` |
  | `packages/opencorvus/dist/opencorvus-windows-x64-baseline.tar.gz` | 141,187,558 | `be2c0011af6b1f4b67dbb5e7b781c09a7d44941a7f037ae1491ae1c5735b5a19` |
- Adjacent verification passed for version alignment, Overlay and OpenCorvus
  TypeScript, 42 focused Chat-scroll source tests, and the focused Research
  Studio package plus SDK round-trip assertions. The full package-manager suite
  is not represented as passing: on this Windows host it repeatedly reported
  temporary-directory rename `EPERM` errors and five-second isolated-process
  terminations. Those failures were outside the release checkers and did not
  alter the generated artifacts.
- No running OpenCorvus or Overlay process was restarted, refreshed, closed, or
  otherwise manipulated. Generated packages remain untracked release outputs.
