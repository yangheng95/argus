# Computer Use VM Runtime Integration Design

Date: 2026-08-06
Status: Design consensus reached; implementation and production acceptance have not started
Owner: Codex with three independent first-level read-only reviewers

## Implementation amendment: direct non-Mission interaction

The user clarified during implementation that “interaction mode” means the native non-Mission Chat/Work Conversation path. This explicit product requirement supersedes the design's proposed Expert Squad projection boundary without changing the three-Agent consensus on VM isolation, exact observations, permissions, single execution ownership, or self-contained packaging.

Computer is therefore a platform MCP capability rather than an Expert Squad. Chat or Work assigns it directly through `ConversationCapability`. An Expert Squad may also declare exact `default/mcp/computer/tool/*` references; `PromptProfileResolver` then projects only those declared tools into that scheduler or worker Harness, where fuzzy Catalog search can discover them. Fuzzy search never grants an installed-but-unbound tool. Neither route creates a Computer-specific Mission, Task dependency graph, virtual workflow, or dynamic Agent. The global Computer MCP remains disabled, and every active route owns a scoped connection and the same canonical Session permission evaluation.

## Recall

### User requirement

- Investigate whether a strong open-source Computer Use suite can be integrated into OpenCorvus.
- Design the integration rather than immediately adding another automation runtime.
- Use three independent sub-Agents to cross-review the design until they reach consensus.

### Acceptance criteria

1. Select one production-shaped Computer Use runtime direction without adding a second browser owner, a second Agent loop, a hidden workflow, or runtime fallback.
2. Preserve the native Browser WebView as the sole live browser URL, title, history, and page-state source.
3. Preserve `PromptProfileResolver` as the sole runtime capability projection source and the canonical Session message/tool-part stream as the sole observable execution record.
4. Define an implementable Computer target identity, observation/action contract, user takeover boundary, irreversible-action boundary, packaging model, failure behavior, and phased acceptance matrix.
5. Distinguish a version-pinned pilot from a production-ready claim. CUA components currently marked Alpha or Beta cannot be represented as production-proven without real packaging, runtime, security, and benchmark evidence.
6. Record all independent conclusions, disagreements, cross-review corrections, and the final three-way acceptance.

### Hard constraints

- No fallback, compatibility branch, second source, automatic backend selection, automatic retry, action replay, status machine, keyword classifier, confidence gate, or `force` bypass.
- No direct-host desktop control in version 1 (v1).
- No second Large Language Model (LLM) loop. All model decisions remain in the existing streaming OpenCorvus provider/runtime path.
- No synthetic, hidden, model-only, or User Interface (UI)-only message. Observation, action, failure, takeover, and terminal facts remain visible real messages/tool results.
- No Computer tool may take over the native Browser tab or write `browser_preview_target` / browser evidence as if a desktop were a webpage.
- No User Interface automated tests. The Computer surface and takeover flow require a real application, real guest display, screenshots, and personal visual review.
- No negative tests. Non-UI tests assert complete positive projections, typed error contracts, exact mapping, and successful runtime outcomes.
- Playwright, where still used for the existing Browser MCP (Model Context Protocol), runs through Node rather than Bun on Windows.
- Specifications remain under the root `specs/` single source.

### Architecture and historical material read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/05-config.md`
- `specs/current/architecture/06-provider.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-20-build-agent-browser-mcp-projection.md`
- `specs/records/2026-07/2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`
- `specs/records/2026-07/2026-07-21-projected-mcp-filepart-convergence.md`
- `packages/opencorvus/src/mcp/browser/builtin.ts`
- `packages/opencorvus/src/mcp/browser/sessions.ts`
- `packages/opencorvus/src/mcp/browser/tools.ts`
- `packages/opencorvus/src/mcp/browser/guard.ts`
- `packages/opencorvus/src/mcp/browser/permission-plan.ts`
- `packages/opencorvus/src/mcp/materialize.ts`
- `packages/opencorvus/src/session/processor.ts`
- `packages/overlay/src-tauri/src/main.rs`
- CUA, CUA Sandbox, CUA Driver, `cua-computer-server`, agent-browser, UI-TARS Desktop/SDK, Browser Use, Stagehand, Microsoft UFO, OmniParser, BrowserGym, Windows Agent Arena, and Windows-MCP official repositories or documentation.

### Whole-repository grep result

The investigation used repository-wide searches over:

```text
computer use|computer-use|desktop automation|browser automation|Browser MCP
Playwright|CDP|WebView2|native WebView|browser-preview
MCP|PromptProfileResolver|default/mcp|package_mcp
permission|irreversible|GUARD_BLOCKED|force:true
agent-browser|browser-use|Stagehand|UI-TARS|CUA|OmniParser|UFO
```

Material findings:

- OpenCorvus already owns a stateful Browser MCP with sessions, profiles, navigation, screenshots, observation, interaction, diagnostics, and projected tool refs. Browser automation is not the missing capability.
- The right Browser native WebView is already the sole live page-state owner. A desktop viewer cannot masquerade as that Browser.
- Stateful projected MCP calls already use a persisted Agent-session connection owner and canonical image materialization. Computer can reuse these boundaries instead of creating a second Tool, AttachmentStore, or message system.
- `expert-squads/mirror/prism/skills/agent-browser/SKILL.md` and `expert-squads/tanzeqi/mirror-watch/skills/agent-browser/SKILL.md` currently tell Agents to prefer an independently installed CLI over built-in browser tools. This is a conflicting Browser authority and must be removed or replaced before Computer delivery; it cannot remain as an alternate path.
- Browser coordinate interaction currently has a host confidence classifier with `allow | warn | block` and a `force:true` bypass in `guard.ts`; `permission-plan.ts` also allows the force permission in its baseline. This is not a trustworthy Computer safety boundary and conflicts with the project's prompt-over-host and no-gate principles.
- The initial worktree already contained extensive staged and unstaged changes unrelated to this design. This work must not overwrite or silently include them in a design commit.

### Independent Agent feedback and convergence

Three first-level Agents ran in parallel. Every assignment was read-only and explicitly prohibited further delegation.

| Reviewer | First-round conclusion | Cross-review correction | Final disposition |
| --- | --- | --- | --- |
| Architecture and single-source | Add a built-in `computer` MCP and initially preferred direct-host CUA Driver; reject UI-TARS Agent loop and agent-browser coexistence. | Withdrew direct-host after reviewing the destructive host surface. Rejected direct Driver/full computer-server MCP and selected a narrow CUA Sandbox adapter. Required a separate mature desktop viewer and human takeover. | Accepted the final VM-only text. |
| Ecosystem and runtime | Keep the existing Browser MCP and use CUA as the only desktop family; reject Browser Use, Stagehand, UFO, UI-TARS GUIAgent, Windows-MCP, and agent-browser coexistence. | Proved CUA runtime/transport auto-selection and Driver action paths were too broad. Selected explicit runtime + private HTTP transport + guest native coordinate handler; classified current CUA dependencies as Alpha/Beta pilot inputs. | Accepted the final VM-only text. |
| Adversarial security and acceptance | Require VM-only, no host data plane, visible takeover, no hidden policy safety claim, and exact action evidence. | Rejected implicit “latest observation” lookup because it creates a time-of-check-to-time-of-use race. Required every action input to carry the exact immutable observation identity and digest. | Accepted after the exact-observation correction. |

The reviewers disagreed during the first two rounds on direct-host versus virtual machine (VM), CUA Driver versus Sandbox transport, whether a visible desktop was a v1 requirement, and how irreversible GUI actions should be authorized. The final third-round text received `ACCEPT` from all three after replacing mutable “latest observation” resolution with explicit `observation_id + digest` input.

## Decision

OpenCorvus Computer Use v1 is a version-pinned, VM-only, single-executor pilot.

```text
OpenCorvus streaming Agent runtime
  -> PromptProfileResolver exact tool projection
    -> default/mcp/computer narrow stdio adapter
      -> pinned CUA Sandbox SDK
        -> one explicit local VM runtime
          -> one private HTTP transport
            -> pinned guest cua-computer-server native coordinate handler
              -> one guest display, screenshot owner, and input owner
```

The adapter is the only model-visible Computer capability. CUA Sandbox owns guest creation, connection, display URL acquisition, and destruction. The pinned guest `cua-computer-server` native handler owns screenshot and input implementation. OpenCorvus does not connect the server's full MCP surface and does not run CUA Driver.

The phrase “single executor” is strict:

- Sandbox `Localhost` is not constructed.
- A second input client is not connected while the Agent owns the Computer run.
- CUA Driver, Windows-MCP, Browser MCP handoff, and host mouse/keyboard automation are not available as alternative execution paths.
- Runtime, transport, screenshot backend, input backend, and guest image are explicit immutable inputs, not auto-selected choices.
- A backend error remains a visible typed failure. It never changes backend, replays an action, reconnects as if the action were known not to have happened, or moves the task to the host.

