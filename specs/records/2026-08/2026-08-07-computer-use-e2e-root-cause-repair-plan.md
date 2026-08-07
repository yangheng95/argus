# Computer Use End-to-End Root-Cause Repair Plan

Date: 2026-08-07
Status: Phases 1–4 and host-owned viewer launch authority implemented; takeover/return, licensed Site Bundle, and real Windows Luna acceptance pending
Owner: Codex

## Recall

### User requirements

- Thoroughly investigate why the requested `openai/gpt-5.6-luna` Computer Use test generated an Expert Squad instead of testing Computer Use, and provide the root-cause repair plan.
- Keep Computer Use available in direct non-Mission Chat/Work interaction. Expert Squads may use it only when their active Harness explicitly projects the platform Computer tools; Computer Use itself is not an Expert Squad.
- Make the integration self-contained, preserve correct permissions, and publish a backend end-to-end acceptance task only after the real runtime path is executable.
- Have three independent Agents cross-review the design until they reach consensus.

### Acceptance criteria

1. A direct Work Session using `openai/gpt-5.6-luna` can discover the exact Computer MCP tools, create one isolated Windows Computer, observe it, perform observation-bound input, observe the result, and destroy it through visible Tool Parts.
2. `capability_search` has one complete catalog owner for configured and projected MCP capabilities. Duplicate publishers fail closed instead of being merged.
3. `tool` and `mcp_tool` remain distinct canonical kinds. A caller can search all executable capabilities through an exact owner-kind filter or by omitting kind, without a hidden alias or fallback.
4. Each Conversation Session owns its own Computer connection and controller. No Computer process, observation authority, credential, or cleanup lifetime is shared merely because two Sessions both use Work.
5. Every observation authorizes at most one action. The authority is consumed atomically before backend dispatch, and every subsequent action requires a new observation.
6. Any dispatched side-effect operation whose response is lost returns `COMPUTER_OUTCOME_UNKNOWN`; it is never retried, replayed, or silently reconnected.
7. Permission evaluation uses the exact eight Computer tool identifiers and the four canonical permissions. User/session `ask` and `deny` rules remain authoritative over the baseline allow policy.
8. The application launches only one immutable, hash-verified, locally provisioned Virtual Machine (VM) bundle through a narrow no-retry adapter. It never selects cloud execution, a host-desktop driver, a system Python, a `PATH` executable, or a second runtime.
9. Human takeover uses a host-owned authenticated native viewer surface. No viewer command, executable path, locator credential, or secret is emitted to the model or persisted in ordinary Tool output.
10. Production acceptance requires a real licensed Windows guest, real Luna execution on the managed backend, visible screenshots, manual viewer/takeover review, and preserved backend evidence. Synthetic contracts are not end-to-end acceptance.

### Hard constraints

- No fallback, compatibility alias, generic duplicate-source merger, process retry, action replay, host-side workflow gate, state machine, hidden message, or second capability authority.
- No Browser WebView, query override, temporary inline frame, or host desktop as the Computer runtime or viewer.
- No User Interface (UI) automated tests or automated visual assertions. UI acceptance is real-page interaction, screenshots, and personal visual review.
- No negative tests. Tests assert complete current outputs, exact typed errors, and positive data/permission/lifecycle contracts.
- No redistribution of a derived Windows image unless the deployment has explicit licensing rights.

### Material read and evidence inspected

- `specs/records/2026-08/2026-08-06-computer-use-vm-runtime-integration-design.md`
- `specs/records/2026-08/2026-08-06-computer-use-runtime-implementation-plan.md`
- `specs/current/architecture/04-extensions.md`, `05-config.md`, and `99-principles.md`
- capability catalog, fuzzy search, Conversation capability, Computer controller/backend/bundle verifier, permission binding, MCP materialization, and Session loop implementation and tests
- durable Session and Tool-Part evidence from the incorrect Squad generation and the first direct Luna Work run
- an isolated source-backend diagnostic run with an ephemeral database
- pinned upstream CUA source at commit `bb8efbfe6caadbccba54221096d959607ed9f574`, its Sandbox and Computer server metadata, transport behavior, and current official local-image guidance
- Microsoft Windows 11 licensing and evaluation distribution guidance

