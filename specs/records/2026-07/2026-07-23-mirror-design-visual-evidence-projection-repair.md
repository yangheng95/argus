# Mirror Design Visual Evidence Projection Repair

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | Determine whether the old sidecar caused the failed Spaces visual acceptance, repair the actual defect first, then restart the sidecar and resume the Task. |
| Acceptance | `mirror-design-visual-reviewer` receives the three formal Browser Preview comparison and geometry tools plus one package-owned immutable reference publisher through the active package projection; the exact accepted primary PNG becomes a TaskArtifact ref before comparison; its prompt requires durable `browser_preview_evidence:<evidenceID>` comparison evidence instead of treating an interactive `art_*` artifact as formal evidence; focused package, resolver, generated-payload, document, build, and live-task checks pass. |
| Hard constraints | Preserve `PromptProfileResolver` as the only runtime projection owner. Do not weaken the durable evidence-ref schema, add a fallback, accept `art_*` as a second evidence namespace, or add a host gate. Restart the running OpenCorvus sidecar only after the repair is verified, as explicitly authorized by the user. |
| Incident evidence | Task `tsk_f8df625af0014tnIdqKQd18F1M` rendered the Spaces design successfully with zero product findings at 1440, 1024, and 768 widths. `register_visual_qa_evidence` rejected `art_f8e4a68490018f5j4RpfiUrF2Z` because it was not a durable evidence ref, and the final report recorded `accepted=false` only for `blocker-formal-reference-evidence-registration`. The first repaired reviewer session proved all three formal tools were projected and successfully registered `browser_preview_layout_geometry` evidence, but could not call the two source-comparison tools because the accepted primary screenshot was still exposed only as a mutable project path and AttachmentStore URL rather than the required immutable TaskArtifact ref. |
| Runtime evidence | The running sidecar was built at 2026-07-23 12:32 while the rebuilt artifact was produced at 15:48. Both binaries contain the formal comparison tool implementation, so the old process explains stale lifecycle display but not the package projection omission. |
| Read records | `specs/current/architecture/04-extensions.md`, `specs/records/2026-07/2026-07-22-renderable-html-visual-qa-scheduling.md`, `specs/records/2026-07/2026-07-22-mirror-prism-full-workflow-distillation.md`, and `specs/records/2026-07/2026-07-23-coordination-continuation-terminal-convergence.md`. |
| Full-repository search | `rg` covered `mirror-design-visual-reviewer`, `built_in_tool_ids`, `default_tool_refs`, `package_tool_refs`, `VISUAL_QA_EXPERT_DEFAULT_TOOL_IDS`, all three Browser Preview comparison/geometry tool IDs, `BrowserPreviewSourceImageArtifactRef`, `TaskArtifactRefSchema`, `TaskArtifactSetResultSchema`, `named_artifacts.reference_image`, `prepare-source-context`, `publish_interactive_artifact`, payload generation, package release/update routes, repository package tests, SDK tests, and historical documentation. Frontend Replica's package-owned immutable source-context publisher is the matching end-to-end precedent. |
| Independent feedback | None. The user did not request sub-agents; the primary agent performs the required second review. |

## Causal chain

1. The rendered page, responsive desktop widths, interactions, accessibility states, console, request, and HTTP diagnostics passed.
2. Mirror Design required formal reference parity, but its visual reviewer projection declared no default Browser Preview comparison tools.
3. The reviewer improvised a `publish_interactive_artifact` document and passed the returned `art_*` identity to `register_visual_qa_evidence`.
4. The evidence schema correctly rejected that message artifact identity because only durable OpenCorvus evidence namespaces and AttachmentStore URLs are portable report refs.
5. The reviewer therefore submitted a truthful non-accepted report despite zero product findings.
6. The first repair exposed the comparison tools and proved the geometry evidence path, but comparison still could not start because both comparison schemas require an exact PNG `TaskArtifactRef`.
7. Mirror Design's existing `reference_artifacts` and material manifest retained the source only as a project path and AttachmentStore URL, so the reviewer had no legal way to construct the required immutable ref.
8. The package must therefore publish the explicitly selected primary PNG into the existing task-artifact store and pass that exact returned ref to both comparison tools. Widening the comparison schema or accepting `art_*` would create a second evidence source and is rejected.

## Exhaustive call-point disposition

