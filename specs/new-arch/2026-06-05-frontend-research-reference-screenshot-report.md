# Frontend Research Reference Screenshot Report Contract

## Problem

`frontend-research` already asks the host to prepare rendered webpage evidence for source URLs, and that evidence package includes `reference.png`. The research prompt still describes missing visual captures as a normal `reference_image_evidence_ids: []` path and does not require the final research bundle to tell downstream implementation agents to code against the captured reference image. This lets the report omit the screenshot as a first-class implementation source even when the host captured it.

## Callpoint Inventory

| Surface | Current role | Change |
| --- | --- | --- |
| `packages/opencorvus/src/frontend-research/agent.ts` | Configures source URL evidence preparation through `prepareWebpageEvidence: "always-for-source-url"`. | Preserve. |
| `packages/opencorvus/src/research/agent.ts` | Calls `prepareWebpagePrdEvidence` before the session and injects `renderWebpagePrdEvidencePromptSection`. | Preserve. |
| `packages/opencorvus/src/research/webpage-prd-evidence.ts` | Reads complete webpage evidence/source package and renders prompt context with `Visual reference image`. | Add an explicit reference screenshot evidence id and report-writing instruction. |
| `packages/opencorvus/src/research/output-tools.ts` | Collects model-registered evidence, webpage contract source, and bundle sections. | Preserve schema-level empty-array support for non-visual research; prompt now forbids empty references when host evidence exists. |
| `packages/opencorvus/src/research/schema.ts` | Validates webpage contract reference ids against registered evidence ids. | Preserve. |
| `packages/opencorvus/src/prompt/core/frontend-research-core.txt` | Role prompt permits empty `reference_image_evidence_ids`. | Clarify that source URL prepared evidence must register the captured screenshot and include report guidance. |
| `packages/opencorvus/test/research/webpage-prd-evidence.test.ts` | Verifies prepared evidence prompt and artifact list. | Assert screenshot id/path and downstream implementation guidance. |
| `packages/opencorvus/test/frontend-research/agent.test.ts` | Pins frontend-research config and prompt behavior. | Replace missing-capture permissive assertion with source URL screenshot/report contract assertions. |
| `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts` | Pins broad prompt hygiene. | Update if line budget or required prompt text changes. |
| `packages/opencorvus/test/research/output-tools.test.ts` | Verifies generic collector supports empty reference image ids. | Preserve because generic/non-visual collectors still need an honest no-capture representation. |

## Decision

Keep screenshot acquisition in the host-prepared webpage evidence pipeline. For source URL `frontend-research`, the injected prompt names `web-clone-source/reference.png` as the captured visual reference and assigns a stable evidence id. The agent must register that screenshot as evidence, put the id into `webpage_contract.reference_image_evidence_ids`, cite it in visual/layout/style/fidelity work packets, and write a bundle point saying downstream code must reference the image while implementing.

This is not a new host gate or fallback. The single source remains the task-scoped frontend-design evidence package. The change makes the existing captured image visible and binding in the frontend-research artifact.

## Validation

- Prompt rendering test covers reference screenshot evidence id, path, and report instruction.
- Frontend-research agent prompt test covers source URL prepared evidence registration and report guidance.
- Existing generic output-tool test keeps the no-capture empty-array path for collectors without prepared visual evidence.