### Whole-repository search result

Repository-wide searches covered `capability_search`, `CapabilityKind`, `mcp-config`, `runtimeSnapshot`, MCP connection owners, `latestObservation`, action dispatch, `COMPUTER_OUTCOME_UNKNOWN`, permission lookup, viewer output, bundle manifest verification, CUA launch, Computer assignments, and Expert Squad projection. They established that the failure spans four ownership boundaries rather than one fuzzy-scoring defect: catalog publication, prompt/schema search semantics, Session-scoped execution authority, and deployable runtime closure.

### Independent Agent feedback and consensus

Architecture, adversarial, and ecosystem reviewers independently reviewed the same evidence and then cross-reviewed the combined proposal. All three conditionally accepted one repair direction. Their common conditions are: remove generic source consolidation; publish MCP catalog data once; keep `tool` and `mcp_tool` exact; add cross-kind callable search metadata; derive coherent availability from effective assignment; scope Computer ownership to the Conversation Session; consume observations atomically; classify lost create/input/destroy responses as unknown outcomes; remove model-visible viewer commands; use a pinned local no-retry VM bundle; and require a real Luna/Windows/manual-visual acceptance run. No reviewer retained a competing architecture.

### Continuation Recall — takeover/return and final acceptance

- The 2026-08-07 continuation starts from exact commit `9bd2c03408a650e34acff61aba082a7a38ae3d1c`; a fresh `git fetch git-cc v0.0.33beta` confirmed the remote still points to that commit before new edits.
- The original `D:\myhexin-local\opencorvus` checkout contains unrelated Zapier MCP, config, Overlay, test, and spec changes. They are outside this task and remain untouched. Implementation continues only in the user-authorized detached worktree `D:\myhexin-local\opencorvus\.scratch\computer-lifecycle-e2e`.
- The remaining lifecycle failure is now proven by the complete close chain: `ConversationCapability.disposeRuntimeMcp()` closes the Session `ScopedConnectionOwner`; `MCP.createScopedConnectionOwner().close()` closes the stdio MCP connection and process; `ComputerMCP.serveStdio()` calls `ComputerController.close()`; `ComputerController.close()` calls `JsonLineComputerBackend.close()`; and backend cleanup terminates the provisioned launcher and removes the host-owned workspace. Closing only one call in that chain would leave an orphan process and is not an acceptable repair.
- Repository-wide continuation searches covered every `runtimeMcpTools`, `runtimeMcpOwnerIdentity`, `disposeRuntimeMcp`, `ComputerMCPBuiltin.withRuntimeScope`, Computer controller/backend close, Computer viewer route, Session deletion cleanup, Orchestrator/Worker scoped owner, generated OpenAPI/SDK surface, Overlay native surface bridge, and Tauri command registration call point.
- The selected continuation architecture keeps one host runtime authority per exact Computer runtime scope. The host authority owns the verified launcher, VM identity, workspace, viewer descriptor, and terminal destruction. A scoped MCP adapter receives only one revocable run capability over authenticated loopback IPC (Inter-Process Communication); adapter disconnect or takeover revokes that run without destroying the VM. Return issues a new run capability, creates a new MCP owner/adapter, and has no reusable observation record. This adds no model-visible tool, message, Browser surface, file polling, runtime fallback, or second lifecycle owner.
- Native takeover/return remains a dedicated Computer UI surface backed by host routes. Its UI is accepted only through a real Overlay launch, manual interaction, screenshots, and personal visual review; no UI test, fixture, screenshot baseline, or automated visual assertion may be created, modified, or run.
- No new independent Agent was requested for this continuation. The prior three-Agent consensus remains the applicable architecture review input; the final implementation still requires an independent second code review before commit.
- Final acceptance remains unchanged: a licensed, content-addressed, provisioned Windows Site Bundle must exist before the real `openai/gpt-5.6-luna` boot → observe → input → observe → viewer → takeover → return → destroy run and concurrent second-Session isolation run can be called complete. Absence of that licensed artifact is a truthful external blocker, not authorization for a synthetic substitute.

## Observed evidence

