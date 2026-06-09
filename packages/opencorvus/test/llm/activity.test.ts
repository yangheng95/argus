import { expect, test } from "bun:test"
import { APICallError } from "ai"
import {
  withLLMActivity,
  LLMActivityError,
  LLMActivityAbortedError,
  DefaultLLMActivityPolicy,
  type LLMActivityPolicy,
  type LLMActivityEvent,
} from "../../src/llm/activity"

const CTX = { sessionID: "ses_test", provider: "test-provider", model: "test-model" }

function fastPolicy(over: Partial<LLMActivityPolicy> = {}): LLMActivityPolicy {
  return {
    ...DefaultLLMActivityPolicy,
    totalMs: 5_000,
    idleMs: 200,
    firstByteMs: 200,
    maxRetries: { default: 3, rate_limit: 5 },
    // Tiny backoff so tests verify retry-cap / classification behaviour
    // without the production-grade backoff bleeding into totalMs and
    // misclassifying things as total_timeout. Tests that explicitly want
    // to exercise the totalMs path override this back to something larger.
    backoffMs: () => 10,
    ...over,
  }
}

function record() {
  const events: LLMActivityEvent[] = []
  return { events, sink: (e: LLMActivityEvent) => events.push(e) }
}

function counts(events: LLMActivityEvent[]) {
  return {
    started: events.filter((e) => e.type === "started").length,
    terminal: events.filter((e) => e.type === "terminal").length,
    retries: events.filter((e) => e.type === "retry").length,
    heartbeats: events.filter((e) => e.type === "heartbeat").length,
    paused: events.filter((e) => e.type === "paused").length,
    resumed: events.filter((e) => e.type === "resumed").length,
  }
}

test("DefaultLLMActivityPolicy uses one hour total and five minute first-byte deadlines", () => {
  expect(DefaultLLMActivityPolicy.totalMs).toBe(60 * 60_000)
  expect(DefaultLLMActivityPolicy.firstByteMs).toBe(5 * 60_000)
})

test("happy path: returns value, exactly one started + one terminal=done", async () => {
  const { events, sink } = record()
  const ext = new AbortController()
  const result = await withLLMActivity(
    CTX,
    fastPolicy(),
    ext.signal,
    async (run) => {
      run.bump("text-delta")
      run.bump("text-delta")
      return 42
    },
    sink,
  )
  expect(result).toBe(42)
  const c = counts(events)
  expect(c.started).toBe(1)
  expect(c.terminal).toBe(1)
  expect(c.retries).toBe(0)
  // first-byte synthesized + 2 explicit text-delta heartbeats
  expect(c.heartbeats).toBeGreaterThanOrEqual(3)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("done")
})

test("first_byte timeout retries and eventually succeeds", async () => {
  const { events, sink } = record()
  let calls = 0
  const result = await withLLMActivity(
    CTX,
    fastPolicy({ firstByteMs: 100, idleMs: 50 }),
    new AbortController().signal,
    async (run) => {
      calls++
      if (calls < 2) {
        // never bump → first-byte gate trips
        await new Promise<void>((resolve, reject) => {
          run.signal.addEventListener("abort", () => reject(run.signal.reason), { once: true })
        })
      }
      run.bump("text-delta")
      return "ok"
    },
    sink,
  )
  expect(result).toBe("ok")
  expect(calls).toBe(2)
  const retryEvent = events.find((e) => e.type === "retry") as Extract<LLMActivityEvent, { type: "retry" }>
  expect(retryEvent.cls).toBe("first_byte")
  expect(retryEvent.attempt).toBe(1)
})

test("idle timeout retries and eventually succeeds", async () => {
  const { events, sink } = record()
  let calls = 0
  const result = await withLLMActivity(
    CTX,
    fastPolicy({ firstByteMs: 200, idleMs: 100 }),
    new AbortController().signal,
    async (run) => {
      calls++
      run.bump("text-delta") // first byte → idle gate starts
      if (calls < 2) {
        await new Promise<void>((resolve, reject) => {
          run.signal.addEventListener("abort", () => reject(run.signal.reason), { once: true })
        })
      }
      run.bump("text-delta")
      return "ok"
    },
    sink,
  )
  expect(result).toBe("ok")
  const retry = events.find((e) => e.type === "retry") as Extract<LLMActivityEvent, { type: "retry" }>
  expect(retry.cls).toBe("idle")
})