## Why the Browser remains unchanged

The Computer feature is not a Browser replacement.

| Surface | Sole owner |
| --- | --- |
| Native Browser URL, title, history, manual navigation, and page state | Existing native Browser WebView |
| Isolated webpage automation, page profiles, page screenshots, and browser diagnostics | Existing `default/mcp/browser` |
| Guest operating-system display, pixel observations, and guest input | New `default/mcp/computer` |
| VM display watched or controlled by the user | Dedicated Computer viewer bound to the same guest display |

A webpage opened inside the Computer guest remains part of the guest Computer surface. It does not become a Browser MCP session, cannot copy its state into the native Browser, and cannot use Browser MCP as a more convenient fallback.

Agents that own a Computer run do not simultaneously receive Browser MCP for the same subject. Existing browser-testing roles retain their current Browser projection for their existing tasks; no host router automatically changes between the two.

## Rejected alternatives

### Direct-host CUA Driver

Rejected for v1. It can touch the user's real desktop, accounts, files, clipboard, and foreground input. CUA permission policy cannot prove that a coordinate click is not a payment, send, publish, authorization, or external deletion. Its action contracts also expose Accessibility (AX), Pixel (PX), foreground, desktop, window, and page paths that a tool-name projection alone cannot restrict.

Direct-host Computer Use would require a separate product specification and threat review. It is not a configuration switch and cannot be a VM failure fallback.

### Full CUA Driver MCP or full `cua-computer-server` MCP

Rejected. Their broad tool sets include browser, shell, file, process, clipboard, window, recording, update, policy, or delivery-mode abilities outside the v1 contract. CUA Driver can return explicit escalation hints, and some Driver action forms contain their own AX-to-pixel behavior. The v1 adapter does not expose those surfaces.

### `agent-browser`

Rejected as a concurrent runtime. It is a credible future replacement benchmark candidate for the existing Browser MCP, but its daemon, Chrome DevTools Protocol (CDP), profiles, optional chat, and dashboard would create a second browser owner today. The two package Skills that currently tell Agents to prefer this CLI are architecture debt, not evidence that it is integrated correctly.

### UI-TARS Desktop/SDK

Rejected as a runtime. `GUIAgent` owns its own `INIT/RUNNING/END/MAX_LOOP` state and model invocation loop. That violates the single streaming LLM owner and no-state-machine constraints. Its Operator abstraction and coordinate-scaling ideas may inform the adapter design, but no UI-TARS model or Agent enters v1.

### Browser Use, Stagehand, Microsoft UFO, and Windows-MCP

- Browser Use and Stagehand duplicate the browser and model decision loop.
- UFO adds a second multi-Agent/DAG orchestration system.
- Windows-MCP runs on the host, enables a broad destructive surface, defaults telemetry on, and contains screenshot and accessibility fallback implementations.

None enters the production runtime or acts as fallback.

### OmniParser and benchmark suites

OmniParser is a perception component, not the runtime. Its code/model license mix and extra perception source are unnecessary for the coordinate-only v1. BrowserGym, Cua-Bench, OSWorld, Windows Agent Arena, and similar projects are evaluation inputs only; they do not become production execution owners.

## Runtime and supply-chain qualification

Current upstream facts make a qualification phase mandatory:

- `cua-sandbox` is still published with Alpha development status and supports Python versions below 3.14.
- `cua-computer-server` has a separate version line and Python constraint.
- Published wheels, repository version declarations, and CUA Driver documentation have shown version skew. Documentation for a newer Driver cannot prove the behavior of an older transitive Driver extra.
- CUA Sandbox contains automatic runtime and transport selection in its general-purpose API. The narrow adapter must bypass those entrypoints with exact configuration.

Before product implementation, record and verify:

1. Exact source commit, Python patch version, wheel versions, all transitive dependency hashes, licenses, Software Bill of Materials (SBOM), and guest image digest.
2. Phase 0 selects and locks one runtime from real Windows-host evidence. Runtime execution never performs auto-detection, switches runtime, or uses fallback.
3. One explicit private HTTP transport to the guest service. The service is reachable only from the adapter through a host-only boundary and does not expose an ambient network endpoint to the model or local webpages.
4. Telemetry, updater, fleet/cloud API access, external listener, and cloud credential use are disabled and verified by real network evidence.
5. The installed guest wheel and handler source prove one screenshot implementation and one input implementation for every projected v1 action. Fault injection produces a typed failure with its backend identity rather than a second implementation.
6. The Windows guest image is supplied under the user's valid license and is not silently downloaded or bundled into the ordinary OpenCorvus installer.