| Observation                                                                                                             | Direct evidence                                                                                                                                          | Meaning                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first task authored `Author Computer Harness E2E Squad` and ran `squad-sdk`.                                        | Durable Task `tsk_fd9c2707c0017XOZ57GMv9UD5a`; the task was cancelled.                                                                                   | The dispatch input changed the requested direct Computer test into package authoring before Luna could exercise Computer Use. This is a caller/dispatch error, not a reason to model Computer as a Squad. |
| The first correct direct Work run mounted all eight Computer provider tools.                                            | Durable Session `ses_02634624affeg6EJ3gUpP5yqcm`, model `openai/gpt-5.6-luna`.                                                                           | Direct non-Mission projection exists and is the right execution surface.                                                                                                                                  |
| Luna's first discovery call failed before returning a catalog.                                                          | `capability_search` used `query: "computer use virtual desktop"`, `kinds: ["tool"]`; result: `Capability catalog contains duplicate owner "mcp-config".` | Two `mcp-config` fragments violate the catalog's unique-owner contract.                                                                                                                                   |
| After temporary generic source consolidation, catalog creation succeeded but filtered discovery still omitted Computer. | Isolated Session `ses_0262a3a55ffeuq1jTiHFp7bLsV`; the harness had all eight Computer MCP refs, while results under `kinds:["tool"]` omitted them.       | Computer entries are canonically `mcp_tool`; exact kind filtering happens before fuzzy scoring. Generic merging masks one defect but does not fix search semantics.                                       |
| Luna could still call the already-mounted tool, then received `COMPUTER_RUNTIME_REQUIRED`.                              | The same isolated run called `computer_session_create`; config had no runtime bundle manifest.                                                           | Tool mounting is not a real runtime acceptance. The deployable VM closure is absent.                                                                                                                      |
| Targeted control-plane tests passed.                                                                                    | 11 tests passed across catalog, fuzzy search, and Computer MCP contract.                                                                                 | Existing tests do not traverse the real Conversation catalog publisher, real Luna call, real VM, viewer, or visual path; they are necessary but insufficient.                                             |

The isolated Session used an ephemeral database and runtime directory that were removed. It is diagnostic evidence only and must not be represented as durable production acceptance.

## Causal chain

1. The initial backend task was authored as an Expert Squad generation request, so the scheduler correctly selected `squad-sdk` and never reached the intended Computer execution path.
2. The corrected direct Work request reached Luna with the Computer tools mounted, but catalog construction aborted because `runtimeSnapshot()` published two sources with the same `mcp-config` owner.
3. Generic fragment consolidation removed the immediate exception while weakening the catalog invariant. Luna's explicit `kinds:["tool"]` then filtered out canonical `mcp_tool` entries before fuzzy scoring.
4. The mounted Computer tool bypassed the failed discovery only because it was already in the provider pool; actual creation then failed because no complete runtime bundle was configured.
5. Even with a bundle, current ownership, observation consumption, outcome classification, and viewer output would not yet satisfy isolation, exactly-once intent, or credential-boundary acceptance.

Therefore the surface symptom “fuzzy search cannot find the harness” is not the root cause. The correct repair must close all four layers in order: dispatch meaning, catalog/search authority, Session execution semantics, and self-contained runtime/viewer delivery.

## Root-cause repairs

### 1. Restore a single MCP catalog publisher

Delete `consolidateCapabilityCatalogSources()`. `createCapabilityCatalogSnapshot()` continues to reject duplicate owners. In the native Conversation path, one `mcp-config` publisher constructs one complete entry array containing configured MCP server entries plus the exact MCP tool entries visible through the active runtime projection, then calls `source()` once.

The publisher derives both server and tool availability from the same effective fact: global configuration plus explicit Chat/Work assignment or active Harness projection. An explicitly assigned disabled-by-default Computer server and its tools must not appear simultaneously as `denied` and `visible`.

### 2. Make cross-kind executable discovery explicit

Preserve the canonical kinds `tool` and `mcp_tool`. Improve the `CapabilitySearchInput` schema and tool description so the model is told that `tool` means a platform tool, `mcp_tool` means an MCP executable, and omitting `kinds` searches across kinds.

Add the orthogonal exact filter `next_owner_kinds`, including `call_tool`, so a model can request every executable capability without guessing storage kind. The expected Luna discovery call is a fuzzy query plus `next_owner_kinds:["call_tool"]`, or the same query with no `kinds`. This is catalog metadata, not a hidden expansion or workflow gate.