test("rate_limit retries up to maxRetries then fails with cls=rate_limit", async () => {
  const { events, sink } = record()
  let calls = 0
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy({ maxRetries: { default: 2, rate_limit: 2 } }),
      new AbortController().signal,
      async () => {
        calls++
        throw new APICallError({
          message: "Provider returned HTTP 429: too many requests.",
          url: "https://example/test",
          requestBodyValues: undefined,
          statusCode: 429,
          responseHeaders: { "retry-after": "1" },
          responseBody: '{"error":{"message":"too many requests"}}',
        })
      },
      sink,
    ),
  ).rejects.toBeInstanceOf(LLMActivityError)
  expect(calls).toBe(3) // attempt 0, 1, 2 — then no more retries
  const retries = events.filter((e) => e.type === "retry") as Extract<LLMActivityEvent, { type: "retry" }>[]
  expect(retries.length).toBe(2)
  for (const r of retries) expect(r.cls).toBe("rate_limit")
  // monotonically increasing attempt
  expect(retries.map((r) => r.attempt)).toEqual([1, 2])
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("failed")
  expect(term.cls).toBe("rate_limit")
})

test("quota-exhausted 429 does not retry", async () => {
  const { events, sink } = record()
  let calls = 0
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy({ maxRetries: { default: 2, rate_limit: 2 } }),
      new AbortController().signal,
      async () => {
        calls++
        throw new APICallError({
          message:
            "Provider alibaba-coding-plan-cn returned HTTP 429: usage allocated quota exceeded. please try again later.",
          url: "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
          requestBodyValues: undefined,
          statusCode: 429,
          responseHeaders: {},
          responseBody: '{"error":{"message":"usage allocated quota exceeded. please try again later."}}',
        })
      },
      sink,
    ),
  ).rejects.toBeInstanceOf(LLMActivityError)
  expect(calls).toBe(1)
  expect(events.filter((e) => e.type === "retry").length).toBe(0)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("failed")
  expect(term.cls).toBe("quota_exhausted")
})

test("rate_limit succeeds after some retries", async () => {
  const { events, sink } = record()
  let calls = 0
  const result = await withLLMActivity(
    CTX,
    fastPolicy({ maxRetries: { default: 5, rate_limit: 5 } }),
    new AbortController().signal,
    async () => {
      calls++
      if (calls < 3) {
        throw new APICallError({
          message: "429",
          url: "https://example",
          requestBodyValues: undefined,
          statusCode: 429,
          responseHeaders: {},
          responseBody: "rate limit",
        })
      }
      return "ok"
    },
    sink,
  )
  expect(result).toBe("ok")
  expect(calls).toBe(3)
  expect(events.filter((e) => e.type === "retry").length).toBe(2)
})

test("client_4xx (status=400) does NOT retry", async () => {
  const { events, sink } = record()
  let calls = 0
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy(),
      new AbortController().signal,
      async () => {
        calls++
        throw new APICallError({
          message: "bad request",
          url: "https://example",
          requestBodyValues: undefined,
          statusCode: 400,
          responseHeaders: {},
          responseBody: "bad",
        })
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)
  expect(calls).toBe(1)
  expect(events.filter((e) => e.type === "retry").length).toBe(0)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("failed")
  expect(term.cls).toBe("client_4xx")
})

test("context_overflow (status=400 with body wording) does NOT retry", async () => {
  const { events, sink } = record()
  let calls = 0
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy(),
      new AbortController().signal,
      async () => {
        calls++
        throw new APICallError({
          message: "request rejected",
          url: "https://example",
          requestBodyValues: undefined,
          statusCode: 400,
          responseHeaders: {},
          responseBody: '{"error":"prompt is too long; maximum context length is 200000 tokens"}',
        })
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)
  expect(calls).toBe(1)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.cls).toBe("context_overflow")
})

