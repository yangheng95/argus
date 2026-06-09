# Prompt catalog append display fix

Date: 2026-06-09

## Problem

The Prompts settings tab shows empty Markdown Prompt editors for append-mode
native agents such as `architect` and `frontend-design` when no
`config.agent.<id>.prompt_append` override exists. The backend catalog returns
`prompt: ""` for that state even though the runtime has a non-empty built-in
core prompt and `effective_prompt` is non-empty.

That makes the catalog response look like the prompt loaded from config is
empty, and the UI renders a blank editor for agents that actually have a live
default prompt.

## Call-point inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `PromptCatalog.list()` | `packages/opencorvus/src/config/prompt-catalog.ts` builds `prompt = configuredPrompt ?? (append ? "" : defaultPrompt)`. | Change `prompt` to the current effective prompt for append and override entries. Keep `configured_prompt` as the persisted override or append text. |
| Config route | `packages/opencorvus/src/server/routes/config.ts` returns `PromptCatalog.list()` directly at `GET /config/prompt`. | No route change; fix the catalog source. |
| Prompt settings UI | `packages/overlay/src/components/settings/PromptCatalog.tsx` uses `entry.prompt` for draft value and dirty comparison. | Keep displaying the non-empty effective prompt. |
| Prompt save service | `packages/overlay/src/services/config.ts` writes append entries to `prompt_append`. | For append-mode entries, persist only the exact text after `default_prompt`; clearing or leaving the default deletes `prompt_append`. Reject edits that try to replace the code-owned default core. |
| Tests | `packages/opencorvus/test/agent/role-contract.test.ts` currently asserts append-mode `prompt` is empty. `packages/opencorvus/test/server/config-routes.test.ts` does not cover the no-append case. | Update expectations and add regression coverage for append-mode non-empty `prompt`. Add overlay save conversion coverage. |
