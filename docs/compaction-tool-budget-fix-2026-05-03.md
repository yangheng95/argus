# Compaction and Tool Payload Budget Fix — 2026-05-03

## Problem

Delivery can still exceed the provider input ceiling after startup prompt
budgeting when an explicit tool call returns a very large result. In the
observed run, a delivery tool result expanded the message payload from roughly
73 KB to roughly 1.39 MB. Predictive compaction then queued compaction, but the
compaction request itself contained the same over-limit history and hit:

```text
Range of input length should be [1, 258048]
```

The session processor treated provider context overflow as "compact again",
including inside the compaction agent, which created a compaction loop and
empty assistant messages.

## Evidence

The r36 trace for delivery session `ses_2167f7090ffcRYP3NHJ8UHHVM2` proves the
payload jump was image-related, not manifest text, changed files, or source
reads:

| trace request | message payload | largest contributors |
| --- | ---: | --- |
| line 12 | 101,047 chars | system prompt 28,037; largest `read_file` 14,604 |
| line 13 | 1,388,794 chars | `verify_page_integrity` tool result 658,790; injected `image/png` file part 656,779 |

The direct mechanism was:

1. `verify_page_integrity` returned `{ text, attachments }` with a screenshot
   data URL.
2. The extra-tool wrapper saw no `output` field and persisted
   `JSON.stringify(r.output ?? r)`, which copied the full
   `attachments[0].url=data:image/png;base64,...` into `state.output`.
3. `Message.toModelMessages` then also converted the same attachment into a
   separate user `file` part for providers that cannot carry media in tool
   results.

That duplicated one screenshot into the delivery context as both text and file,
adding roughly 1.316 MB in one step. Ordinary file reads in the same request
were small by comparison: the largest two `read_file` results were 14.6 KB and
12.8 KB.

## Decision

Use two explicit input boundaries:

1. Delivery screenshot tools return structured text only: path, sha, viewport,
   byte count, dimensions, and pixel variance. Image bytes are loaded only by
   the dedicated `compare_visual_artifacts` tool.
2. Extra-tool result normalization must use `text` as the persisted textual
   output and must never stringify `attachments` into `output`.
3. Delivery screenshot capture viewport is capped inside Puppeteer at 1440x1080.
   This is a browser viewport limit, not a host display resolution change.
4. Predictive compaction logs the largest model-message parts before compacting,
   so future context growth points to the responsible tool or file part.
5. `SessionCompaction` must preflight the exact compaction request payload
   before creating a provider call. If the request already exceeds the model
   input character limit, it records a real error message and stops.
6. The session processor may turn context overflow into compaction only for
   normal agents. Context overflow inside the compaction agent is terminal for
   that compaction attempt.
7. Codebase exploration tool results are capped at the tool boundary. Common
   generated artifact directories are omitted from discovery by default because
   they are not source context and can contain large framework reports.

## Non-Goals

- Do not retry the same over-limit provider request.
- Do not add an LLM summarizer before compaction.
- Do not hide image comparison or generated artifacts in the delivery startup
  prompt. Delivery must explicitly inspect needed evidence through bounded
  tools.