### 3. Scope execution ownership to Conversation Session

Replace the Computer MCP owner keyed only by Chat/Work Agent identity with an exact Conversation Session owner such as `conversation:<sessionID>:computer`. Pass that identity through `runtimeMcpTools` and connection acquisition.

Turns in the same Session reuse the same owner. Different Sessions receive distinct controller, backend process, Computer map, observation authority, and viewer registration. Session termination, explicit destroy, or takeover closes the exact owner and exposes cleanup failure as a typed visible result. A Session never silently changes runtime bundle after creation.

### 4. Make an observation an atomic single-use capability

Replace mutable `latestObservation` reuse with an immutable observation record keyed by Computer, display, observation identifier, digest, and dimensions. Validate the full identity and bounds, then synchronously remove the record before the first asynchronous backend call.

Success, backend-declared failure, transport loss, cancellation, and unknown outcome all consume the observation. Concurrent actions cannot both authorize against the same record. A new `observe` is required before every subsequent action.

### 5. Classify every side-effectful transport loss correctly

Replace the boolean `inputAction` distinction with operation-effect metadata: `read` for observe and `effect` for create, input, and destroy. If an effect request was dispatched and its response is lost through timeout, pipe failure, or process exit, return `COMPUTER_OUTCOME_UNKNOWN`. Pre-dispatch bundle validation remains a precise `REQUIRED`, `INVALID`, or launcher error.

The private adapter sends each effect once. It disables upstream runtime auto-selection, cloud/fleet routing, updater, telemetry, HTTP retry, reconnect replay, and generic transport fallback. Cleanup helpers may not swallow errors.

### 6. Tighten permission identity without adding a gate

Replace `startsWith("computer_")` with the exact set of eight runtime tool identifiers. Map them to `computer.session.create`, `computer.observe`, `computer.input`, and `computer.session.destroy`. Preserve the existing ordered permission evaluation in which later explicit user/session `ask` or `deny` rules override baseline allow.

Projected Expert Squad calls retain the same canonical Computer permission identity as direct Work calls. Harness projection grants visibility only; it does not grant permission or create a second execution path.

### 7. Separate model output from human viewer authority

Remove `viewer_command` and local executable paths from `session_create`. Return only canonical Computer/display identity and, if required by the native UI, a non-secret opaque `viewer_ref`.

A host-owned authenticated viewer registry resolves the actual locator and credentials by Conversation Session and Computer identity. The native Computer surface owns display and takeover; the Browser remains unrelated. During takeover the Agent connection is closed and no screenshot, attachment, or Large Language Model (LLM) input is produced. Returning control starts a new owner/run and begins with a new observation.

### 8. Deliver a real self-contained runtime in two licensed layers

OpenCorvus publishes a pinned Runtime Bundle Builder and verifier, not a redistributable Windows guest. The builder locks the upstream commit, adapter source, Python interpreter, wheel hashes, hypervisor, firmware, viewer, guest preparation recipe, network topology, Software Bill of Materials (SBOM), license inventory, build provenance, and signature/attestation inputs.

Each deployment builds a local Site Bundle from an authorized Windows International Organization for Standardization (ISO) image or Virtual Hard Disk v2 (VHDX). The final manifest exhaustively inventories every regular file by relative path, length, and SHA-256 (Secure Hash Algorithm 256-bit) digest; rejects symlinks, hard-link ambiguity, path escape, undeclared files, and mutable external dependencies; and identifies one fixed launcher and guest image. Provisioning verifies the bundle into an immutable content-addressed location before assignment. Bundle/session temporary files live under the bundle-managed runtime area rather than ambient host `TEMP`/`TMP`.

The VM has one host-only control channel distinct from its business network. Direct host CUA Driver execution is prohibited. Missing or invalid bundle configuration leaves Computer unavailable with a typed error; that is fail-closed deployment state, not a fallback.

## Implementation sequence

### Phase 0: preserve truthful evidence

- Keep the incorrect Squad task cancelled and label it as dispatch evidence, not Computer acceptance.
- Preserve the durable direct Luna failure Tool Part and record that the ephemeral isolated run was diagnostic only.
- Do not publish another backend acceptance task until Phases 1–4 provide an executable real runtime path.

