# MCP Structured Result Interactive Artifact Prompt

> Date: 2026-08-07
>
> Status: Implemented and second-pass reviewed

## Recall

### User request

- Configure and test Zapier as a Model Context Protocol (MCP) integration for OpenCorvus.
- Preserve a rich interaction surface instead of reducing connected-app results to dry prose or a generic Tool card.
- Confirm whether the existing `mcp-app@1` renderer is already the generic MCP Apps artifact surface.
- Strengthen the Prompt after establishing the exact boundary between automatic MCP Apps and model-published native artifacts.

### Acceptance criteria

- A real MCP Tool that declares `_meta.ui.resourceUri` continues to create exactly one automatic `mcp-app@1` artifact through the existing Host lifecycle; the Prompt does not publish duplicate content.
- A connected MCP Tool that returns structured multi-item data is explicitly considered for an appropriate native Interactive Artifact when filtering, comparison, or item-by-item review materially improves the answer.
- The Prompt does not claim that ordinary MCP Tool results can be transformed into `mcp-app@1` without a real `ui://` resource.
- Both native Chat and Work receive the shared strengthened guidance through their existing single Prompt fragment.
- A positive non-UI contract test proves the shared guidance and both primary-assistant projections contain the approved behavior.

### Hard constraints

- Keep `mcp-app@1` activation owned by the existing protocol evidence and Host implementation, not by Prompt inference, a Host gate, a keyword matcher, or a second renderer source.
- Do not publish MCP App Hypertext Markup Language (HTML) from the model.
- Do not add Gmail- or Zapier-specific rules to the global Prompt. Domain presentation fields and transactional behavior belong to a future self-contained capability package.
- Do not duplicate an automatically produced MCP App with a native `table@1`, `dashboard@1`, or prose copy of the same result.
- Add only positive contract assertions; do not add User Interface (UI) automation or negative tests.
- Preserve all unrelated worktree changes.

### Sources read

- `specs/current/architecture/07-panel.md`
- `specs/records/2026-08/2026-08-06-mcp-integration-platform-research-and-plan.md`
- `packages/opencorvus/src/prompt/fragments/interactive-artifact-guidance.ts`
- `packages/opencorvus/src/agent/primary-assistant-registry.ts`
- `packages/opencorvus/src/work/harness.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/mcp/index.ts`
- `packages/opencorvus/src/interactive-artifact/schema.ts`
- `packages/opencorvus/src/interactive-artifact/mcp-app.ts`
- `packages/opencorvus/src/interactive-artifact/mcp-app-lifecycle.ts`

### Whole-repository search evidence

Repository searches for `mcp@1`, `mcp-app@1`, `createMcpAppToolLifecycle`, `appToolBinding`, `stableToolUiResourceUri`, `publish_interactive_artifact`, and `CHAT_INTERACTIVE_ARTIFACT_GUIDANCE` established that:

- there is no `mcp@1` renderer identity; the generic application renderer is `mcp-app@1`;
- the runtime creates an MCP App lifecycle only when the real MCP Tool has an App binding derived from `_meta.ui.resourceUri` using a `ui://` Uniform Resource Identifier (URI);
- ordinary MCP Tools do not automatically produce `mcp-app@1`;
- the shared Interactive Artifact guidance is already projected into Chat and Work;
- the shared fragment already selects `table@1` for filterable and sortable rows, but does not explicitly connect that decision to structured multi-item MCP results or suppress a duplicate native artifact when an automatic MCP App exists.

### Independent agent feedback

No sub-agent was started. The user did not request multiple independent agents or parallel review, and the active collaboration policy does not authorize inferred delegation. The implementation receives a separate main-agent second-pass review after its targeted tests.

## Root cause

The renderer and lifecycle implementation are already correct. The missing behavior is a Prompt-level presentation decision for ordinary connected MCP results: the current wording says to use an Interactive Artifact when it materially improves an answer, but it does not name structured multi-item MCP output as a first-class candidate. The same omission leaves room for a model to publish a redundant native artifact after the Host has already produced `mcp-app@1`.

This is not an MCP transport, renderer, or Host-routing defect. Changing Host code would create a protocol-blind presentation rule and violate the existing single-source boundary.

## Implementation

Update the shared Interactive Artifact guidance with one provider-neutral decision rule:

1. After a connected MCP Tool returns structured multi-item data, prefer the appropriate native Interactive Artifact when filtering, comparison, or item-by-item review materially improves the response.
2. When the real Tool automatically produces `mcp-app@1`, treat that App as the interactive surface and do not publish a duplicate native artifact for the same result.

The existing source-and-safety rule remains authoritative: a model never publishes MCP App HTML itself.

Add a positive Prompt contract test that verifies:

- the shared fragment contains the structured-MCP-result decision;
- the shared fragment contains the automatic-App reuse decision;
- native Chat and Work each project the exact shared guidance.

## Verification

Run:

```bash
bun test packages/opencorvus/test/prompt/interactive-artifact-guidance.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Then reread the final Prompt in both Chat and Work composition paths and review the diff for accidental domain-specific behavior, duplicate rendering authority, or unrelated worktree changes.

## Verification results

- `bun test ./packages/opencorvus/test/prompt/interactive-artifact-guidance.test.ts`: passed, 2 tests and 4 assertions.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run docs:check`: passed, 315 operations across 24 groups.
- `git diff --check`: passed.
- The three historical-document commands named by the repository instructions were attempted exactly. Their referenced files no longer exist on this branch, so Bun reported that no test files matched; no success is claimed for those retired paths. The available current documentation checker passed.
- No UI automation test was added, modified, or run.

The second-pass review confirmed that the implementation changes only the shared Prompt presentation decision. It does not change MCP App binding, `ui://` validation, Host lifecycle, permission handling, or provider-specific behavior. The Prompt reuses an automatic `mcp-app@1` as the single presentation for its Tool result and only asks the model to choose a native renderer for ordinary structured multi-item MCP results when interaction materially improves review.
