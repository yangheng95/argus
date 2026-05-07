# Codex Plan Todo Rendering Fix - 2026-05-01

## Evidence

- Codex app-server emits structured plan updates as `turn/plan/updated` with `{ explanation?, plan }`.
- Each Codex plan entry is `{ step, status }`, with status values `pending`, `inProgress`, or `completed`.
- `packages/opencorvus/src/executor/codex-app-server.ts` currently maps those updates to `plan_delta`.
- External build card rendering now suppresses `plan_delta` because it is not an actionable build result channel.
- Overlay checklist rendering is intentionally bound to tool parts named `todowrite`, `todoread`, `todoupdate`, or `updateplan`, and reads `state.input.todos` / `state.metadata.todos`.

## Root Cause

Codex plan updates are structured TODO data at the provider boundary, but OpenCorvus flattens them into prose-like `plan_delta` events. That bypasses the single checklist rendering path, so Codex todos are either rendered as text in old builds or hidden after the external narration suppression.

## Fix

- Normalize structured Codex `turn/plan/updated` payloads into a paired `tool_call` / `tool_result` named `update_plan`.
- Store normalized todos under `{ todos }`, using the existing todo tool shape: `{ content, status, priority? }`.
- Preserve `plan_delta` only for non-structured plan text such as experimental `item/plan/delta` and `item/completed` plan text.
- Do not parse markdown or free text into todos.

## Verification

- Add an executor unit test that feeds a structured Codex plan update and asserts `update_plan` tool call/result events contain normalized `todos`.
- Run the Codex app-server executor test suite.
- Run typecheck and existing route/docs checks before commit and push.
