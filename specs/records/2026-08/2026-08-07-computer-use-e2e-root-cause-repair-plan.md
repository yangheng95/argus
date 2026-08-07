# Computer Use End-to-End Root-Cause Repair Plan

Date: 2026-08-07
Status: Host-native correction and real Windows/Luna acceptance complete; commit and legacy remote push pending
Owner: Codex

## Recall

### User requirements

- Computer Use is an application capability for direct non-Mission Chat and Work, not an Expert Squad and not a deployment project.
- A normal OpenCorvus user must not install, license, build, or maintain a Virtual Machine (VM), Windows image, hypervisor, viewer, daemon, or standalone driver to use Computer Use.
- OpenCorvus must ship the mature desktop-control implementation it needs and control the user's current operating-system desktop through the native application.
- The model-visible surface remains the exact eight Computer Model Context Protocol (MCP) tools: `session_create`, `observe`, `click`, `type_text`, `keypress`, `scroll`, `drag`, and `session_destroy`.
- Human takeover stops Agent guest input without inventing a hidden tool, Browser WebView, file-polling control plane, synthetic message, second lifecycle source, fallback, gate, or state machine.
- User Interface (UI) work is accepted only through the real Overlay, real interaction, screenshots, and human visual review. No UI automated test may be added, changed, or run.
- Final acceptance uses `openai/gpt-5.6-luna` on the managed backend and retains durable Tool, Attachment, backend, and screenshot evidence.

### Product correction from the user

- The previous plan incorrectly equated isolation with a user-provisioned Windows VM. That design made a basic product capability depend on an International Organization for Standardization (ISO) image, Virtual Hard Disk v2 (VHDX), QEMU, virt-viewer, a content-addressed Site Bundle, and deployment licensing work.
- The user rejected that premise on 2026-08-07: users will not install a VM for Computer Use.
- This is a root architecture correction, not a wording change. The VM runtime bundle, provisioning command, runtime manifest configuration, launcher protocol, native viewer process, and licensed-image acceptance boundary must be removed from the current product path.
- Commit `1a4ac332a5` preserved useful adapter/run separation but embedded the wrong VM lifetime and viewer assumptions. It is not reverted wholesale; the valid catalog, permission, observation, error, and run-authority work is retained while the runtime implementation is replaced directly.

### Current repository and remote state

- Work continues only in the user-authorized isolated worktree `D:\myhexin-local\opencorvus\.scratch\computer-lifecycle-e2e`.
- The original checkout contains unrelated work and remains outside this task.
- The continuation worktree was clean before correction and moved from `1a4ac332a5` to current legacy remote `v0.0.33beta` commit `4e603b7a705a8c0add768f57ad242fba073f5f5e`; the latter contains the former plus unrelated already-pushed commits.
- The first refresh attempt hit a transient legacy remote TLS handshake failure; the already-current remote-tracking ref was used only after the clean-tree evidence was recorded. Remote freshness must be rechecked before the next push.

### Material read

- This plan's previous Recall and implementation record.
- `specs/records/2026-08/2026-08-06-computer-use-vm-runtime-integration-design.md` and `2026-08-06-computer-use-runtime-implementation-plan.md` as the superseded VM premise.
- `specs/current/architecture/04-extensions.md`, `05-config.md`, and `99-principles.md`.
- Current Computer catalog/search, permission, controller, backend, host authority, viewer route, Overlay control surface, OpenAPI, Software Development Kit (SDK), configuration, command, and contract-test paths.
- CUA Driver official process model, SDK integration, interface contracts, Windows platform support, MCP tool reference, release assets, and MIT license.

### Whole-repository search result

Repository-wide searches covered CUA, `runtime_bundle_manifest`, `JsonLineComputerBackend`, `ComputerHostRuntime`, runtime bundle verification/provisioning, viewer routes, generated SDK/docs, and the Computer contract suite. They establish that the VM premise currently spans configuration, documentation, command-line interface, backend process ownership, host routes, Overlay actions, generated APIs, and tests. A correct repair must replace that complete slice and delete the old path rather than add a host-native fallback.

### Independent Agent feedback

