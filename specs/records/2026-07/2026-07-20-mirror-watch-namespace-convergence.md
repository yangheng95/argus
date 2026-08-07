# MirrorWatch namespace convergence

## Recall

| Item | Evidence |
| --- | --- |
| User request | “mirror watch的用户空间名字还有myhexin残留” |
| Acceptance | MirrorWatch has one canonical package location and manifest namespace, `tanzeqi/mirror-watch`; its stable active profile identity remains `mirror-watch`; every catalog, embedded payload, package test and install target derives the new namespace; no MirrorWatch-owned user-space surface or package path retains the old `myhexin` namespace. |
| Hard constraints | Replace the old namespace directly; do not add an alias, fallback lookup, duplicate package, compatibility migration, second identity field, or UI-only filter. Preserve unrelated `myhexin` hostnames, git-cc remote names, external repository paths and other packages. Preserve the untracked `C:/` entry. Do not restart or refresh the running OpenCorvus/Overlay. Use Node-launched isolated browser verification for the desktop catalog surface. Commit subjects use `dsw-33987` and push `v0.0.11beta` to `myhexin`. |
| Sources read | `AGENTS.md`; browser-control skill; `specs/current/architecture/04-extensions.md`; `2026-07-20-mirror-watch-display-and-card-reasoning-retirement.md`; MirrorWatch README/manifest; payload generator; Registry/package manager; focused package and browser tests. |
| Whole-repository search | Exact searches covered `myhexin/mirror-watch`, MirrorWatch manifest `namespace`, package-root imports, install fixtures, embedded payload declarations, expected payload inventory and lifecycle target roots. Broad `myhexin` results were classified so provider URLs, git remotes, Windows workspace paths, unrelated records and other product identities are not rewritten. |
| Independent agent feedback | None. The user did not request independent agents, and the active delegation policy prohibits implicit spawning. |

## Root cause and decision

The previous display-only repair intentionally retained the canonical namespace `myhexin`, so `catalog-profile.ts` could show `TanZeqi/MirrorWatch` while package provenance, target roots and diagnostic identities still exposed `myhexin/mirror-watch`. The user has now rejected that split. The correct single-source repair is to move the package to `.opencorvus/expert-squads/tanzeqi/mirror-watch`, change the manifest namespace to `tanzeqi`, and regenerate the embedded payload. The manifest `id=mirror-watch` remains the only active expert-squad identity; namespace is provenance/install partition, not a second active ID.

This is a direct beta-line replacement. The old directory is removed rather than retained as a compatibility package. Existing external installations under the old namespace are not silently migrated or guessed; the strict package lifecycle continues to require one manifest ID in one canonical namespace.

## Call-point disposition

| Call point | Disposition |
| --- | --- |
| `.opencorvus/expert-squads/myhexin/mirror-watch/**` | Move the complete immutable package closure to `.opencorvus/expert-squads/tanzeqi/mirror-watch/**`; change only namespace-owned content. |
| MirrorWatch `expert-squad.jsonc` | Replace `namespace: "myhexin"` with `namespace: "tanzeqi"`; preserve `id: "mirror-watch"`, label and capability refs. |
| `packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts` | Point imports, package roots, install fixtures and namespace assertions at `tanzeqi`; add negative assertions proving the old namespace is absent from MirrorWatch identity and embedded payload. |
| `packages/opencorvus/test/expert-squad/package-manager.test.ts` | Replace the expected payload inventory row with `tanzeqi/mirror-watch`; preserve generic namespace-driven lifecycle behavior. |
| `packages/opencorvus/src/expert-squad/payload.ts` | Regenerate from repository packages through `generate-expert-squad-payload.ts`; never edit by hand. |
| Overlay catalog fixture/visual acceptance | Render canonical MirrorWatch catalog data with namespace `tanzeqi`, inspect a desktop screenshot, and assert no visible MirrorWatch row/details contain `myhexin`. |
| Historical display record | Preserve as history; this record explicitly supersedes its earlier “keep canonical namespace” decision. |
| Unrelated `myhexin` values | Keep provider endpoints, git-cc remote name/URL, external workspace paths, unrelated specs/packages and lifecycle test dummy paths unless they specifically model MirrorWatch canonical provenance. |

## Verification plan

