import { test, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Regression for audit §12 (scheduler collaboration audit):
 * the canonical streaming entry point for the orchestrator + every sub-agent
 * is `LLM.stream` in `session/llm.ts`. It MUST go through `@/llm/api`'s
 * wrapped `streamText` so the returned `fullStream` is the Proxy that
 * substitutes `abortableIterable(target.fullStream, composed)` (see
 * `util/stream-activity.ts:80-104` for the docstring on why Bun-fetch
 * reader.read() ignores AbortController.abort while parked on a stalled
 * upstream socket).
 *
 * Pre-fix evidence: three consecutive overlay-bench runs against
 * alibaba-coding-plan-cn/glm-5 (`_session-r5/r6/r7` outputs, 2026-04-30)
 * silently parked architect/requirements streams for 14–25+ min with no
 * abort and no further log output, despite `session_llm_idle_ms = 180_000`
 * in the LLM-activity gate. The signal fired; the for-await consumer in
 * `session/processor.ts:89` could not see it because the unwrapped
 * `streamText` from raw "ai" handed it a non-abortable iterator.
 *
 * Rule 8 — single source. Rule 36 — every fix carries a test.
 */

const LLM_SRC = path.join(import.meta.dir, "..", "..", "src", "session", "llm.ts")

const src = await fs.readFile(LLM_SRC, "utf8")

test("session/llm.ts imports streamText from @/llm/api, not raw ai", () => {
  // The wrapped streamText is the only path that returns the abort-honouring
  // Proxy; the raw "ai" form parks Bun-fetch readers indefinitely.
  expect(src).toMatch(/import\s*\{\s*streamText\s*\}\s*from\s*"@\/llm\/api"/)
  // Negative: the raw "ai" import must NOT bring streamText along. Type-only
  // imports (ModelMessage, StreamTextResult, Tool, ToolSet) are still allowed.
  expect(src).not.toMatch(/import\s*\{[^}]*\bstreamText\b[^}]*\}\s*from\s*"ai"/)
})

test("the streamText call passes timeoutMs: false to disable the wrapper's soft timeout", () => {
  // The wrapper's default 5 s timeout would race the withLLMActivity gate,
  // re-introducing a deterministic 5 s abort on every call. The intended
  // single source for idle / abort decisions is withLLMActivity.
  expect(src).toMatch(/timeoutMs:\s*false/)
})

test("streamText onError publishes session error events for overlay visibility", () => {
  expect(src).toMatch(/onError\(event\)\s*\{[\s\S]*Message\.fromError\(event\.error/)
  expect(src).toMatch(/onError\(event\)\s*\{[\s\S]*Bus\.publish\(SessionEvents\.Error/)
  expect(src).toMatch(/Bus\.publish\(SessionEvents\.Error,[\s\S]*sessionID:\s*input\.sessionID/)
})

test("session system prompt is passed through the SDK system field, not messages", () => {
  expect(src).toMatch(/const\s+systemText\s*=\s*system\.join\("\\n"\)/)
  expect(src).toMatch(/const\s+requestMessages\s*=\s*input\.messages/)
  expect(src).toMatch(/\.\.\.\(isOpenaiOauth\s*\?\s*\{\}\s*:\s*\{\s*system:\s*systemText\s*\}\)/)
  expect(src).not.toMatch(/role:\s*"system"[\s\S]{0,120}content:\s*x/)
})
