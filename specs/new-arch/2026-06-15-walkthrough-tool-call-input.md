# Walkthrough Tool Call Input

Date: 2026-06-15
Status: implementation plan

## Acronyms

- SDK: Software Development Kit, here the AI SDK stream event contract.
- LLM: Large Language Model, the model producing the walkthrough tool call.

## Problem

`translateScenarioToSteps` reads `part.args` from `fullStream` `tool-call`
events. AI SDK v6 emits parsed tool-call input on `part.input`, so real
walkthrough translation can fail even though tests pass with an old mock shape.

## Call Point Sweep

| Surface | Call point | Decision |
| --- | --- | --- |
| Translator | `packages/opencorvus/src/acceptance/checks/walkthrough/translate.ts` `fullStream` loop | Parse `part.input` for `tool-call` events. |
| Type guard | `translate.ts` `isToolCallPart` | Guard `input`, not retired `args`. |
| Tests | `packages/opencorvus/src/acceptance/checks/walkthrough/translate.test.ts` | Use real AI SDK v6 `input` shape in success/failure tests and assert retired `args` alone does not satisfy the translator. |

## Acceptance

- Real `tool-call` stream parts with `input.steps` translate successfully.
- Invalid real `input.steps` still fails validation.
- A retired `args`-only mock does not mask the regression.