### Phase 1: catalog and search contract

- Remove generic consolidation and create the single `mcp-config` publisher.
- Make availability coherent for disabled-by-default explicit assignment and Harness projection.
- Add `next_owner_kinds` and update search schema guidance.
- Replace synthetic `kind:"tool"` Computer fixtures with canonical `mcp_tool` entries and exercise the real Conversation snapshot/search path.

### Phase 2: Session ownership and lifecycle

- Introduce exact Session-scoped Computer owners and deterministic lifecycle cleanup.
- Bind controller, backend, observations, and viewer registry to that owner.
- Preserve one owner across turns in the same Session and require a new owner after takeover or terminal cleanup.

### Phase 3: action, outcome, and permission integrity

- Implement atomic single-use observations.
- Introduce read/effect transport metadata and unknown-outcome classification.
- Use the exact tool identifier set and prove permission precedence with complete positive outputs.

### Phase 4: builder, Site Bundle, and launcher

- Implement the pinned builder recipe, dependency locks, exhaustive manifest, content-addressed provisioning, SBOM/license/provenance output, and narrow private launcher.
- Build one licensed local Windows Site Bundle and qualify boot, screen capture, input, teardown, network separation, no-retry behavior, and cleanup reporting.

### Phase 5: native viewer and takeover

- Implement the host-owned authenticated viewer registry and dedicated native Computer surface.
- Remove model-visible commands and secrets.
- Manually exercise viewer open/close, takeover, return, focus/keyboard path, resize/display identity, and failure presentation; inspect and retain screenshots without creating UI test files or baselines.

### Phase 6: managed-backend Luna acceptance

- Assign Computer explicitly to a direct Work Session using `openai/gpt-5.6-luna`.
- Verify one coherent catalog snapshot and fuzzy discovery through `next_owner_kinds:["call_tool"]`.
- Run create → observe → one action → observe → destroy against the real Windows VM and preserve every visible Tool Part and Attachment.
- Inject post-dispatch transport loss separately for create, input, and destroy and verify typed unknown outcomes with no retry.
- Run a second independent Session concurrently and prove distinct runtime/controller/viewer ownership through positive owner and lifecycle facts.
- Publish the backend end-to-end acceptance task only after the complete sequence succeeds, then perform a separate human visual review of the native viewer evidence.

## Positive non-UI verification

- Real Conversation catalog output equals the complete configured/projected MCP entry set under one `mcp-config` source.
- Cross-kind `call_tool` search returns all eight exact Computer MCP entries with stable identities and availability.
- Explicit direct assignment and exact Harness projection each produce the same canonical Computer tool and permission identities.
- Two Conversation Sessions produce two distinct owners; multiple turns in one Session report the same owner.
- One observation plus one action produces one backend effect result and a consumed observation record; a second action returns the canonical typed stale/consumed result.
- Concurrent submissions against one observation produce one effect result and one typed consumed result.
- Lost dispatched create, input, and destroy operations each produce `COMPUTER_OUTCOME_UNKNOWN` carrying the canonical request and Computer identity.
- Permission scenarios assert the complete selected rule and resulting `allow`, `ask`, or `deny` decision for each of the four permission classes.
- Bundle verification returns the exact exhaustive file inventory, verified content identity, launcher identity, guest identity, SBOM, license, and provenance facts.

The focused Computer contract suite currently reports 12 passing tests and 49 assertions. It includes a post-dispatch launcher-loss fault injection proving that `session_create` returns `COMPUTER_OUTCOME_UNKNOWN`; it remains a control-plane baseline and does not satisfy the real Luna/Windows/viewer acceptance boundary.

## Release and acceptance boundary

The current implementation is **not accepted end to end**. It has demonstrated direct tool projection and typed missing-runtime failure, but it has not demonstrated a real Windows boot, screen observation, action effect, native viewer, takeover, Session isolation, or no-retry unknown-outcome behavior on the managed backend.

Release requires all six phases, a locally licensed Site Bundle, durable Tool/Attachment evidence from the real Luna Session, fault-injection evidence, and manual visual approval. Until then, Computer remains disabled by default and must fail closed when its single configured bundle is absent or invalid.

