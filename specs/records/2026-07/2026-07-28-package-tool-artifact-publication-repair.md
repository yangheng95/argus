# Package-tool Artifact publication repair

Status: Completed
Date: 2026-07-28
Owner: Codex

## Recall

### User request

The user reported that the Watch integration was broken because the Mirror
Watch persona authority could not be read, then asked to repair every mentioned
problem, including equivalent defects in other Expert Squads and the SDK/Skill
authoring contract.

### Acceptance criteria

1. `tanzeqi/mirror-watch/shared/personas` publishes one exact, durable
   `mirror-watch/persona-authority` Engine Artifact and returns only a compact
   receipt.
2. The authority preserves the exact ordered 105-person source cohort, validates
   its required raw fields and unique identities, and binds the source bytes
   with a SHA-256 digest.
3. A Task may select any exact nonempty subset of that authority. Planning,
   persona voting, and aggregation preserve its exact count and identities; the
   reported cohort is not silently enlarged to all 105 personas. The failed
   Watch Mission's explicit eight-person scope is an executable regression.
4. The Mirror Watch Orchestrator is the sole persona publisher. Requirements
   and Architecture consumers discover, fully read, and select that Artifact
   instead of calling the package tool again.
5. `tanzeqi/mirror-watch/report/aggregate` publishes its canonical aggregation
   as a typed Engine Artifact, snapshots its generated HTML report as an
   immutable Task Artifact resource, records the selected upstream Artifact
   locators, consumes the exact persona authority envelope rather than
   rereading the package asset, and returns only a compact receipt.
6. `builtin/frontend-innovate/shared/materialize-figma-resources` publishes one
   immutable Task Artifact snapshot containing the PNG, node context, and
   stable manifest. It returns the typed snapshot locator, never private
   runtime paths.
7. Ordinary package-tool string returns remain ordinary tool output. The Host
   does not infer Artifact type, schema, resources, or provenance and does not
   auto-publish.
8. Package-tool `ToolContext` exposes only capabilities that work: package
   metadata reaches model-facing tool metadata under the isolated
   `package_metadata` namespace, Host lifecycle/provenance fields remain
   unforgeable, and the unusable `ask` surface is removed.
9. The SDK, built-in authoring Skill, docs, and portable template explicitly
   teach package code to call `context.host.engineArtifacts.publish(...)` and
   state that returning JSON does not publish an Artifact.
10. Real projected-package tests exercise package tool to Catalog publication,
    exact multi-page read, selection, immutable resource bytes, trusted
    producer provenance, and negative no-publication paths.
11. Generated built-in payload and portable template artifacts match their
    canonical generators, the installed Watch package is synchronized, and
    the repository change is committed and pushed to `legacy-remote`.

### Hard constraints

- Do not add a Host gate, automatic publisher, fallback, compatibility alias,
  duplicate domain projector, or state machine.
- Preserve the Engine Artifact Catalog and Task Artifact store as their
  existing single sources. Package tools must opt in through their typed Host
  interfaces.
- Do not restart, refresh, terminate, or otherwise disturb the running
  OpenCorvus or Overlay processes.
- Do not reset, stash, restore, clean, or create a worktree. Preserve all
  unrelated shared-worktree changes and stage only task-owned content.
- Do not convert ordinary lookup, search, test-runner, or adapter tools into
  durable publishers merely because they return JSON.
- Every changed behavior requires executable regression coverage.

