# Computer Use VM Runtime Implementation Plan

Date: 2026-08-06
Status: Direct Conversation and exact Expert Squad projection implemented; real Windows guest acceptance remains dependent on a provisioned licensed runtime bundle
Owner: Codex

## Recall

### User requirement

- Begin implementing the accepted Computer Use design.
- Keep the integration self-contained and enforce the intended permissions.
- Preserve the earlier three-Agent consensus: Computer operates only inside an isolated Virtual Machine (VM), remains separate from the native Browser, and has one executor.
- Apply the user's implementation correction that Computer Use is a direct non-Mission interaction capability, not an Expert Squad workflow.
- Apply the user's follow-up correction that an Expert Squad may explicitly project the platform Computer tools through its Harness; fuzzy search discovers only that already-projected set.

### Acceptance criteria

1. Add one narrow `default/mcp/computer` server with exactly `session_create`, `observe`, `click`, `type_text`, `keypress`, `scroll`, `drag`, and `session_destroy`.
2. Bind every input action to an explicit Computer, display, observation identity, and observation digest; stale or mismatched observations produce a typed result and no backend action.
3. Launch only one explicitly configured, complete Computer Runtime Bundle. The bundle manifest and every runtime file are hash-verified before launch.
4. Do not inspect `PATH`, install packages, use system Python, select cloud execution, control the host desktop, retry an action, replay an action, or switch to another backend.
5. Assign Computer explicitly through native Chat/Work, or project exact `default/mcp/computer/tool/*` references through an Expert Squad Harness. Computer itself remains a platform MCP capability rather than an Expert Squad or workflow.
6. Give projected Computer calls the same canonical Session permission evaluation as global calls. Permissions distinguish session creation, observation, input, and destruction.
7. Keep screenshots in the existing MCP image-to-Attachment materialization path and visible Tool result stream.
8. Add positive non-User Interface (UI) contract tests for the exact tool set, observation binding, one-action-to-one-backend-call mapping, typed errors, permission identity, and runtime-bundle verification.
9. Do not claim production or Windows visual acceptance until a licensed Windows guest bundle has run in the real application and its viewer/takeover path has been personally reviewed.

### Hard constraints

- No fallback, compatibility route, dual source, gate, host-side action classifier, status machine, hidden message, second Agent loop, or non-streaming Large Language Model (LLM) call.
- No host desktop control and no Computer projection into the Browser WebView.
- No direct import of the upstream full Computer server surface. Shell, file, clipboard, accessibility, window-management, and arbitrary command endpoints remain unavailable.
- No UI automated tests. Real viewer and takeover acceptance is manual and visual.
- No negative tests. Typed error outputs and complete positive contracts are valid assertions.
- The runtime bundle is an independently provisioned deployment artifact because the upstream project does not publish one complete, redistributable Windows VM bundle.

### Material read

- `specs/records/2026-08/2026-08-06-computer-use-vm-runtime-integration-design.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/05-config.md`
- `specs/current/architecture/99-principles.md`
- `packages/opencorvus/src/config/config.ts`
- `packages/opencorvus/src/mcp/index.ts`
- `packages/opencorvus/src/mcp/materialize.ts`
- `packages/opencorvus/src/mcp/browser/builtin.ts`
- `packages/opencorvus/src/mcp/browser/permission-plan.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/cli/cmd/mcp.ts`
- current upstream CUA repository, CUA Sandbox package metadata, and `cua-computer-server` source and package metadata.

### Whole-repository grep result

Repository-wide searches covered `default/mcp`, `package_mcp`, `PromptProfileResolver`, MCP connection ownership, Browser permission binding, image materialization, runtime locks, Expert Squad manifests, and CLI launchers. The resulting ownership boundaries are:

- `PromptProfileResolver` is the only active package capability projection owner.
- MCP scoped connection ownership already preserves one stateful server per Agent Session.
- Session permission evaluation has a Browser-specific projected-tool identity binding; Computer needs the same general mechanism rather than bypassing permission evaluation.
- MCP image materialization is already the canonical route from binary screen output to visible persisted Attachment parts.
- The existing Browser is a separate page automation product and cannot become a Computer backend or viewer.

### Independent Agent feedback

The preceding design record contains the complete feedback and cross-review from the three explicitly requested independent Agents. Their consensus selected a VM-only, native-coordinate CUA direction with exact observation-bound actions, one executor, visible takeover, and manual irreversible effects. This implementation does not reopen that selection or introduce a second candidate.