The earlier three-Agent review accepted a VM design because every reviewer inherited the same false product premise. Their conclusions remain useful for catalog single-source publication, canonical `tool`/`mcp_tool` kinds, exact permissions, Session-scoped adapter authority, atomic observation consumption, and unknown side-effect outcomes. Their VM bundle and separate viewer conclusions are superseded by the explicit user correction and current CUA Driver SDK evidence. No new sub-Agent was requested for this continuation.

## Evidence and causal chain

1. The first direct Luna run proved the eight Computer tools can be projected but failed with `COMPUTER_RUNTIME_REQUIRED` because the repository required an external runtime bundle.
2. The subsequent implementation made that external deployment artifact stricter and safer, but did not question whether a normal user should possess one.
3. The missing ISO/QEMU/viewer audit was therefore not an incidental environment blocker. It exposed the product-design error: OpenCorvus had made its default Computer capability depend on a separately assembled guest operating system.
4. CUA Driver's official application SDK provides the missing mature abstraction directly. TypeScript applications import `@trycua/cua-driver`; `CuaDriver.create()` loads the Rust implementation in the application process with no daemon, executable, or inter-process communication. Windows support uses Win32, UI Automation (UIA), native input, targeted window messages, and real desktop capture.
5. Therefore the correct single source is one application-lifetime in-process CUA Driver owned by the OpenCorvus host. The existing OpenCorvus eight-tool surface remains the narrow Agent contract; it delegates to the typed SDK instead of implementing desktop automation or launching a VM.

## Correct architecture

### 1. One application-owned native driver

- Add one exact, pinned `@trycua/cua-driver` dependency with its target-native package and declared MIT / Mozilla Public License 2.0 (MPL-2.0) provenance included in normal OpenCorvus packaging.
- Create one host-owned `CuaDriver` instance for the OpenCorvus application lifetime using `CuaDriver.create()`.
- Do not require or discover a `PATH` executable, system Python, daemon, socket, VM, cloud sandbox, installer, or user-provisioned artifact.
- Use only the same-process typed Software Development Kit (SDK) constructor; do not invoke the daemon compatibility, installer, or updater surfaces. OpenCorvus remains the lifecycle and dependency-update authority.
- Shutdown the driver through its typed `shutdown()` and binding-destruction contract during application disposal.

### 2. Session-scoped Agent authority over the current desktop

- `computer_session_create` starts one CUA Driver desktop-capture session using the exact OpenCorvus runtime scope and returns a public host-computer identity plus the real display identity.
- Each OpenCorvus Conversation/Orchestrator/Worker runtime scope gets a distinct CUA session and observation cache while all sessions correctly refer to the same physical host desktop.
- The product no longer promises process, credential, or visual isolation between two Computer sessions. Concurrent Sessions are distinct authorities over one real desktop, not distinct machines.
- The host issues one revocable OpenCorvus adapter capability per Agent run. Adapter disconnect does not end the CUA session. Explicit `session_destroy` or owner disposal ends the exact CUA session.

### 3. Observation and action mapping

- `observe` calls the typed desktop-state SDK operation and materializes its real Portable Network Graphics (PNG) image as the canonical Attachment.
- Preserve the existing immutable observation identifier, digest, dimensions, exact display binding, and synchronous single-use consumption before input dispatch.
- Map click, text, keypress, scroll, and drag to the closest typed CUA SDK inputs. Use desktop scope for the current eight-tool coordinate contract; do not reimplement Win32 input or screenshot code.
- Each effect is dispatched once. A lost response remains `COMPUTER_OUTCOME_UNKNOWN`; there is no retry, replay, reconnect, or alternative backend.

### 4. Human takeover on the actual desktop

- The current desktop is already the native human view; delete the separate viewer process, viewer descriptor, viewer credentials, and Open viewer action.
- The Overlay surface shows exact desktop/display identity and whether Agent input is enabled.
- Takeover revokes the current Agent run and disconnects its MCP adapter. The physical desktop remains untouched and immediately belongs to the user.
- Return issues a distinct Agent run capability. The new adapter/controller explicitly calls the same visible `session_create` tool to attach to the preserved host session, then calls `observe` before any effect.
- OpenCorvus does not synthesize a message or secretly resume an LLM turn. Return makes the capability available to the next real model continuation.