### Materials read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
- `specs/records/2026-07/2026-07-27-projected-worker-task-artifact-publication.md`
- `specs/records/2026-07/2026-07-27-packaged-package-tool-zod-ownership.md`
- `packages/plugin/src/{artifact-catalog,task-artifact,tool}.ts`
- `packages/opencorvus/src/artifact-catalog/index.ts`
- `packages/opencorvus/src/tool/plugin-tool-host.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- every repository Expert Squad manifest, package tool, Agent prompt, README,
  selector, and relevant package test
- the generated built-in payload and portable Expert Squad template generator
- the installed Mirror Watch package and failed Watch Task/session evidence

### Full-repository call-point inventory

The repository-wide search found thirteen package-tool implementations. This
table is the disposition for every call point; no same-purpose tool is omitted.

| Package tool                                           | Current responsibility                           | Disposition                                                                               |
| ------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `mirror-watch/shared/personas`                         | package-owned 105-person authority               | Fix: explicit typed Engine Artifact publication                                           |
| `mirror-watch/report/aggregate`                        | canonical aggregation plus generated HTML report | Fix: explicit Engine Artifact publication plus immutable report resource                  |
| `frontend-innovate/shared/materialize-figma-resources` | Figma PNG and node-context materialization       | Fix: publish one Task Artifact snapshot and return its locator                            |
| `mirror/prism/shared/prepare-visual-reference`         | immutable visual-reference snapshot              | Preserve: already uses the typed Task Artifact publisher                                  |
| `frontend-replica/shared/prepare-source-context`       | immutable source-context snapshot                | Preserve: already uses the typed Task Artifact publisher                                  |
| `frontend-replica/shared/generate-source-project`      | frontend-design adapter invocation               | Preserve ordinary output: the adapter owns publication                                    |
| `mirror/prism/shared/materialize-asset`                | asset file materialization                       | Preserve ordinary output: its worker performs the canonical snapshot/envelope publication |
| `mirror-watch/shared/ifind-search`                     | external research lookup                         | Preserve ordinary output                                                                  |
| `mirror/prism/shared/ifind-search`                     | external research lookup                         | Preserve ordinary output                                                                  |
| `wujiang/opentest/shared/protocol-engine`              | test protocol execution                          | Preserve ordinary output                                                                  |
| `wujiang/opentest/shared/runner`                       | test command execution                           | Preserve ordinary output                                                                  |
| `mirror/prism/shared/protocol-engine`                  | test protocol execution                          | Preserve ordinary output                                                                  |
| `mirror/prism/shared/runner`                           | test command execution                           | Preserve ordinary output                                                                  |

The same search found no production package tool calling
`context.host.engineArtifacts.publish`; only generic Host tests exercised that
capability. The resolver returned package strings directly, so package-owned
durable data was never made discoverable merely by returning it.

### Independent Agent feedback

Three independent read-only audits agreed on the causal boundary:

- the Watch asset is present, valid JSON, byte-identical between source and the
  installed package, and contains exactly 105 ordered personas;
- the failed Task executed the persona tool twice, stored both large ordinary
  outputs, and immediately found no persona Artifact in the Task Catalog;
- the Plugin Host already supports typed publication, chunked exact reads, and
  trusted producer provenance; automatic publication would incorrectly turn
  unrelated JSON-returning tools into durable authorities;
- Mirror Watch currently projects the persona tool to multiple Agents and asks
  both Orchestrator and Requirements to call it, which would create duplicate
  authorities after publication is repaired;
- Frontend Innovate promises Catalog-discoverable immutable Figma resources in
  its README and Agent prompt while its implementation and selector still
  return private runtime paths;
- package metadata is silently discarded and the public package `ask`
  capability always throws, so the public `ToolContext` does not match runtime
  behavior.

## Evidence and causal chain

1. The Mirror Watch source and installed `assets/personas.json` are identical:
   163,932 bytes, SHA-256
   `5a3970a833c6745e8021ed8bd07f7fd9484c5d4bd0d3a78a40f8e91908b35713`,
   105 records, first UID `user-0554`, last UID `user-9605`.
2. The failed Watch Task executed the persona provider twice. Each call wrote
   the full JSON to ordinary tool-output storage, but subsequent exact persona
   Artifact searches returned zero results.
3. `packageToolFromDefinition` treats the returned string as model-facing
   output and truncates large values when necessary. It never calls the Engine
   Artifact publisher.
4. `PluginToolHost.engineArtifacts.publish` creates the durable Catalog row only
   when package code calls it explicitly; this is the correct semantic
   boundary because the package alone owns artifact type, version, schema,
   resources, and selected-source provenance.
5. Mirror Watch prompts called the returned persona body a durable authority
   even though no publisher existed. Frontend Innovate made the equivalent
   mistake for Figma resources. The authoring Skill, SDK docs, and portable
   template did not show the required explicit call and therefore reproduced
   the defect.
6. The immediate persona failure is therefore not a missing asset, malformed
   cohort, `artifact_read` failure, iFind failure, or Catalog storage failure.
   It is a producer-contract failure reinforced by contradictory package
   prompts and incomplete authoring guidance.
7. The failed Mission explicitly requested eight personas, while the package
   prompts and aggregator required every one of the 105 authority rows. Merely
   repairing publication would therefore expose the next deterministic
   failure. The authority and a Task-selected cohort are different concepts:
   the former stays complete, while the latter must preserve the exact
   nonempty subset accepted by planning.

## Implementation plan

1. Add one package-local Mirror Watch persona contract, keep package-asset
   access exclusive to its publisher, and make report aggregation consume the
   exact selected Catalog envelope through that contract.
2. Make the Orchestrator publish or resume the sole persona authority through
   natural Catalog discovery; make downstream Agents read/select it only and
   preserve the exact Task-selected nonempty cohort.
3. Extend report aggregation input with the exact selected source Artifact
   locators, snapshot the HTML, publish the aggregation envelope, and return a
   receipt.
4. Replace Frontend Innovate's runtime-path handoff with a typed Task Artifact
   snapshot locator and align all package prompts.
5. Make package `ToolContext` metadata observable, remove the unusable
   permission-request surface, and add type/runtime regression tests.
6. Correct the authoring Skill, SDK reference, docblock, and generated portable
   example; regenerate canonical payloads rather than editing generated output.
7. Run focused tests, repository package projection tests, typechecks,
   generator consistency, document health, full relevant checks, and an
   independent second review.
8. Synchronize the verified Mirror Watch package into the user's Watch project
   without touching its running process, then commit and push only this task's
   repository changes.

## Implemented result

1. Mirror Watch now has one strict package-local persona authority contract.
   Only the Orchestrator-owned publisher reads `assets/personas.json`; it
   validates all 105 ordered identities, hashes the source bytes, publishes one
   typed `mirror-watch/persona-authority` Engine Artifact, and returns a compact
   receipt.
2. Requirements and Architecture no longer project or call the publisher. They
   discover, completely read, and select the unique same-Task authority.
   Planning binds an exact nonempty Task cohort: named identities remain exact,
   a count-only request takes the first N immutable authority rows, and missing
   cohort scope is a visible blocker rather than an implicit 105-person run.
3. Aggregation now consumes the exact selected authority envelope and exact
   vote subset, verifies trusted Mirror Watch Orchestrator provenance, snapshots
   the generated HTML report, and publishes one typed
   `mirror-watch/aggregate-report` Engine Artifact with the immutable report
   resource and selected upstream locators. It has no package-asset fallback.
4. Frontend Innovate now snapshots its Figma node JSON, decoded PNG, and
   digest-bearing manifest through the Task Artifact Host and returns only the
   typed immutable snapshot locator. Private managed-runtime paths are no
   longer an inter-Agent contract.
5. Package result metadata is observable only below `package_metadata`.
   Trusted top-level provenance, truncation, output-path, and lifecycle fields
   cannot be forged. The public `ToolContext.ask` method that always failed was
   removed.
6. The SDK docblock, English and Chinese references, built-in authoring Skill,
   and portable template now distinguish three real contracts: the two Engine
   Artifact publication surfaces and the independent package
   `taskArtifacts.stage/publish` snapshot surface. They explicitly state that
   an ordinary returned string publishes nothing.
7. The real projected-package fixture can preserve one physical Turn, execute
   the actual projected Tool Registry surface, persist binary attachments, and
   reuse an existing Task/session. It does not replace Artifact tools with
   canned fixtures.
8. The verified Mirror Watch source package was copied byte-for-byte to
   `/Users/yangheng/Documents/OpenCorvus-Demos/watch/.opencorvus/expert-squads/tanzeqi/mirror-watch`.
   Existing destination files matched repository `HEAD` before replacement;
   no user package edits were overwritten and no running process was restarted
   or refreshed.

## Independent review resolution

The second reviewer found no P0 or P1 defect. It found one P2 documentation
ambiguity: prose called all Artifact publication a two-surface contract while
also documenting package Task Artifact snapshots. The authoring Skill, SDK
references, SDK docblock, and portable generator now limit the two surfaces to
Engine Artifacts and separately name `taskArtifacts.stage/publish` plus its
typed snapshot locator. Generated outputs were refreshed and their freshness
tests rerun after the correction.

## Verification

- Mirror Watch package, input, architect-plan, and running-state suites:
  18 passed, 0 failed, 664 assertions. This includes a real projected
  eight-person run whose authority remains 105 while its aggregate receipt and
  payload remain exactly eight.
- Frontend Innovate Figma materializer and dynamic resolver suites: 39 passed,
  0 failed, 263 assertions. The same-Task scheduler-to-worker path performs
  queryless Catalog discovery, multi-page exact read, selection, and binary
  attachment verification; acquisition failures leave zero Catalog rows and
  no staging residue.
- Portable template, resolver, payload freshness, repository package, and
  built-in Skill freshness suites: 60 passed, 0 failed, 2,354 assertions.
- Plugin Artifact contract and SDK repository calibration suites: 33 passed,
  0 failed, 533 assertions.
- Plugin, JavaScript SDK, and OpenCorvus typechecks passed. Web `astro check`
  completed with zero errors. `docs:check`, `api:routes-check`,
  `historical-docs-links.test.ts`, and `git diff --check` passed.
- After this record was staged, `document-health.test.ts` passed all 62
  task-independent checks and failed only the shared worktree's README link to
  the unrelated, untracked
  `2026-07-28-architect-selection-cancellation-attribution-repair.md`. This
  task's record is tracked correctly; the remaining concurrent record is
  outside this change set.