### Upstream verification and implementation correction

The implementation inspection pinned the current upstream CUA source identity to commit `bb8efbfe6caadbccba54221096d959607ed9f574`. The current `cua-computer-server` declares version `0.3.42` and Python `>=3.12,<3.14`; its public server exposes a much broader command surface than OpenCorvus permits. CUA Sandbox is marked Alpha and defaults to cloud-oriented setup unless local execution is configured.

The upstream release surface does not provide a single immutable artifact containing QEMU (Quick Emulator), a licensed Windows guest image, Python runtime, pinned wheels, the Computer server, viewer, Software Bill of Materials (SBOM), licenses, and hashes. Consequently, the implementation will not download fragments or infer a local environment. OpenCorvus owns a strict bundle contract and accepts only one fully provisioned directory whose manifest closes that complete runtime dependency graph.

## Implementation contract

### Runtime bundle

The operator configures one manifest path. The manifest contains:

- schema version and bundle identity;
- supported host operating system and architecture;
- pinned upstream repository and commit;
- one relative launcher path and SHA-256 (Secure Hash Algorithm 256-bit) digest;
- one guest-image identity and digest;
- one viewer launcher identity and digest;
- one SBOM and one license inventory identity and digest;
- the exhaustive relative file inventory with byte length and SHA-256 digest.

OpenCorvus resolves every path beneath the manifest directory, rejects escaping or duplicate paths, verifies the exhaustive inventory, and launches the declared executable by absolute path. Runtime configuration is passed by one versioned standard-input protocol. No environment discovery participates in resolution.

### Narrow backend protocol

The bundle launcher accepts newline-delimited JavaScript Object Notation (JSON) requests and returns correlated newline-delimited JSON results. The protocol exposes only create, observe, the five atomic inputs, and destroy. Each request has one request identifier. Each response has one result or one typed error. A transport break while an input is in flight becomes `COMPUTER_OUTCOME_UNKNOWN`; OpenCorvus never retries it.

### Observation authority

An observation contains Computer identity, display identity, pixel dimensions, Portable Network Graphics (PNG) bytes, and a digest over those exact canonical facts. Actions repeat the Computer, display, observation identity, digest, and coordinates or input payload. The controller validates the tuple and bounds before emitting exactly one backend request. A successful action returns only the backend effect fact; a later screen requires an explicit `observe`.

### Permission authority

The tool-to-permission mapping is:

- `session_create` → `computer.session.create`;
- `observe` → `computer.observe`;
- `click`, `type_text`, `keypress`, `scroll`, `drag` → `computer.input`;
- `session_destroy` → `computer.session.destroy`.

The ordinary global config keeps Computer disabled. Native Chat/Work may assign the Computer server explicitly. An Expert Squad may instead declare exact `default_mcp_tool_refs`; `PromptProfileResolver` materializes the same platform Computer MCP for only those declared tools, the Harness Catalog exposes them as visible, and fuzzy search discovers that exact projected set. Fuzzy discovery does not grant an unbound capability. Both routes preserve the original Computer permission identity and use the canonical Session permission evaluator. User-defined `ask` or `deny` rules remain authoritative. Irreversible external effects are not guessed from coordinates: the Agent stops and asks the user to complete them through visible takeover.

## Delivery sequence

1. Implement the bundle schema, exhaustive hash verifier, typed error model, narrow backend interface, controller, MCP tools, and CLI entry.
2. Add disabled-by-default built-in materialization and exact Chat/Work Conversation capability assignment support.
3. Add the Computer permission identity and canonical Session evaluation for direct Conversation and exact Expert Squad projections.
4. Remove the superseded Computer Expert Squad, workflow, and generated payload entry while retaining platform MCP materialization for manifests that explicitly declare Computer tool references.
5. Extend screenshot metadata without borrowing Browser identities.
6. Run targeted non-UI contract tests, TypeScript checks, Conversation and Expert Squad Harness projection checks, package generation checks, and repository hooks.
7. When a licensed bundle is supplied, run a real Windows guest, inspect the viewer and screenshots personally, verify takeover and input behavior, and record visual evidence. Until then this final step is explicitly unaccepted.

## Completion boundary

This implementation round can complete the OpenCorvus control plane, bundle integrity boundary, permission wiring, package projection, and non-UI contracts. It cannot manufacture or redistribute a Windows license or label a mocked backend as real VM acceptance. Missing real bundle evidence is a deployment blocker, not a reason to add a cloud, host, Python, Browser, or mock fallback.
