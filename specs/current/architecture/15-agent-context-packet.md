# 15 — Agent Context Packet Protocol

> Code authority: `packages/opencorvus/src/agent/context-packet.ts`.
> Primary runtime consumers include Build, Architect, Requirements,
> Integrity, Visual QA, Fact Check, Explore, and Intent Analysis agent
> prompt builders.

`AgentContextPacket` is the shared context protocol for scheduler-to-worker
and worker-to-worker evidence handoff. It is the single internal contract for
portable text, structured data, and multimodal references carried into agent
prompts. It is not a provider message-part format and it is not a workflow
state machine.

## Packet Shape

Each packet has:

| Field | Meaning |
| --- | --- |
| `id` | Stable packet identifier for diagnostics and prompt references. |
| `title` | Human-readable section title. |
| `source` | Optional provenance label only. Consumers must not route by it. |
| `scope` | Optional evidence scope: `task`, `goal`, `goal_run`, or `session`. |
| `parts` | Ordered `text`, `media_ref`, or `structured` parts. |

The part union is intentionally small:

| Part | Contract |
| --- | --- |
| `text` | Human-readable evidence or instructions. Text is readable context, not a machine routing key. |
| `media_ref` | Link/index reference to image, audio, video, or file evidence. It must carry a `url` and `mime`; semantic grouping belongs in a structured part, not on the media ref. |
| `structured` | Machine-readable typed payload selected by `schema`, with optional `label` and `summary` for prompt readability. |

## Multimodal Rule

Multimodal evidence is reference-based. Packets may point to an attachment,
Browser Preview evidence row, source file, local path, or external URL, but
they must not inline image, audio, video, PDF, or arbitrary binary bytes.

`AgentContextPacket` validation rejects inline payloads recursively across:

- text parts;
- packet metadata;
- media ref metadata and scope ids;
- structured part schema, label, summary, and data.

Inline `data:` URLs and likely base64 blobs are forbidden in packets. Provider
adapters may still materialize stored attachments into provider-specific bytes
at the model boundary, but that is outside the agent context protocol.

## Formal Report Evidence Refs

Worker reports that persist evidence edges, such as Visual QA findings,
coverage rows, production blockers, DOM problem regions, and reference parity
rows, use the stricter durable evidence ref protocol in
`packages/opencorvus/src/evidence/ref.ts`.

Formal report refs must be portable across worker sessions, task replay,
isolated workspaces, and database-backed context reconstruction. They may use
OpenCorvus evidence namespaces such as `browser_preview_evidence:*`,
`frontend_research:*`, `deep_research:*`, `frontend_design:*`,
`build_attempt_outcome:*`, `integrity_attempt:*`, `decision_log:*`, or
`visual_qa:*`, or AttachmentStore URLs under `/attachment/<project>/<name>`.

They must not use bare filesystem paths, `file://` URLs, command text, raw
`art_*` ids without a namespace, `screenshot://` local labels, or side-by-side
PNG paths as formal reference-comparison refs. If a worker needs to carry an
image or command artifact into a later repair agent, it must first persist it
through Browser Preview evidence or AttachmentStore, then cite that durable ref
in the report.

## Structured Schema Rule

Machine-readable handoff intent lives in `structured.schema`, not in producer
names, prose markers, filenames, or workflow stage names. Schema names are
namespaced and versioned, for example:

```text
opencorvus.integrity.replay_context.v1
opencorvus.build.repair_contract.v1
opencorvus.build.evidence.v1
opencorvus.visual_qa.dispatch_context.v1
opencorvus.context.visual_handoff.v1
```

Consumers must select packet data with the shared schema helpers, such as
`agentContextStructuredPartBySchema(...)`,
`agentContextStructuredPartsBySchema(...)`, or
`agentContextPacketTextByStructuredSchema(...)`.

`source`, `label`, `title`, and free-text summaries are provenance or
readability hints. They must not become routing contracts. `media_ref` has no
`role` field; producers that need semantic grouping must put that grouping in
the versioned structured payload.

## Workflow Boundary

The scheduler decides which packets are relevant for a worker turn. The packet
schema itself must stay workflow-neutral:

- no packet schema may mean "pipeline only" or "direct only";
- no consumer may infer behavior from the active workflow id;
- no producer may compensate for missing scheduler inputs by creating a
  workflow-specific packet variant;
- redispatch and continuation may carry packets, but the scheduler binding
  remains the only workflow declaration.

When a new expert squad, workflow, or worker role needs context, it should use
the same packet array and add a namespaced structured schema only for the new
evidence contract. It should not add a parallel context protocol or a
role-specific packet alias.

Concrete schema helpers live outside `agent/context-packet.ts`. For example,
the visual handoff contract is implemented by
`packages/opencorvus/src/context-packets/visual-handoff.ts`; the core packet
module only owns packet shape, rendering, schema lookup helpers, and validation.

## Extension Checklist

Add a new packet contract only when a real producer/consumer evidence contract
exists. The change must include:

1. A namespaced, versioned `structured.schema` string.
2. Producer code that emits `AgentContextPacket`.
3. Consumer code that selects by structured schema, not by `source` or prose.
4. Validation that rejects inline media or base64 payloads before rendering.
5. Focused tests for producer, consumer, rejection of inline payloads, and
   source-label independence.
6. A note in this chapter or a linked current architecture chapter if the
   schema changes the platform contract.

Do not introduce a broad catch-all task manipulation tool or a workflow-specific
context tool to move this data. Context remains data; lifecycle decisions stay
with the scheduler/orchestrator tools already responsible for dispatch,
redispatch, task completion, failure, and user questions.

## Current Anti-Patterns

The following are not valid context protocol extensions:

- marker text such as `visual_qa_dispatch_json:` or prose / regex checks for
  role strings such as `source_baseline_input`;
- private aliases such as `VisualQaContextPacket`;
- consumer checks such as `packet.source === "integrity"`;
- routing by a media ref role, filename, or side-by-side PNG path;
- direct private inputs that bypass `contextPackets`, such as passing Integrity
  replay data outside `integrityReplayContextPacket(...)`;
- inline `data:*` or base64 payloads in packet text, metadata, media refs, or
  structured data.

## Verification

Protocol regressions are covered by:

```bash
bun test packages/opencorvus/test/agent/context-packet.test.ts
bun test packages/opencorvus/test/agent/subagent-infrastructure-homogeneity.test.ts
bun test packages/opencorvus/test/build-agent/prompt-context.test.ts
bun test packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts
bun test packages/opencorvus/test/integrity/replay-context.test.ts
bun test packages/opencorvus/test/visual-qa/context.test.ts
```
