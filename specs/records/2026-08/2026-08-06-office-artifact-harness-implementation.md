# Office Artifact Harness Phase-One Implementation

Status: phase-one implementation and verification completed on 2026-08-06.

## Recall

### User requirements

The user first required a deep, independently audited investigation of how
WorkBuddy and comparable personal Artificial Intelligence (AI) assistants
produce office materials, followed by one coherent OpenCorvus integration
instead of separate PowerPoint Presentation (PPTX), Word Document (DOCX), and
Excel Workbook (XLSX) Skills or authoring frameworks. The accepted strategy is
recorded in `2026-08-06-office-artifact-harness-strategy.md`.

The current request authorizes implementation and adds a concrete release
requirement: every embedded executable must be packaged as part of a
self-contained runtime closure and must have executable permission on targets
that use Portable Operating System Interface (POSIX) mode bits.

### Acceptance criteria

1. Replace the presentation-specific runtime, tool, and Skill identities with
   one platform-owned Office Artifact Harness. The phase-one positive behavior
   remains bounded new-PPTX creation, inspection, validation, rendering, and
   delivery; DOCX/XLSX authoring is not claimed before its corpus qualifies.
2. Expose exactly four format-discriminated tools:
   `office_artifact_inspect`, `office_artifact_author`,
   `office_artifact_validate`, and `office_artifact_deliver`.
3. Replace `work-presentations` with the single `office-artifacts` Skill. No
   compatibility aliases, secondary format Skills, raw Extensible Markup
   Language (XML), shell surface, installer, updater, resident process, or
   Model Context Protocol (MCP) wrapper remains.
4. Retain canonical Attachment and Interactive Artifact publication and the
   existing Direct Work versus Task capability projection boundary.
5. Pin OfficeCLI 1.0.143 and its exact release commit, license, source, target
   asset, and Secure Hash Algorithm 256-bit (SHA-256) digests in one lock
   manifest. Runtime execution must disable updates and resident behavior and
   use isolated configuration, cache, profile, temporary, and bundle-extraction
   directories.
6. Every native bundle and release asset validator must require the OpenCorvus
   executable, Ripgrep, the Browser MCP Node.js runtime, and OfficeCLI. The
   actual package verifier must run a version probe for every embedded
   executable.
7. Packaging must normalize executable modes for every embedded executable on
   Linux/macOS after every copy/staging boundary and before archive creation.
   Archive verification must prove the normalized mode survives packaging.
8. Tests verify positive runtime closure, exact tool/Skill projection, typed
   author/inspect/validate/deliver behavior, and current package contents. No
   User Interface (UI) automation or negative tests are added or run.

### Hard constraints

- Follow the platform-default ownership selected by the strategy; expert
  squads may project the capability but cannot own another runtime.
- No fallback author, user `PATH` lookup, remote installer, runtime update,
  compatibility identity, or alternate serializer.
- All implementation edits use the current forward contract. Delete the old
  presentation-only identities and their stale tests rather than retaining a
  transition path.
- Preserve unrelated dirty work in `packages/overlay/src-tauri/src/main.rs`,
  the managed-backend diagnostic record, and the user-owned index edits.
- UI acceptance remains real interactive rendering and human inspection. This
  phase changes no UI and creates/runs no UI automated tests.

### Read records and repository evidence

- `specs/records/2026-08/2026-08-06-office-artifact-harness-strategy.md`
- `specs/current/architecture/04-extensions.md`
- `packages/opencorvus/src/work-office/presentation.ts`
- `packages/opencorvus/src/tool/work-office-presentation.ts`
- `packages/opencorvus/src/work/harness.ts`
- `packages/opencorvus/src/skill/builtin/work-presentations/**`
- `packages/opencorvus/script/build-artifact.ts`
- `packages/opencorvus/script/build-runtime-binaries.ts`
- `packages/opencorvus/script/build.ts`
- `packages/opencorvus/script/build.local.ts`
- `script/package-native-binary.ts`
- `script/package-linux-binary.ts`
- `script/check-release-assets.ts`

Whole-repository searches confirmed that the old three tool identities and
`work-presentations` are referenced only by the Work harness, global tool
registration, built-in Skill payload, current architecture record, and their
contract tests. The build already downloads pinned OfficeCLI assets for eight
targets and calls `chmod(0755)` on its direct non-Windows copy. However:

- native bundle required-file and smoke-command contracts omit OfficeCLI;
- release asset checking omits OfficeCLI;
- Linux secondary packaging explicitly repairs only the main executable;
- no single manifest binds the runtime asset set to the upstream commit and
  operational policy; and
- the runtime process environment disables resident mode but does not set
  `OFFICECLI_SKIP_UPDATE=1` or isolate the OfficeCLI configuration directory.

These are the direct causes of the self-contained/executable-closure gap.
OfficeCLI upstream describes 1.0.143 as release commit `fd4adab`, publishes one
self-contained binary per supported target, and documents
`OFFICECLI_SKIP_UPDATE=1` for per-invocation update suppression. These claims
are treated as supply-chain inputs and verified against the already pinned
release digests; they are not accepted as fidelity evidence.

### Independent agent feedback retained from the strategy

The market, open-source, and architecture agents independently selected one
platform Office Artifact Harness backed by a fixed OfficeCLI build, while
explicitly rejecting WorkBuddy embedding, per-format libraries, and parallel
Skills. No additional delegation is needed for this mechanical first phase.

## Implementation design

### Runtime ownership

`packages/opencorvus/src/office-artifact/` becomes the sole runtime namespace.
It owns the discriminated plan schemas, package inspection, OfficeCLI process
adapter, validation, and exact-digest delivery preparation. The current PPTX
implementation moves into this namespace without a compatibility export.

The four tools live in `packages/opencorvus/src/tool/office-artifact.ts`. Their
schema always carries `format: "presentation"` in phase one, making the
capability extensible without advertising unqualified DOCX/XLSX behavior.

### Runtime lock and packaging closure

`packages/opencorvus/runtime/officecli.lock.json` is the human- and
machine-readable source of version, release commit, license, policy, and eight
target assets. Build code parses that manifest strictly instead of maintaining
a second hard-coded asset table.

A shared packaging contract enumerates embedded executables. Every copy or
secondary package boundary applies POSIX mode `0755` to that exact set when the
target is Linux or macOS. Native bundle validation checks file presence, mode,
and `--version`; the release checker uses the same names. Tar archives preserve
the normalized modes.

### Verification

- schema/tool/Skill projection tests use only positive expected results;
- runtime tests prove the four-tool lifecycle and exact digest binding;
- packaging tests prove every target resolves a locked OfficeCLI asset and
  every required executable is present, executable, and version-probed;
- the real Windows OfficeCLI 1.0.143 binary is acquired through the locked
  build path and used for a bounded PPTX integration run;
- TypeScript typecheck, Application Programming Interface (API) route checks,
  documentation checks, and the existing release hooks must pass.

## Execution sequence

1. Introduce and parse the OfficeCLI runtime lock; centralize executable
   inventory and permission normalization.
2. Extend native/Linux/release packaging contracts and probes to OfficeCLI.
3. Move the presentation runtime into the generic Office Artifact namespace,
   add the inspect operation, and replace the three old tools with four generic
   tools.
4. Replace the built-in Skill and update Work/default capability projection,
   delegate boundaries, tool registration, and current architecture docs.
5. Replace stale tests with positive forward-contract tests, acquire the real
   pinned binary, run the integration slice, then run release-quality checks.
6. Perform a second diff/package review, update this record with evidence,
   commit with the required `dsw-33987` prefix, and push `v0.0.31beta` to
   `git-cc`.

## Delivered implementation

- The old `work-office` runtime, three presentation-specific tool identities,
  and `work-presentations` Skill were removed. The forward contract now has one
  `office-artifact` runtime namespace, exactly four format-discriminated tools,
  and one `office-artifacts` Skill.
- The phase-one schema honestly exposes only `format: "presentation"` for new
  PPTX creation. It performs canonical attachment inspection, bounded Open XML
  package analysis, OfficeCLI validation and issue inspection, fresh per-slide
  rendering, exact-digest binding, and parent-owned Interactive Artifact
  delivery.
- `packages/opencorvus/runtime/officecli.lock.json` is the single supply-chain
  manifest for OfficeCLI 1.0.143. It binds the upstream repository, tag, commit,
  Apache-2.0 license digest, eight platform assets and SHA-256 digests, and the
  non-installer/non-resident/no-update process policy.
- Build and runtime code consume that manifest directly. Production execution
  accepts only the colocated packaged runtime whose digest matches the target
  asset and whose POSIX execute bits are present. OfficeCLI receives isolated
  configuration, cache, profile, temporary, and .NET bundle extraction roots.