### 5. Remove the superseded VM path

- Delete `computer.runtime_bundle_manifest` from configuration, schemas, OpenAPI, SDK, and docs.
- Delete the runtime bundle verifier/provisioner, `computer-runtime` command, launcher protocol, JSON-line VM backend, runtime workspace/descriptor, viewer resolver/launcher, and their obsolete non-UI tests.
- Delete the VM-specific native viewer route and generated client surface.
- Replace the previous host runtime implementation in place; do not retain a runtime selector, compatibility alias, manifest v1/v2 identity, or fallback.
- Update current architecture and historical task records so there is one current runtime truth. The older dated VM documents must be deleted or rewritten according to their current authority; no parallel active design may remain.

## Acceptance criteria

1. A clean packaged OpenCorvus install needs no Computer-specific user installation or VM asset.
2. The exact eight model-visible Computer tools remain discoverable in direct Work and explicit Expert Squad projections with canonical permissions.
3. `session_create` starts a CUA desktop session against the current Windows interactive desktop and returns exact host/display identity.
4. `observe` produces a real current-desktop screenshot Attachment; one observation authorizes at most one action.
5. A real action changes the intended desktop target once, and the next real observation proves the effect.
6. Takeover stops further Agent input while leaving the desktop and application alive; return creates a distinct run capability and requires a fresh observation.
7. Explicit destroy and Session disposal end the exact CUA session without shutting down the application-wide driver while other sessions remain.
8. A second Session has a distinct CUA/OpenCorvus session identity and controller on the same host desktop; the evidence must describe shared physical-desktop semantics honestly rather than claiming VM isolation.
9. The real Overlay surface is launched, interacted with, screenshotted, and visually reviewed. No UI automated test or baseline exists.
10. `openai/gpt-5.6-luna` completes create -> observe -> input -> observe -> takeover -> return -> observe -> destroy through visible Tool Parts, with durable Tool, Attachment, backend, and screenshot evidence.

## Positive non-UI verification

- Dependency/package validation proves the pinned root and native CUA Driver packages are present in the packaged dependency closure.
- Host runtime tests use the typed SDK boundary and assert complete session/action/lifecycle outputs; they do not mock or claim real desktop acceptance.
- The complete environment projected to the MCP child contains only the authenticated host endpoint, run capability, and exact runtime scope.
- The focused Computer contract proves exact eight-tool publication, permission identity, distinct run capabilities, fresh observation after return, and exact CUA session termination.
- Repository typecheck, API route checker, docs checker, and relevant package builds pass.
- No UI automated test path is created, changed, or executed.

## Real acceptance sequence

1. Build/package the native CUA SDK with OpenCorvus on Windows.
2. Start an isolated real OpenCorvus backend/Overlay without touching another running owner.
3. Use direct Work with `openai/gpt-5.6-luna`; discover and call the eight Computer tools naturally.
4. Observe the current desktop, perform one reversible action in a dedicated real application, and observe the proven result.
5. Open the persisted Computer Tool Part in the real Overlay, take over, interact physically, return control, and require Luna to observe again.
6. Destroy the Computer session, then run a second exact Session to prove separate logical ownership on the shared desktop.
7. Retain screenshots and durable Tool/Attachment/backend evidence, perform a separate manual code/visual review, commit with the `dsw-33987` prefix, and push to legacy remote without bypassing hooks.

## Release boundary

The current `1a4ac332a5` VM-based runtime implementation is not accepted as the final Computer Use product. Catalog/search, permission, observation, and adapter-run repairs may remain, but runtime bundle, VM launcher, viewer, and licensed-image requirements must be removed and replaced by the in-process native CUA Driver before real E2E acceptance.

## Implementation progress

### Implemented