| Surface | Disposition |
| --- | --- |
| `expert-squads/mirror/mirror-design/expert-squad.jsonc` visual reviewer projection | Add the exact `default/tool/browser_preview_compare_reference_regions`, `default/tool/browser_preview_compare_scroll_slices`, and `default/tool/browser_preview_layout_geometry` refs and bump the package version. |
| Mirror Design visual reviewer prompt | Require formal source comparisons to use the projected comparison tools and cite their returned `browser_preview_evidence:<evidenceID>` refs. Explicitly state that `publish_interactive_artifact` is not formal comparison evidence. |
| Mirror Design package tool `prepare-visual-reference` | Add one Visual Reviewer-owned tool that accepts exactly one project-relative PNG path, verifies containment and PNG bytes, publishes a two-file immutable TaskArtifact set, and returns `named_artifacts.reference_image` for the existing comparison schemas. |
| Mirror Design workflow source-parity reference | Preserve the same evidence protocol in the role contract read by scheduler and workers. |
| `VISUAL_QA_EXPERT_DEFAULT_TOOL_IDS` and Browser Preview tool implementations | Retain unchanged. They already define the correct host implementations and package-projectable tool IDs. |
| `PromptProfileResolver` | Retain unchanged. It already resolves declared `default_tool_refs` and projects them into the worker tool surface. |
| Durable evidence-ref validation | Retain unchanged. Rejecting bare `art_*` identities is correct and prevents non-portable report evidence. |
| `frontend-replica-visual-reviewer` | Retain unchanged as the established projection precedent. |
| Mirror package tests | Assert the exact declared refs, resolved worker capability, projected tool names, prompt contract, updated version, real TaskArtifact publication, immutable byte identity, and path/media rejection. |
| Generated expert-squad payload | Regenerate from the staged Git-index source so packaged OpenCorvus releases the repaired Mirror Design package. |
| Installed prism package | Replace through the existing exact package update/install path after the rebuilt sidecar is active; do not hand-copy a second package source. |

## Verification plan

1. Run the focused Mirror squad package and repository projection tests.
2. Run generated payload freshness and package-manager release/update coverage.
3. Run historical link and document-health tests after indexing this record.
4. Run typecheck, API route check, and docs check.
5. Review the staged diff for unrelated files and ensure the generated payload matches the staged package source.
6. Commit with the required `dsw-33987` prefix and push `v0.0.16beta` to `myhexin`.
7. Restart the explicitly authorized OpenCorvus process from the repaired application, update the installed `mirror-design` package through the product route, and verify the resumed visual reviewer publishes the primary PNG, calls the formal comparison tools, and produces terminal durable evidence.

## Implementation

- Mirror Design version `2026.07.23.4` projects the three existing host comparison/geometry tools only to `mirror-design-visual-reviewer`.
- The reviewer overlay and package-owned source-parity reference require durable `browser_preview_evidence:<evidenceID>` refs and explicitly keep `art_*` interactive artifacts outside formal comparison evidence.
- Live retry then proved a second transport break: the primary screenshot had no immutable TaskArtifact identity. Mirror Design version `2026.07.23.5` therefore projects `mirror-design/shared/prepare-visual-reference` only to the Visual Reviewer.
- `prepare-visual-reference` validates the explicitly selected project-relative PNG, publishes its exact bytes and provenance manifest through the existing TaskArtifactStore, and returns `named_artifacts.reference_image`. Both formal comparison tools consume that exact ref without widening their schemas.
- The generated Expert Squad payload was regenerated from the staged authoring source.
- Visual QA projection coverage now resolves the real Mirror Design package through `PromptProfileResolver`, projects the runtime tool surface, and asserts all three tools are present.
- Mirror package coverage asserts the exact manifest refs, prompt contract, package version, real TaskArtifact publication, comparison-schema compatibility, and byte immutability after source mutation.

## Verification

- Focused Visual QA and Mirror package tests: 8 passed, 318 assertions.
- Second-layer focused package, projection, and payload tests: 19 passed, 442 assertions.
- Repository dynamic-package projection: 10 passed, 1,422 assertions; the expected package-tool inventory now includes the new Mirror Design tool.
- The package-manager cleanup-failure test that was terminated by the earlier concurrent full suite passed alone; its failure was test-process contention rather than this change.
- Expert Squad payload, repository projection, package manager, Visual QA, Mirror package, historical-link, and document-health suites passed after the new record was staged. The only earlier failure was the expected document-health rejection while this newly indexed record was still untracked.
- Historical-link and document-health rerun: 82 passed, 1,367 assertions.
- `bun run typecheck`: 9 applicable package tasks passed.
- `bun run api:routes-check`: 6 rules passed across 32 files.
- `bun run docs:check`: 290 operations across 24 groups passed.
- `bun run package:gui-installer-matrix`: native `darwin-arm64` GUI package and release-asset validation passed; non-native rows were correctly skipped.
- Packaged overlay: 161,712,272 bytes, SHA-256 `6c5332832556c648bb46c5f0d9db852cf9e334ef0d2401410196c1be77625525`.
- DMG: 154,024,871 bytes, SHA-256 `f4e857fbd7d80247d702f45972a611850581f4f49aec25e5ea902720b00b3473`.
- Application archive: 153,312,755 bytes, SHA-256 `6060b572b86523f159092f2eb954dab7300096c5c56ed823ac85cdb7a7f155c8`.