If these facts cannot be proven, the pilot remains not accepted. The implementation must not switch to direct-host Driver, Windows-MCP, Browser MCP, a different transport, or a different runtime to produce a passing demo.

## Canonical Computer identity

`session_create` returns one immutable target description:

```text
computer_id
runtime_identity
runtime_artifact_digest
guest_image_digest
os_identity
display_id
adapter_version
backend_identity
```

The live connection and process handle remain owned by the projected MCP connection scope. The canonical Session tool call/result contains the durable evidence that the target was created. A separate Computer workflow ledger or shadow session table is not added.

A process or transport crash invalidates the live handle. OpenCorvus records a visible terminal tool error. It does not automatically reattach to an orphan VM because the previous action outcome may be unknown. Orphan inspection and explicit cleanup are maintenance actions, not transparent runtime recovery.

## Model-visible v1 tool contract

The exact initial projection is:

```text
default/mcp/computer/tool/session_create
default/mcp/computer/tool/observe
default/mcp/computer/tool/click
default/mcp/computer/tool/type_text
default/mcp/computer/tool/keypress
default/mcp/computer/tool/scroll
default/mcp/computer/tool/drag
default/mcp/computer/tool/session_destroy
```

The adapter may use Sandbox lifecycle and display methods internally. It does not project:

```text
Localhost
shell / file / clipboard / terminal / tunnel
browser / profile / storage state
window or accessibility-tree actions
recording / trajectory
runtime selection / transport selection / scope escalation
install / update / fleet / cloud
host filesystem mounts or host clipboard sharing
```

Tool names and schemas are a stable Application Programming Interface (API) contract, not a workflow state machine. The Agent decides which action to call from the user request and visible evidence.

## Observation contract

`observe` returns one coherent guest-display observation:

```text
computer_id
observation_id
observation_digest
observed_at
display_id
width
height
backend_identity
screenshot attachment
```

The digest covers the canonical target identity, display identity, decoded Portable Network Graphics (PNG) dimensions, screenshot bytes, backend identity, and observation timestamp/sequence identity. Width and height come from decoding the actual screenshot bytes; the adapter does not call upstream size or window helpers that introduce another handler.

The screenshot is materialized through the existing MCP AttachmentStore path and persists as a normal completed Tool Part attachment with Computer provenance. Screen content is untrusted evidence. It never becomes an instruction, authorization, credential request, or permission expansion merely because text on the screen asks for one.

## Action contract and stale-observation integrity

Every action input explicitly carries:

```text
computer_id
observation_id
observation_digest
display_id
action-specific arguments
```

The adapter never resolves a mutable “latest observation.” It checks the exact immutable input identity against the target and coordinate space used to form the action. A mismatch returns a typed `STALE_OBSERVATION` result. It does not automatically call `observe`, update the arguments, retry, switch backend, or ask Browser MCP to finish the action.

Every successful action result contains:

```text
computer_id
consumed_observation_id
backend_identity
executed_at
backend_effect
```

An action maps to one atomic upstream input operation and does not take an implicit screenshot. When the Agent needs to verify the effect, it explicitly calls `observe` next; that call and its screenshot are a separate visible Tool Part. The Agent reads the new evidence and decides what to do next.

An action interrupted before dispatch returns a typed cancelled result. An action whose backend connection breaks after dispatch returns an outcome-unknown terminal error and is never replayed automatically.

## Visible desktop and human takeover

A backend spike may run before UI work, but a formally deliverable v1 requires a real visible and interactive guest display.

- Use a mature guest display/VNC (Virtual Network Computing) viewer selected through independent Phase 0 verification, then expose it through a dedicated Computer surface or its native viewer.
- Do not use the Browser tab, a temporary iframe, screenshot polling, a local signal, or a query override to impersonate the guest.
- The viewer and adapter refer to the same `computer_id` and guest display. The viewer is not a second screenshot authority; it is the user's live presentation/input channel.
- The private display URL and credentials remain host-owned and never enter model-visible tool results.

Takeover is a real ownership change, not a persisted workflow state machine:

1. The user requests takeover through a visible action.
2. The active Computer tool is cancelled before another action is dispatched; an already-dispatched atomic action must settle as success, failure, or outcome unknown.
3. The Agent Computer run terminates and its adapter connection closes.
4. The user operates the same guest through the real viewer. No Agent screenshot, accessibility capture, recording, trajectory, attachment, or LLM call occurs during takeover.
5. Returning to automation creates a new Agent run. Its first Computer action is `observe`; all pre-takeover observation identities are invalid.

The implementation must not market pause/resume or real-time cooperative control unless real input ownership and zero-capture evidence prove those semantics.

## Irreversible external effects

VM isolation protects the host; it does not make VM actions against logged-in external accounts reversible.

In v1, the Agent must not perform the final GUI action for payment, sending a message or email, publishing, granting authorization, deleting external resources, or an equivalent irreversible external effect. The Agent uses a visible Question to explain the exact pending effect and request takeover. The user performs the final action directly in the guest viewer.

This avoids pretending that a generic coordinate click can be reliably classified or authorized by host OCR (Optical Character Recognition), button text, a keyword list, or a confidence score. Question remains visible natural coordination, not an execution receipt.

A later capability may add a typed semantic action whose identity and external effect are exact before execution. Only that future typed action may use the existing `PermissionNext` one-shot authorization bound to its exact call; ordinary coordinate tools never auto-upgrade into that path.

## Message and evidence model

Reuse the current real message stream:

- `session_create`, observations, actions, cancellation, typed failures, and `session_destroy` are ordinary visible MCP Tool Parts.
- Screenshot bytes flow through `materializeMcpToolResult` and AttachmentStore.
- Tool inputs expose the action and the observation it consumes.
- Action Tool results expose only the atomic backend effect; a subsequent explicit `observe` Tool result exposes the new screen evidence.
- Takeover request/termination and return-to-automation are real visible user/assistant/tool events.
- No trajectory database, hidden audit log, synthetic heartbeat, model-only provenance message, or UI-only status duplicates these facts.

Sensitive user input during takeover is not captured. The design cannot honestly promise complete prompt-injection prevention or external-account safety; it provides VM host isolation, explicit authority boundaries, visible evidence, and human completion of irreversible effects.

## Current Browser debt to resolve before delivery

Computer implementation must not copy the existing Browser coordinate guard. Before Computer is called architecture-consistent:

1. Remove the competing agent-browser Skills or perform a separately approved complete Browser MCP replacement. The v1 plan selects removal; replacement requires its own benchmark and specification.
2. Replace Browser `allow | warn | block` confidence logic and `force:true` bypass with stable observation/target evidence and prompt-owned reasoning. Do not add another permission rule or a Computer-style gate to conceal the problem.
3. Preserve selector-based, element-based, or coordinate action as explicit Agent choices with truthful failures.

Deleting those existing debts requires a separate implementation diff, regression analysis, real Browser interaction, screenshots, and user-visible notification before removing discovered old code.

## Implementation phases

### Phase 0 — Upstream and supply-chain qualification

- Pin actual artifacts and inspect unpacked source, not only the current main branch or newest documentation.
- Build the fixed Windows guest with one native coordinate handler and a private transport.
- Prove network silence, one backend, coordinate correctness, typed failure behavior, and image/runtime licensing.
- Record cold/warm startup, image/cache size, idle/active CPU and memory, observation latency, action-to-explicit-next-observation latency, and two-VM isolation. These are measured facts; no arbitrary pass thresholds are hardcoded before evidence exists.

### Phase 1 — Narrow Computer MCP vertical slice

- Add `ComputerMCPBuiltin` and the exact importable tool refs.
- Package the narrow Python adapter with one fixed CPython patch and hashed dependency closure; do not depend on system `python`, `uv`, or `PATH` discovery.
- Bind one adapter process to one projected Agent-session MCP connection owner.
- Reuse canonical MCP result/image materialization and typed error persistence.
- Add explicit project/squad capability projection for the exact owners that need Computer Use. Do not infer grants from Agent names or roles.

### Phase 2 — Real Windows guest acceptance

- Complete Notepad, File Explorer, and Visual Studio Code tasks through explicit `observe -> action -> observe` evidence.
- Verify high Dots Per Inch (DPI), multiple displays where supported, text entry, keyboard combinations, scrolling, and dragging.
- Exercise cancellation before dispatch, crash after dispatch, guest loss, and explicit destruction without automatic replay or reconnect.