test("Alibaba input length overflow is classified as non-retryable context_overflow", async () => {
  const { events, sink } = record()
  let calls = 0
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy(),
      new AbortController().signal,
      async () => {
        calls++
        throw new APICallError({
          message:
            "Provider alibaba-coding-plan-cn returned HTTP 400: InternalError.Algo.InvalidParameter: Range of input length should be [1, 258048]",
          url: "https://example",
          requestBodyValues: undefined,
          statusCode: 400,
          responseHeaders: {},
          responseBody:
            '{"message":"InternalError.Algo.InvalidParameter: Range of input length should be [1, 258048]"}',
        })
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)
  expect(calls).toBe(1)
  expect(events.filter((e) => e.type === "retry").length).toBe(0)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.cls).toBe("context_overflow")
})

test("request_timeout (HTTP 408) does NOT retry — distinct from idle", async () => {
  const { events, sink } = record()
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy(),
      new AbortController().signal,
      async () => {
        throw new APICallError({
          message: "upstream timeout",
          url: "https://example",
          requestBodyValues: undefined,
          statusCode: 408,
          responseHeaders: {},
          responseBody: "",
        })
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.cls).toBe("request_timeout")
})

test("tls error retries up to default cap then fails with cls=tls", async () => {
  const { events, sink } = record()
  let calls = 0
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy({ maxRetries: { default: 2 } }),
      new AbortController().signal,
      async () => {
        calls++
        throw new Error("Error: unknown certificate verification error")
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)
  expect(calls).toBe(3)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.cls).toBe("tls")
})

test("external abort during attempt → terminal aborted (LLMActivityAbortedError)", async () => {
  const { events, sink } = record()
  const ext = new AbortController()
  const promise = withLLMActivity(
    CTX,
    fastPolicy(),
    ext.signal,
    async (run) => {
      run.bump("text-delta")
      await new Promise<void>((resolve, reject) => {
        run.signal.addEventListener("abort", () => reject(run.signal.reason), { once: true })
      })
      return "should not reach"
    },
    sink,
  )
  await new Promise((r) => setTimeout(r, 20))
  ext.abort(new Error("user cancel"))
  await expect(promise).rejects.toBeInstanceOf(LLMActivityAbortedError)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("aborted")
  expect(term.cls).toBe("external_abort")
})

test("external abort during backoff sleep → terminal aborted", async () => {
  const { events, sink } = record()
  const ext = new AbortController()
  const promise = withLLMActivity(
    CTX,
    fastPolicy({ maxRetries: { default: 5 } }),
    ext.signal,
    async () => {
      // Always fail with a retryable error (network) so we enter backoff sleep
      throw new Error("ECONNRESET")
    },
    sink,
  )
  // Let the first attempt fail and runner enter sleep, then abort.
  await new Promise((r) => setTimeout(r, 30))
  ext.abort(new Error("user cancel"))
  await expect(promise).rejects.toBeInstanceOf(LLMActivityAbortedError)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("aborted")
})