- Replaced the VM/launcher/viewer backend with the same-process typed `@trycua/cua-driver@0.12.2` SDK and one host-owned driver shared by logical Computer sessions.
- Removed runtime bundle configuration, provisioning CLI, JSON-line launcher backend, workspace descriptor, viewer process/server route, generated viewer API, and Overlay viewer action. There is no VM compatibility path or runtime selector.
- Packaged the pinned root SDK and official target-native packages for Windows, macOS, and supported Linux targets; Windows and macOS are first-class application targets and require no user-installed driver or virtual machine.
- Kept the model-visible surface at exactly eight Computer MCP tools and preserved canonical permission, observation digest, one-effect consumption, Attachment, and unknown-outcome contracts.
- Separated adapter/run revocation from native desktop destruction. Takeover revokes the current adapter while preserving the host-owned CUA session; return issues a new authorization; the new run uses visible `session_create` to attach and then performs a fresh `observe`.
- Kept adapter authority usable after exact `session_destroy`: destruction ends and closes only that native desktop session, clears its host identity, and allows the same connected adapter to establish a new native session. Application/session disposal remains the separate owner cleanup path.
- Updated the real native control surface to show current desktop identity and Agent/human ownership with Take over and Return to Agent actions.

### Real Windows and Luna evidence

- A direct product-driver probe captured the real 1792x1120 Windows desktop, typed `OPENCORVUS-CUA-E2E-PASS` into a dedicated Windows Terminal, and captured the visible result in `specs/artifacts/computer-use-e2e/windows-native-driver-terminal-input.png`.
- Direct Work with `openai/gpt-5.6-luna` received exactly 34 tools: 26 platform tools plus the exact eight Computer tools. It created `host-desktop:opencorvus-ebd4a184-a170-4dcb-b611-a9256d7c784f`, observed, dispatched one accepted text action `914f52ea-1826-4a2d-907f-0e2d3bb547cf`, observed the changed desktop, and destroyed the session.
- The real Overlay was opened and manually operated. Screenshots retain Agent-owned, human-owned takeover, and returned ownership states. No UI automated test, fixture, baseline, or visual assertion was created, changed, or run.
- The first return attempt exposed an adapter-local `COMPUTER_SESSION_NOT_FOUND`: host identity remained live, but the fresh adapter had not attached its local controller. The contract was corrected so the existing visible `session_create` means create-or-attach for the current run; no hidden ninth tool or host control path was added.
- A delayed diagnostic attach later reached the preserved host identity but the native SDK session had exceeded its live window and returned typed `session_ended`; this failure was retained rather than called a pass.
- The immediate corrected sequence then succeeded on exact identity `host-desktop:opencorvus-5437a106-4e7d-4ee1-90be-faad2db48a9a`: create/observe, takeover with desktop preserved, return with fresh observation required, new-run visible attach, fresh observation `bcbaaa4b-59ce-4d99-a3d2-8b4f6c8f403c`, and exact destroy.
- Two different direct Work Sessions were concurrently live on the shared physical desktop with distinct authorities: `host-desktop:opencorvus-906161ef-93ac-49f3-af56-517e6521602d` and `host-desktop:opencorvus-477f745e-17b7-4392-a1b0-cb7b635d4f64`. Exact host status returned `agent`, `primary`, and Driver `0.12.2` for both before both were explicitly destroyed.
- Durable public identifiers for Tool Parts, observation digests, backend action, concurrency, cleanup, and screenshot files are recorded in `specs/artifacts/computer-use-e2e/windows-luna-e2e-evidence.json`; the isolated database retains the original Tool and Attachment rows without exposing credentials.

### Verification status

- Focused non-UI Computer contract: 15 tests, 69 assertions passing, including takeover/return fresh adapter attachment, post-dispatch response loss, same-adapter post-destroy reuse, exact eight tools, permissions, persistence, package closure, and typed native SDK mapping.
- `packages/opencorvus` TypeScript validation passes after the lifecycle repair.
- Final Overlay production build and local package build pass. The final build was reopened in the real page; Agent ownership, human takeover, return ownership, and the attach-then-observe notice were manually reviewed and recaptured.
- Full repository typecheck, focused package typecheck, API route checker, docs checker, evidence JSON parsing, and diff whitespace checks pass. The AGENTS.md historical-docs-links command has no corresponding test file in this checkout, so no historical UI or document test was invented to replace it.
- Second code review removed the final unused VM runtime error codes and corrected destroy semantics so adapter authority and native session destruction remain separate.
- Remaining before delivery: successful remote refresh, exact commit, pre-push hooks, and legacy remote push.
