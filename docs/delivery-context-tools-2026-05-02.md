# Delivery Context Tool Split — 2026-05-02

## Problem

DeliveryAgent previously placed too much fresh context into the initial user
message. Session history compaction could not reduce that message because it
was newly built for delivery. The largest risky inputs were visual image file
parts, upstream contract text, executor reports, and code diffs.

## Decision

Delivery starts with a compact text-only prompt. The prompt keeps only:

- task title and request
- required evidence facets
- compact visual material counts
- compact goal index
- changed-file sample
- hard gate summaries

Large evidence moves behind delivery tools:

- `compare_visual_artifacts` loads rendered and reference image bytes only when
  visual comparison is needed.
- `inspect_delivery_context` fetches one requested detail section at a time:
  goals, upstream context, manifest, host gates, runtime failures, visual
  failures, executor reports, changed files, diffs, or attachment inventory.

## Non-Goals

- No manifest-failed shortcut. Delivery still owns semantic attribution and must
  submit a verdict.
- No hidden visual comparison prompt. Visual bytes enter the session only through
  an explicit tool call.
- No per-agent duplicate attachment loader. The tool uses `AttachmentStore` and
  the shared delivery multimodal tool-result builder.

## Expected Effect

Visual screenshots no longer consume provider input length at delivery startup.
Large reports and diffs no longer inflate the base prompt; they are pulled only
when the delivery agent decides they are relevant.