## Implementation progress — 2026-08-07

- Phase 1 replaced generic catalog source consolidation with one Conversation `mcp-config` publisher, coherent explicit-assignment availability, exact `tool`/`mcp_tool` semantics, and `next_owner_kinds:["call_tool"]` discovery.
- Phase 2 replaced Chat/Work-global Computer owners with exact Conversation Session owners and connected physical Session deletion to exact owner cleanup.
- Phase 3 made observations atomically single-use, classified create/input/destroy as effect operations, removed model-visible viewer commands, and restricted permission identity to the exact eight Computer tools while preserving explicit `ask`/`deny` precedence.
- Phase 4 strengthened the still-unreleased manifest v1 in place with exhaustive streamed hashing, symbolic/hard-link rejection, OpenCorvus-managed runtime workspaces, content-addressed provisioning, and the `computer-runtime verify|provision` command. No v2 identity exists before real Windows/Luna acceptance. Runtime execution now accepts only a provisioned bundle.
- The focused Computer positive non-UI contract suite passes 13 tests with 59 assertions. It includes typed unknown-outcome evidence after a dispatched create loses its response and an exact lifecycle contract proving one guest creation, takeover without destruction, a distinct returned run capability, a fresh second observation, and one terminal guest destruction. OpenCorvus and Overlay TypeScript validation pass.
- Phase 5 now separates the host-owned guest lifetime from each scoped Model Context Protocol (MCP) adapter lifetime. The host authority exclusively owns the launcher, Virtual Machine (VM), workspace, verified viewer identity, and terminal destruction. Takeover revokes the active adapter capability and disconnects its connection owner while preserving the VM; return issues a distinct run capability, and the replacement adapter starts without reusable observation authority. The MCP child receives only the authenticated host endpoint, run capability, and runtime scope; manifest and workspace paths remain host-only.
- The native Overlay Computer control surface is bound to canonical persisted `computer_session_create` metadata and exact Session/computer/display identity. It exposes host-backed status, verified native viewer launch, takeover, and return actions without adding a ninth model tool, Browser WebView, file polling, UI-only lifecycle state, or a second authority. Generated OpenAPI, Software Development Kit (SDK), and API documentation include the three ownership routes.
- Manual Phase 5 visual acceptance remains unachieved because a successful real Computer Tool Part cannot exist without a running licensed VM. No UI automated test was added, modified, or run, and no fixture or synthetic page was used to imitate the missing runtime.
- The 2026-08-07 asset audit found no `computer-runtime.json`, International Organization for Standardization (ISO) image, Virtual Hard Disk v2 (VHDX), or QEMU Copy-On-Write version 2 (QCOW2) image under `D:\myhexin-local`, Downloads, or Documents. `qemu-system-x86_64`, `qemu-img`, `virt-viewer`, and `remote-viewer` are absent from `PATH`, and no runtime manifest is configured in the continuation environment. Microsoft offers a registered 90-day Windows Enterprise evaluation, but registration/license acceptance and authorized image acquisition are deployment-owner actions; they were not silently performed.
- Phase 6 therefore remains truthfully blocked by the absent licensed, provisioned Windows Site Bundle and local runtime/viewer toolchain. The real `openai/gpt-5.6-luna` direct Work sequence, concurrent second-Session isolation, durable Tool/Attachment/backend evidence, native screenshots, and human visual approval are not accepted. No synthetic run is accepted as a substitute.
- The post-implementation second review traced the final disconnect, revoke, return, viewer, and destroy call paths and rechecked the eight-tool model surface. It found and removed one remaining authority leak: projected MCP children had inherited host-only bundle manifest and workspace paths. Their complete runtime environment now contains only the authenticated host endpoint, distinct run capability, and exact runtime scope. The review also found and fixed the native Button primitive's required tone contract.
- Final verified non-UI commands on the reviewed tree: focused Computer contract `13 pass / 59 assertions`; repository TypeScript `8 successful / 8 total`; Overlay production Vite build `7085 modules / exit 0`; API routes checker `6 rules / 34 files`; API docs checker `318 operations / 25 groups`; and `git diff --check`. No UI automated test path changed and no UI automated test ran.