test("total_timeout terminates with cls=total_timeout when retries keep failing past totalMs", async () => {
  const { events, sink } = record()
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy({ totalMs: 250, maxRetries: { default: 100 }, idleMs: 50, firstByteMs: 50 }),
      new AbortController().signal,
      async () => {
        throw new Error("ECONNRESET")
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("failed")
  expect(term.cls).toBe("total_timeout")
})

test("total deadline does not advance while activity is paused for a tool call", async () => {
  const { events, sink } = record()
  const result = await withLLMActivity(
    CTX,
    fastPolicy({ totalMs: 60, firstByteMs: 50, idleMs: 50, maxRetries: { default: 0 } }),
    new AbortController().signal,
    async (run) => {
      run.bump("first-byte")
      run.pause("tool-call")
      await new Promise((r) => setTimeout(r, 120))
      expect(run.signal.aborted).toBe(false)
      run.resume("tool-call")
      return "done"
    },
    sink,
  )

  expect(result).toBe("done")
  const c = counts(events)
  expect(c.paused).toBe(1)
  expect(c.resumed).toBe(1)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("done")
})

test("total deadline resumes after a paused tool call", async () => {
  const { events, sink } = record()
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy({ totalMs: 50, firstByteMs: 50, idleMs: 200, maxRetries: { default: 0 } }),
      new AbortController().signal,
      async (run) => {
        run.bump("first-byte")
        run.pause("tool-call")
        await new Promise((r) => setTimeout(r, 80))
        run.resume("tool-call")
        await new Promise((r) => setTimeout(r, 80))
        run.signal.throwIfAborted()
        return "unreachable"
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)

  const c = counts(events)
  expect(c.paused).toBe(1)
  expect(c.resumed).toBe(1)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("failed")
  expect(term.cls).toBe("total_timeout")
})

test("total deadline beats a successful return when attempt does not check signal", async () => {
  const { events, sink } = record()
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy({ totalMs: 30, firstByteMs: 50, idleMs: 200, maxRetries: { default: 0 } }),
      new AbortController().signal,
      async (run) => {
        run.bump("first-byte")
        await new Promise((r) => setTimeout(r, 80))
        return "late-success"
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)

  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("failed")
  expect(term.cls).toBe("total_timeout")
})

test("external abort during pause beats a successful return", async () => {
  const { events, sink } = record()
  const ext = new AbortController()
  const promise = withLLMActivity(
    CTX,
    fastPolicy({ totalMs: 100, firstByteMs: 50, idleMs: 50, maxRetries: { default: 0 } }),
    ext.signal,
    async (run) => {
      run.bump("first-byte")
      run.pause("tool-call")
      await new Promise((r) => setTimeout(r, 30))
      ext.abort(new Error("operator cancel"))
      await new Promise((r) => setTimeout(r, 30))
      run.resume("tool-call")
      return "late-success"
    },
    sink,
  )

  await expect(promise).rejects.toThrow(LLMActivityAbortedError)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("aborted")
  expect(term.cls).toBe("external_abort")
})

test("policy accepts firstByteMs below idleMs because the gates cover different phases", async () => {
  const { events, sink } = record()
  const result = await withLLMActivity(
    CTX,
    fastPolicy({ firstByteMs: 50, idleMs: 100 }),
    new AbortController().signal,
    async (run) => {
      run.bump("text-delta")
      return "ok"
    },
    sink,
  )
  expect(result).toBe("ok")
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("done")
})

test("production default policy is internally valid", async () => {
  const { events, sink } = record()
  const result = await withLLMActivity(
    CTX,
    DefaultLLMActivityPolicy,
    new AbortController().signal,
    async (run) => {
      run.bump("text-delta")
      return "ok"
    },
    sink,
  )
  expect(result).toBe("ok")
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.outcome).toBe("done")
})

test("invariant: exactly one started + one terminal regardless of path", async () => {
  // Mix of paths: success, retry-then-success, retry-then-fail.
  const paths: Array<() => Promise<unknown>> = [
    async () => {
      const { events, sink } = record()
      await withLLMActivity(
        CTX,
        fastPolicy(),
        new AbortController().signal,
        async (r) => {
          r.bump("text-delta")
          return 1
        },
        sink,
      )
      return events
    },
    async () => {
      const { events, sink } = record()
      let n = 0
      await withLLMActivity(
        CTX,
        fastPolicy({ maxRetries: { default: 5 } }),
        new AbortController().signal,
        async () => {
          n++
          if (n < 2) throw new Error("ECONNRESET")
          return 1
        },
        sink,
      )
      return events
    },
    async () => {
      const { events, sink } = record()
      try {
        await withLLMActivity(
          CTX,
          fastPolicy({ maxRetries: { default: 1 } }),
          new AbortController().signal,
          async () => {
            throw new Error("ECONNRESET")
          },
          sink,
        )
      } catch {
        /* expected */
      }
      return events
    },
  ]
  for (const p of paths) {
    const events = (await p()) as LLMActivityEvent[]
    const c = counts(events)
    expect(c.started).toBe(1)
    expect(c.terminal).toBe(1)
  }
})