- Native packaging now derives one binary closure from the fixed OpenCorvus,
  Ripgrep, OfficeCLI, Browser MCP Node.js, and Windows supervisor entrypoints
  plus recursive Portable Executable (PE), Executable and Linkable Format
  (ELF), Mach-O, `.node`, shared-library, and helper-binary discovery. Every
  discovered native binary is part of archive verification; Linux and macOS
  normalization applies mode `0755` to the complete closure, and macOS signing
  consumes that same closure.
- Native, Linux, Docker, and release-asset contracts require the OfficeCLI
  runtime, lock, license, Browser MCP runtime, and colocated native dependency
  tree. The direct runtime entrypoints are version-probed before an archive is
  accepted.

## Verification evidence

### Real OfficeCLI lifecycle

The locked Windows x64 OfficeCLI executable reported version `1.0.143`. Its
actual SHA-256 was
`d4d4c10fced307e209744cf98a56b003a6e613424fd651b08469274704afd2c6`,
exactly matching the lock manifest. The real integration test authored a
two-slide PPTX, inspected it, ran validation and issue inspection twice,
rendered all slides twice, and bound delivery to the source digest:

```text
1 pass, 0 fail
Office Artifact real OfficeCLI integration > creates, validates, and renders the authored PPTX
```

Both final PNG renders were opened and visually inspected. Titles, the rounded
content card, picture, chart, labels, spacing, and 16:9 bounds were visible with
no clipping, blank slide, overflow, or illegible region.

### Real Windows native packages

Both Windows x64 native variants were compiled with Bun 1.3.13 and packaged.
Their packaged entrypoints were executed from the bundle directories:

| Entrypoint                    | Observed version                 |
| ----------------------------- | -------------------------------- |
| OpenCorvus                    | `0.0.0-v0.0.31beta-202608052008` |
| Ripgrep                       | `15.1.0`                         |
| OfficeCLI                     | `1.0.143`                        |
| Browser MCP Node.js           | `v22.23.1`                       |
| OpenCorvus process supervisor | `0.0.32-beta`                    |

Recursive binary discovery found and archive-verified 23 native binaries in
each variant, including the five entrypoints and colocated `.node`, `.dll`,
Sharp/libvips, Parcel watcher, Node PTY, screenshot, and `OpenConsole.exe`
dependencies.

| Archive                                                           |       Bytes | SHA-256                                                            |
| ----------------------------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| `packages/opencorvus/dist/opencorvus-windows-x64.tar.gz`          | 155,786,280 | `6606bbe96bf19d7abe1bc61e0cb5427f1869c897958ffafe3c855e995515e874` |
| `packages/opencorvus/dist/opencorvus-windows-x64-baseline.tar.gz` | 155,786,184 | `cf8a577902ab2a1b4cd2c4f1be6f54f416b51fdf5b16ef72da5f62ab88d268c1` |

### POSIX packaging contract

On a real Windows Subsystem for Linux 2 (WSL2) Linux 6.6 environment, the same
four Linux entrypoint paths were normalized, archived, and listed as:

```text
-rwxr-xr-x ./opencorvus
-rwxr-xr-x ./bin/rg
-rwxr-xr-x ./bin/officecli
-rwxr-xr-x ./browser-mcp-node/node
```

The production packager additionally applies and verifies this mode for every
recursively discovered ELF, Mach-O, native module, shared library, and helper
binary. A Linux/macOS release archive was not cross-built on the Windows host;
the source contract, positive discovery test, real WSL2 tar-mode verification,
and Windows full-closure archives are the current platform evidence. macOS
code-signing remains an on-target release action and uses the same discovered
closure.

### Automated checks

```text
27 pass, 0 fail — Office Artifact capability/runtime, native packaging,
                   Linux packaging, and built-in Skill positive contracts
1 pass, 0 fail  — real OfficeCLI PPTX integration
2 pass, 0 fail  — historical documentation index contracts
typecheck       — passed
docs:check      — passed (311 operations, 24 groups)
```

No UI automated test or negative test was added or run. The generated built-in
Skill payload was regenerated from the canonical Skill directory after final
formatting.

## Forward boundary

This change completes the platform consolidation and the qualified PPTX
phase-one implementation. It intentionally does not claim DOCX/XLSX authoring,
existing-file editing, template round-tripping, macro/object preservation, or
Microsoft Office pixel fidelity. Those capabilities must be added to this same
harness only after corpus-based qualification; they must not create parallel
format Skills, serializers, or runtime frameworks.
