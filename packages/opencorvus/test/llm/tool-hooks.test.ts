import { expect, test } from "bun:test"
import z from "zod"
import { createToolInputCapture, createTrackedToolCapture, mergeTextHooks } from "../../src/llm/tool-hooks"

const Sample = z.object({
  summary: z.string(),
  items: z.array(z.string()),
})

test("tool input capture recovers structured args from streamed tool-input deltas", async () => {
  const capture = createToolInputCapture()
  const hooks = mergeTextHooks(capture.hooks)

  await hooks.onChunk?.({
    chunk: {
      type: "tool-input-start",
      id: "call_1",
      toolName: "submit_spec",
    },
  } as never)
  await hooks.onChunk?.({
    chunk: {
      type: "tool-input-delta",
      id: "call_1",
      delta: '{"summary":"Spec","items":["a","b"]}',
    },
  } as never)

  expect(capture.recover("submit_spec", Sample)).toEqual({
    summary: "Spec",
    items: ["a", "b"],
  })
})

test("tool input capture prefers finalized tool-call input when available", async () => {
  const capture = createToolInputCapture()
  const hooks = mergeTextHooks(capture.hooks)

  await hooks.onChunk?.({
    chunk: {
      type: "tool-input-start",
      id: "call_2",
      toolName: "submit_plan",
    },
  } as never)
  await hooks.onChunk?.({
    chunk: {
      type: "tool-call",
      toolCallId: "call_2",
      toolName: "submit_plan",
      input: {
        summary: "Plan",
        items: ["task"],
      },
    },
  } as never)

  expect(capture.recover("submit_plan", Sample)).toEqual({
    summary: "Plan",
    items: ["task"],
  })
})

test("tracked tool capture reports usage and notifies once on the first valid payload", async () => {
  let calls = 0
  const capture = createTrackedToolCapture("submit_spec", Sample, async () => {
    calls += 1
  })
  const hooks = mergeTextHooks(capture.hooks)

  await hooks.onChunk?.({
    chunk: {
      type: "tool-input-start",
      id: "call_3",
      toolName: "submit_spec",
    },
  } as never)
  await hooks.onChunk?.({
    chunk: {
      type: "tool-input-delta",
      id: "call_3",
      delta: '{"summary":"Spec","items":["a"]}',
    },
  } as never)
  await hooks.onChunk?.({
    chunk: {
      type: "tool-call",
      toolCallId: "call_3",
      toolName: "submit_spec",
      input: {
        summary: "Spec",
        items: ["a"],
      },
    },
  } as never)

  expect(calls).toBe(1)
  expect(capture.recover()).toEqual({
    summary: "Spec",
    items: ["a"],
  })
  expect(capture.toolCallCount()).toBe(1)
  expect(capture.toolUsage()).toEqual({
    submit_spec: 1,
  })
})
