# Projected MCP FilePart Convergence

## Recall

### User request

The user asked to repair the `ZodError` that terminated Goal #4 of Task `tsk_f83313890001UugnQXnySAETYW` after a projected Browser MCP (Model Context Protocol, 模型上下文协议) `observe` call returned a screenshot.

### Acceptance criteria

- A screenshot returned by a projected default Browser MCP tool persists as a valid completed Tool Part attachment.
- Projected package MCP image attachments obey the same persisted `Message.FilePart` contract.
- The ordinary MCP, projected package MCP, and projected default MCP paths use one reference-to-FilePart conversion implementation.
- Strict `Message.FilePart` validation remains unchanged; malformed producers are repaired at their ownership boundary.
- The running OpenCorvus process is not restarted or otherwise disturbed without explicit user authorization.

### Hard constraints

- Do not weaken the Zod schema, add fallback/compatibility behavior, or catch and discard the validation error.
- Do not add a gate or host-side routing rule.
- Preserve `AttachmentStore.Reference` as the byte-store contract and `Message.FilePart` as the persisted conversation contract.
- Cover the real projected runtime-tool execution and persisted Tool Part update path, not only a helper unit test.
- Commit subjects must start with `dsw-33987`; push the completed repair to `legacy-remote/v0.0.13beta` without bypassing hooks.

### Read records

- `specs/records/2026-07/2026-07-20-build-agent-browser-mcp-projection.md`: build Agents receive Browser MCP through explicit Expert Squad capability projection.
- `specs/records/2026-07/2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`: projected MCP execution is bound to the current persisted task-tool owner.
- `specs/records/2026-07/2026-07-20-inline-base64-retry-evidence-poison.md`: MCP media bytes must be materialized through `AttachmentStore` rather than persisted inline.

### Runtime evidence

- Session `ses_07c76fa46ffe95Uh7zrt5OB6mC` called projected tool `default_mcp_tool__default_mcp_browser_tool_observe__24f9c323dc60` with screenshot output enabled.
- Tool completion failed at `state.attachments[0].type` with `Invalid input: expected "file"`.
- Because tool execution had already created Parts, the processor correctly refused an in-message retry and surfaced `ProcessorUnsafeRetryError`; the Orchestrator then started a new Goal attempt.
- Separate `unknown certificate verification error` stream failures were also observed, but they are not the attachment Zod failure and are outside this repair's contract.

### Full-repository grep result

`rg` over `materializeMcpToolResult`, `materialized.attachments`, `stampAttachments`, `FilePart.array`, and literal `type: "file"` found these relevant call sites:

| Call site | Existing behavior | Decision |
| --- | --- | --- |
| `src/mcp/materialize.ts::materializeMcpToolResult` | Produces byte-store `AttachmentStore.Reference` values. | Preserve, and own the sole conversion helper beside this producer. |
| `src/session/loop.ts` ordinary MCP wrapper | Locally maps every reference to a stamped `Message.FilePart`. | Replace the local map with the shared conversion helper. |
| `src/expert-squad/prompt-profile-resolver.ts::packageMcpToolFromDefinition` | Returns raw references into the runtime tool result. | Replace with the shared conversion helper using the resolved invocation message identity. |
| `src/expert-squad/prompt-profile-resolver.ts::defaultMcpToolFromConfig` | Returns raw references into the runtime tool result. | Replace with the shared conversion helper using the resolved invocation message identity. |
| `src/session/loop.ts::stampAttachments` | Adds Part identity fields to extra-tool attachments but cannot supply the missing semantic discriminator. | Preserve as the generic extra-tool boundary; projected MCP results will already be complete FileParts. |
| `src/session/message.ts::ToolStateCompleted` | Strictly requires `FilePart[]`. | Preserve unchanged. |
| `test/mcp/materialize-browser-image.test.ts` | Proves bytes and browser metadata materialization only. | Extend with the canonical reference-to-FilePart contract. |
| `test/expert-squad/dynamic-agent-resolver.test.ts` | Exercises projected package/default MCP runtime execution but its fixture did not persist returned attachments. | Make the fixture persist tool attachments and add image cases for both projected paths. |

Other literal `type: "file"` producers found in control, storage, CLI, and web-fetch code do not consume `MaterializedMcpToolResult` and remain unchanged.

### Independent Agent feedback

None. The user did not request sub-Agents or parallel audit, so no delegation was performed.

## Implementation plan

1. Add a typed `materializedMcpAttachmentsToFileParts` conversion beside `materializeMcpToolResult`.
2. Replace all three MCP materialization consumers with that function.
3. Update the projected-tool fixture to persist returned attachments exactly as SessionProcessor does.
4. Add ordinary-helper, projected package MCP, and projected default MCP image regressions that prove strict Tool Part persistence.
5. Run focused tests, package typecheck, historical-document links, applicable document-health checks, and a final diff review.

## Verification

- Regression-first proof: the two projected image tests failed before the production repair with strict Zod issues for `state.attachments[0].id`, `sessionID`, `messageID`, and `type`; the `type` issue exactly matched the reported runtime failure.
- `bun test packages/opencorvus/test/mcp/materialize-browser-image.test.ts packages/opencorvus/test/expert-squad/dynamic-agent-resolver.test.ts`: 38 passed, 0 failed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`: 21 passed, 0 failed.
- `bun run typecheck` in `packages/opencorvus`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`: 87 passed, 0 failed.
- Full resolver execution exposed two stale fixture assertions from the universal `publish_interactive_artifact` and session-scoped MCP ownership changes. The fixture now supplies those current authorities; this is test-contract alignment only and does not add another runtime path.

## Result

- `materializedMcpAttachmentsToFileParts` is the sole MCP byte-store-reference to persisted-message conversion.
- Ordinary SessionLoop MCP, projected package MCP, and projected default MCP consumers all call that conversion.
- Both projected image tests execute through real persisted task-tool ownership and prove that the completed Tool Part stores the exact returned `FilePart` attachment.
- The strict Zod schema and processor unsafe-retry protection remain unchanged.

## Codex second review

- Re-grep found no remaining `materialized.attachments` consumer that bypasses the canonical conversion.
- The conversion intentionally drops `AttachmentStore`-only `sha` and `size` fields because `Message.FilePart` owns conversation identity, MIME (Multipurpose Internet Mail Extensions, 媒体类型), filename, and canonical URL only.
- The repair does not address the independently observed TLS (Transport Layer Security, 传输层安全协议) certificate verification failures; those require a separate proxy trust-chain investigation.