test("retry attempt counter is monotonically increasing", async () => {
  const { events, sink } = record()
  await withLLMActivity(
    CTX,
    fastPolicy({ maxRetries: { default: 5 } }),
    new AbortController().signal,
    (() => {
      let n = 0
      return async () => {
        n++
        if (n < 4) throw new Error("ECONNRESET")
        return "ok"
      }
    })(),
    sink,
  )
  const attempts = events
    .filter((e) => e.type === "retry")
    .map((e) => (e as Extract<LLMActivityEvent, { type: "retry" }>).attempt)
  expect(attempts).toEqual([1, 2, 3])
})

test("pause/resume suspends idle gate; nested pause requires nested resume", async () => {
  const { events, sink } = record()
  const ext = new AbortController()
  const result = await withLLMActivity(
    CTX,
    fastPolicy({ firstByteMs: 200, idleMs: 80 }),
    ext.signal,
    async (run) => {
      run.bump("text-delta") // first byte → idle gate starts
      run.pause("tool-execution")
      run.pause("nested-tool")
      // Both paused: idle should not trip even after > idleMs.
      await new Promise((r) => setTimeout(r, 200))
      run.resume("nested-tool")
      // Still paused once → still no trip.
      await new Promise((r) => setTimeout(r, 100))
      run.resume("tool-execution")
      run.bump("text-delta")
      return "ok"
    },
    sink,
  )
  expect(result).toBe("ok")
  // Should have at least 2 paused + 2 resumed events; no retry from idle.
  const c = counts(events)
  expect(c.paused).toBe(2)
  expect(c.resumed).toBe(2)
  expect(c.retries).toBe(0)
})

test("heartbeat after terminal does not throw or emit", async () => {
  const { events, sink } = record()
  let runHandle: any
  await withLLMActivity(
    CTX,
    fastPolicy(),
    new AbortController().signal,
    async (run) => {
      runHandle = run
      run.bump("text-delta")
      return "ok"
    },
    sink,
  )
  const beforeCount = events.length
  // After terminal, calling bump should be a no-op.
  runHandle.bump("text-delta")
  runHandle.pause("post")
  runHandle.resume("post")
  expect(events.length).toBe(beforeCount)
})

test("backoff is clamped by remainingTotalMs (no sleep past total deadline)", async () => {
  const { events, sink } = record()
  // totalMs barely larger than first attempt + a tiny sleep
  await expect(
    withLLMActivity(
      CTX,
      fastPolicy({
        totalMs: 150,
        idleMs: 50,
        firstByteMs: 50,
        maxRetries: { default: 5 },
        backoffMs: () => 10_000, // policy says 10s — must be clamped
      }),
      new AbortController().signal,
      async () => {
        throw new Error("ECONNRESET")
      },
      sink,
    ),
  ).rejects.toThrow(LLMActivityError)
  const retry = events.find((e) => e.type === "retry") as Extract<LLMActivityEvent, { type: "retry" }> | undefined
  if (retry) expect(retry.backoffMs).toBeLessThanOrEqual(150)
  const term = events.find((e) => e.type === "terminal") as Extract<LLMActivityEvent, { type: "terminal" }>
  expect(term.cls).toBe("total_timeout")
})

test("classify reads abort cause from marked reason, not from string match", async () => {
  // Force an idle trip and verify the retry's cls is "idle" (not "unknown")
  // even though attemptFn throws a plain Error without TLS/network keywords.
  const { events, sink } = record()
  let calls = 0
  await withLLMActivity(
    CTX,
    fastPolicy({ firstByteMs: 200, idleMs: 80, maxRetries: { default: 3 } }),
    new AbortController().signal,
    async (run) => {
      calls++
      run.bump("text-delta")
      if (calls < 2) {
        // Wait for idle to trip; then throw a generic error (not "ECONNRESET")
        await new Promise<void>((resolve, reject) => {
          run.signal.addEventListener("abort", () => reject(new Error("downstream stopped")), { once: true })
        })
      }
      run.bump("text-delta")
      return "ok"
    },
    sink,
  )
  const retry = events.find((e) => e.type === "retry") as Extract<LLMActivityEvent, { type: "retry" }>
  // If classify were string-matching, "downstream stopped" would map to "unknown".
  // The marker on composed.reason must override that and yield "idle".
  expect(retry.cls).toBe("idle")
})