### Phase 3 — Dedicated Computer surface and takeover

- Mount the Phase 0-verified viewer in a dedicated native Computer surface or launch that verified native viewer.
- Perform real manual login and Multi-Factor Authentication (MFA) without Agent capture.
- Verify termination-on-takeover, zero capture during takeover, new-run return, and first-observe freshness.
- Personally inspect screenshots and visible message cards. Do not write or run UI automation tests.

### Phase 4 — Browser debt convergence and full review

- Remove conflicting agent-browser Skill authority.
- Root-cause and replace the Browser confidence guard/force path rather than carrying it into Computer.
- Re-run real Browser and Computer scenarios separately and confirm their state identities never merge.
- Conduct an independent final diff, package, runtime, security, and visual review before any production-ready claim.

## Non-UI positive contract verification

Tests may verify:

1. `ComputerMCPBuiltin.ImportableToolRefs` equals the approved complete set.
2. Resolver output equals the exact manifest declaration for every Computer owner.
3. The adapter maps each OpenCorvus action tool to exactly one pinned Sandbox/transport operation and returns that operation's declared successful output; `observe` separately maps to exactly one screenshot operation.
4. `session_create` returns the complete canonical target identity for the selected runtime/image/backend.
5. `observe` returns a valid PNG attachment, decoded dimensions, backend identity, and a stable digest over its exact canonical inputs.
6. Each action consumes the declared exact observation identity and returns its atomic backend effect; an explicit later `observe` returns the new screen evidence.
7. A mismatched observation maps to typed `STALE_OBSERVATION`; a runtime/image absence maps to a typed runtime requirement; post-dispatch connection loss maps to a typed outcome-unknown result.
8. MCP stateful cross-tool execution uses one connection owner; disposal closes the adapter once and leaves a truthful terminal result.
9. Wheel, runtime, guest image, SBOM, and license inventories equal the pinned release manifest.
10. Fault-injected screenshot and input calls report the selected backend identity and typed failure rather than switching implementations.

Tests must assert current positive outputs or typed error contracts. They must not be written as “old tool/path does not exist” tests.

## Real runtime and visual acceptance

The release evidence must include:

- A real Windows host and a real licensed Windows guest using the exact pinned runtime and image.
- A real visible guest desktop and screenshots personally inspected before and after every representative action family.
- Notepad, File Explorer, and Visual Studio Code task evidence.
- 100%, 125%, 150%, and 200% DPI coordinate round trips where the selected VM/display stack supports them.
- A multi-display result if the selected stack claims multi-display support; otherwise a truthful typed unsupported result and a single-display product boundary.
- Repeated sessions and at least two isolated concurrent VMs, with measured startup, resource, and action/observation latency.
- Sidecar/transport/guest failure evidence proving visible terminal errors, no action replay, and no fallback.
- Real takeover, human login/MFA, zero Agent capture during takeover, a new Agent run, and a fresh first observation.
- Manual review that the native Browser URL/history remains independent while Computer operates its guest.
- A second independent review of the implementation and the evidence package.

Missing any single-owner, exact-artifact, real-Windows, visible-display, takeover, audit, or visual-review requirement means v1 has not reached production acceptance. Linux/container smoke tests, mocked MCP chains, fixture image refs, schema checks, and verbal safety claims cannot substitute for those facts.

## Benchmark role

After the vertical slice is real, Cua-Bench or selected OSWorld/Windows Agent Arena tasks may measure capability. The benchmark runner remains outside the production runtime.

Record, rather than pre-invent, these values:

- cold and warm VM startup;
- disk cache and overlay growth;
- idle and active CPU/RAM;
- `observe` p50/p95 latency and screenshot bytes/model image pressure;
- action-to-explicit-next-observation p50/p95;
- target acquisition, supported-task completion, wrong-window input, and silent-success counts;
- two-VM isolation and crash cleanup behavior.

Every benchmark bug found in OpenCorvus, the adapter, the selected CUA artifacts, or the viewer must be investigated to its owner. A benchmark score cannot override a broken safety or single-source contract.

## Completion boundary

This design is complete: three independent reviewers reached consensus on the architecture and acceptance contract.

No implementation is complete yet. CUA remains a candidate upstream family behind a required artifact/runtime qualification. OpenCorvus must report the pilot as unaccepted if the exact upstream artifacts cannot provide one backend, private transport, stable coordinate behavior, network silence, visible takeover, and real Windows evidence without fallback.