1. Regenerate the expert-squad payload and run focused payload, Registry, package-manager and MirrorWatch package tests.
2. Run the focused Overlay expert-squad service/browser tests affected by the namespace fixture.
3. Launch the isolated desktop catalog fixture with Node, capture a task-scoped screenshot, inspect it at original resolution, and prove the MirrorWatch row/details show `TanZeqi/MirrorWatch` / `tanzeqi` without `myhexin` residue.
4. Run historical-doc links and relevant document-health/type checks, repeat the exact namespace grep, inspect the final diff, and perform a second review.
5. Commit the implementation with the required prefix, fetch/merge any new remote work without overwriting unrelated changes, push through hooks, and verify local/remote convergence.

## Verification results

- The complete 181-file MirrorWatch package closure moved from `myhexin/mirror-watch` to `tanzeqi/mirror-watch`; the manifest now declares `namespace=tanzeqi`, retains `id=mirror-watch`, and advances to version `2026.07.20.1`. No alias or second package remains.
- The generated payload, MirrorWatch imports/install fixtures, package inventory and Overlay lifecycle fixture all use the new namespace. Exact current-source scans excluding ignored runtime history report no `myhexin/mirror-watch`, `expert-squads/myhexin/mirror-watch`, or MirrorWatch `namespace=myhexin` occurrence.
- The focused backend/Overlay suite passed: 90 tests passed and one intentionally isolated package-manager case was skipped by its normal harness. Payload generation equality, Registry/Resolver isolation, package tools, package-manager lifecycle and Overlay service contracts all passed. OpenCorvus and Overlay TypeScript checks passed.
- The Node-launched browser suite passed 4/4 after correcting one test assertion to inspect the actual Market row that renders namespace rather than the namespace-free detail body. Original-resolution 1902×1314 screenshots were inspected for both uninstalled and installed states; the row visibly reads `MirrorWatch` and `tanzeqi/mirror-watch · 2026.07.20.1`, without clipping, layout drift, or `myhexin` namespace residue.
- Historical-doc links and document-health tests passed 82/82. The only package-content `myhexin` strings left are external provider/design-system HTTPS hostnames; ignored `.opencorvus/.r/**` mission/trace history also preserves prior evidence and was deliberately not rewritten or deleted.

## Merge integration Recall

The ordinary merge of `myhexin/v0.0.11beta` at `9e7ff42e0f6bad3763900dcda51b55c496056bea` exposed a rename/rename
conflict between the later tracked authoring-root correction and this namespace correction. The merge base owns 181
files at `.opencorvus/expert-squads/myhexin/mirror-watch`; local HEAD moves and updates that closure at
`expert-squads/myhexin/mirror-watch`; the remote branch moves the base closure to the runtime installation root
`.opencorvus/expert-squads/tanzeqi/mirror-watch`. Whole-repository and three-tree searches covered all unmerged paths,
manifest identities, package imports, authoring-root inventory, generated payload entries, package-manager expectations,
Overlay fixtures, current architecture references, and Specs indexes.

Independent read-only review found the two sides contain the same 181-path inventory: 150 blobs are identical and 31
local blobs contain later authoring/package corrections. The remote package has no content change beyond
`namespace: "tanzeqi"` and `version: "2026.07.20.1"`. The only valid composition is therefore one tracked authoring
package at `expert-squads/tanzeqi/mirror-watch`: retain the complete local content, adopt the remote namespace/version,
and remove every tracked `.opencorvus/expert-squads/{myhexin,tanzeqi}/mirror-watch` path. Tests must import the tracked
authoring package and install it explicitly into the project-scoped `tanzeqi` runtime partition. The generated payload
must be regenerated from that final authoring tree; it must not be hand-merged. This preserves the namespace decision
without restoring the retired runtime root as a second authoring source.

The first post-merge package-manager matrix then rejected raw-source/payload byte equality for the moved package while
the generator freshness test remained green. Byte inventory found exactly twenty Markdown authoring files with one
residual carriage-return byte each at the final newline; binary files were excluded from text normalization. The
generator correctly canonicalizes UTF-8 line endings to line-feed bytes, so preserving those raw carriage returns would
leave authoring and embedded payload as two byte authorities. The authoring files must be mechanically normalized to
line-feed endings, the payload regenerated, affected immutable Skill closure hashes recomputed by the real Registry,
and both freshness and package-manager byte-parity tests rerun. The equality assertion remains strict.
