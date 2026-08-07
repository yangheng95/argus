# Tool-result Multimodal Provider Transport Repair — 2026-07-24

## Status

Implemented and verified. The production message projection, official
OpenAI-compatible adapter, Hexin request codec, and live Hexin streaming
gateway all carried the same tool-owned image successfully.

Glossary:

- LLM: Large Language Model, the provider-hosted model process.
- SDK: Software Development Kit.
- MCP: Model Context Protocol.
- MIME: Multipurpose Internet Mail Extensions media type.
- URL: Uniform Resource Locator.
- API: Application Programming Interface.
- P0: priority zero.

## Recall

### User request

1. Prove whether uploaded attachments and images returned by tools are actually
   readable by the selected model.
2. Establish whether `@ai-sdk/openai-compatible` really loses multimodal tool
   results.
3. Fix the P0 defect and determine whether other providers have the same
   problem.

### Acceptance criteria

- A tool-owned image remains a real tool result throughout OpenCorvus history;
  no synthetic user message or hidden message is created.
- The immediate model continuation after a live MCP tool call receives the
  same typed image projection as a later persisted-history replay.
- The persisted attachment remains a compact `AttachmentStore` reference.
- Immediately before provider transmission, the attachment is materialized as
  a typed image content block.
- Hexin receives `role: "tool"` with an array containing `text` and
  `image_url`, not a JSON string containing `image-data`.
- A unique pixel canary in an external image is read by the model without
  project-file, glob, OCR, or repeated `read` escape paths.
- Providers whose selected adapter unambiguously supports image tool results
  are no longer incorrectly stripped by OpenCorvus.
- Providers without a proven typed tool-result media contract remain explicit
  unsupported transports; OpenCorvus does not guess that every
  OpenAI-compatible endpoint accepts the Hexin wire shape.

### Hard constraints

- Preserve every unrelated uncommitted and untracked change in the shared
  worktree.
- Do not restart, refresh, close, or kill the running OpenCorvus or Overlay.
- Keep `AttachmentStore` as the binary single source. Do not persist base64 in
  conversation rows.
- Do not add a fallback, second attachment source, model-name heuristic,
  synthetic user turn, hidden message, or host workflow gate.
- Provider transport support is determined by the installed provider adapter
  or an evidence-backed provider-specific codec.

### Materials read

- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/provider/provider.ts`
- `packages/opencorvus/src/provider/transform.ts`
- `packages/opencorvus/src/provider/bundled.ts`
- `packages/opencorvus/src/provider/vendor.ts`
- `packages/opencorvus/src/provider/github-copilot/**`
- `packages/opencorvus/test/session/message.test.ts`
- `packages/opencorvus/test/provider/request-body-contract.test.ts`
- installed source for `@ai-sdk/openai-compatible@2.0.47`
- installed source for the OpenAI, Azure, Anthropic, Amazon Bedrock, Google,
  Google Vertex, Vercel AI Gateway, OpenRouter, xAI, Groq, Mistral, and Alibaba
  adapters
- official OpenAI Responses, MCP tool-result, AI SDK, and LangChain
  multimodal-content documentation

### Full-repository grep results

| Symbol or contract                         | Call points found                                                                                        | Decision                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supportsMediaInToolResults`               | one local decision in `session/message.ts`; consumed when completed tool attachments are projected       | Move the decision to the provider transform boundary and make it describe real adapter capability.                                                               |
| `attachmentToBase64` / `toModelOutput`     | `session/message.ts` converts persisted tool attachments into AI SDK `image-data`                        | Keep this canonical late materialization path. It already resizes and validates image bytes.                                                                     |
| unsupported tool-media prose               | `session/message.ts` plus one regression in `test/session/message.test.ts`                               | Retain explicit unsupported-provider evidence without claiming the model saw pixels; remove it for transports proven capable.                                    |
| `ProviderTransform.requestBody`            | the provider fetch wrapper in `provider/provider.ts`; focused request-body tests                         | Extend the existing provider-owned request serializer with the Hexin tool-content-array codec.                                                                   |
| `shouldNormalizeRequestBody`               | the same fetch wrapper and focused tests                                                                 | Restrict it to providers that actually have request-body normalization instead of parsing every OpenAI-compatible request.                                       |
| `@ai-sdk/openai-compatible`                | bundled provider registration plus dozens of generated provider catalogs and configured custom providers | Do not change all endpoints. The generic adapter stringifies `ToolModelOutput.content`, while endpoint acceptance of array-valued tool content is not universal. |
| provider-specific multimodal conversion    | native OpenAI Responses, Anthropic, Bedrock, Google/Vertex, Gateway, and OpenRouter adapters             | Allow their typed image path. Preserve unsupported status for chat adapters that stringify and lack a proven endpoint codec.                                     |
| GitHub Copilot custom compatible converter | `provider/github-copilot/chat/**` and Copilot plugin transport                                           | It also stringifies tool content. Keep it unsupported in this change because no equivalent endpoint acceptance probe exists.                                     |

### Independent-agent feedback

No independent agent was requested or authorized under the active
collaboration constraint, so no sub-agent was created. The main agent performed
the repository-wide call-point and installed-adapter audit directly.

## Causal chain

1. A visual MCP tool persists an image attachment as an `AttachmentStore` URL.
2. The live tool path previously installed
   `providerToolResultToModelOutput()` when the MCP tool had no explicit
   converter. That generic converter returned only `output.output`; it
   discarded `attachments`. Consequently, the immediate model continuation
   received no pixels on any provider.
3. A later `Message.toModelMessages()` history replay could read the stored
   URL and produce an AI SDK `ToolModelOutput` with `image-data`.
4. The old local provider allowlist returned false for every
   `@ai-sdk/openai-compatible` model, including Hexin, so the image is removed
   before the adapter sees it and only a path-bearing prose note remains.
5. Removing only that allowlist branch is insufficient:
   `@ai-sdk/openai-compatible@2.0.47` serializes `output.type === "content"` by
   applying `JSON.stringify(output.value)`, making the base64 ordinary text.
6. A direct Hexin gateway probe proved that the endpoint itself accepts
   `role: "tool"` with typed `text` and `image_url` content and reads a unique
   image canary. The same payload stringified as tool text produces no pixel
   access.

The root defect is therefore three-layered: the live provider-tool converter
discarded attachments, history replay prematurely stripped them for affected
providers, and the generic compatible adapter lacked Hexin's supported wire
codec. It is not a model intelligence or attachment-storage failure.

## Provider impact matrix

| Adapter family                              | Installed serializer evidence                                                               | Current OpenCorvus behavior   | Repair decision                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `@ai-sdk/openai` Responses                  | maps `image-data` to `function_call_output.output[].input_image`                            | allowed                       | Keep allowed.                                                                                       |
| `@ai-sdk/azure`                             | defaults to OpenAI Responses but can select Chat Completions through provider configuration | stripped                      | Remain unsupported until the selected Responses-versus-Chat adapter is projected as a runtime fact. |
| `@ai-sdk/anthropic`                         | maps `image-data` to `tool_result.content[].image`                                          | allowed                       | Keep allowed.                                                                                       |
| `@ai-sdk/amazon-bedrock`                    | maps `image-data` to Bedrock tool-result image bytes                                        | allowed                       | Keep allowed.                                                                                       |
| `@ai-sdk/google-vertex/anthropic`           | Anthropic-native tool-result blocks                                                         | allowed                       | Keep allowed.                                                                                       |
| `@ai-sdk/google`                            | Gemini 3 uses `functionResponse.parts`; legacy models receive typed top-level inline data   | Gemini 2 incorrectly stripped | Allow the installed adapter path for image-capable models.                                          |
| `@ai-sdk/google-vertex`                     | reuses `@ai-sdk/google` language conversion                                                 | incorrectly stripped          | Allow.                                                                                              |
| `@ai-sdk/gateway`                           | sends the Language Model V3 typed prompt directly to the gateway                            | incorrectly stripped          | Allow.                                                                                              |
| `@openrouter/ai-sdk-provider`               | explicitly maps tool `image-data` to `image_url`                                            | incorrectly stripped          | Allow.                                                                                              |
| Hexin via `@ai-sdk/openai-compatible`       | generic SDK stringifies; live gateway accepts typed tool content                            | stripped                      | Allow internally and apply the Hexin wire codec.                                                    |
| Other `@ai-sdk/openai-compatible` endpoints | generic SDK stringifies; endpoint acceptance differs and is unproven                        | stripped                      | Remain unsupported until that provider has an explicit codec backed by a live contract test.        |
| xAI/Groq/Mistral/Alibaba chat adapters      | installed converters stringify content tool results                                         | stripped                      | Remain unsupported unless their native protocol and live endpoint are separately proven.            |
| GitHub Copilot compatible chat adapter      | repository converter stringifies content tool results                                       | stripped                      | Remain unsupported; no synthetic attachment prompt is introduced.                                   |

## Implementation

1. Add one provider-transform query for tool-result media transport:
   `native`, `hexin-openai-compatible`, or `unsupported`.
2. Add one shared `Message.toolResultToModelOutput()` projection for both live
   tool execution and persisted history. `prepareProviderTool()` captures the
   selected model and uses this projection whenever a tool does not supply a
   specialized converter.
3. Remove the history-only media decision so both paths use the same
   provider-owned transport contract.
4. Extend `ProviderTransform.requestBody()` for Hexin:
   - inspect only `role: "tool"` content;
   - accept the exact AI SDK content-array schema;
   - map `text` to OpenAI-compatible text;
   - map `image-data` to a `data:<mime>;base64,<data>` `image_url`;
   - map `image-url` directly;
   - reject unsupported content-part types instead of dropping them.
5. Preserve existing Hexin fixed-temperature normalization in the same
   function.
6. Do not mutate requests for other OpenAI-compatible providers.

## Verification coverage

- `Message.toModelMessages()` keeps `image-data` for Hexin without creating a
  synthetic user turn.
- A real `materializeMcpToolResult()` result with an `AttachmentStore` image
  becomes typed `image-data` during the immediate tool continuation.
- The same live result stays explicit tool-owned reference text for an
  unsupported adapter.
- The provider transport matrix covers every unambiguously native adapter
  family listed above.
- Unsupported compatible providers keep the tool-owned attachment reference
  and do not synthesize a user turn.
- The generic compatible converter plus Hexin request normalization produces
  an array-valued `tool.content` containing a valid data URL.
- The same request for a non-Hexin compatible provider remains unchanged.
- Unsupported Hexin content parts fail before network transmission.
- Existing image resize, malformed base64, missing attachment, compaction, and
  provider request-body tests remain green.
- A live Hexin stream reads the external pixel canary through the production
  provider path with no file-system escape path.

## Verification commands

```sh
bun test packages/opencorvus/test/session/message.test.ts
bun test packages/opencorvus/test/provider/request-body-contract.test.ts
bun test packages/opencorvus/test/provider/transform.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun run typecheck
```

## Verification evidence

- Focused provider/session regression suite, including live-tool projection:
  259 passed, 0 failed, 609 assertions.
- Package typecheck: passed.
- Root workspace typecheck, including generated SDK import validation and AI
  runtime dependency validation: passed across 9 of 9 packages.
- Historical documentation link suite: 21 passed, 0 failed.
- Production-path live canary:
  `Message.toModelMessages()` materialized an in-memory PNG as `image-data`;
  the official `@ai-sdk/openai-compatible` adapter serialized it; the
  production Hexin request codec restored array-valued tool content; the live
  Hexin stream read and returned the unique pixel text `TOOL-9XQ7` exactly.
  Observed wire facts were `toolContentArray: true` and `imageUrl: true`.
- The document-health suite reached its real checker. Its remaining failures
  are outside this repair: an existing `EngineEvaluation` architecture term
  and a concurrently authored untracked Mirror Prism record referenced by the
  shared July indexes. This repair's record and links are valid once staged.

No running OpenCorvus or Overlay process was restarted, refreshed, closed, or
killed during verification.
