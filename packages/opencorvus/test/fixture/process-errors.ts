import { expect } from "bun:test"

type ProcessErrorEvent = {
  type: "unhandledRejection" | "uncaughtException"
  reason: unknown
}

export async function expectNoProcessErrors(fn: () => Promise<void>, quietMs = 100): Promise<void> {
  const seen: ProcessErrorEvent[] = []
  const onUnhandled = (reason: unknown) => {
    seen.push({ type: "unhandledRejection", reason })
  }
  const onUncaught = (reason: unknown) => {
    seen.push({ type: "uncaughtException", reason })
  }

  process.prependListener("unhandledRejection", onUnhandled)
  process.prependListener("uncaughtException", onUncaught)
  try {
    await fn()
    await Bun.sleep(quietMs)
    expect(
      seen.map((event) => ({
        type: event.type,
        reason: event.reason instanceof Error ? event.reason.message : String(event.reason),
      })),
    ).toEqual([])
  } finally {
    process.off("unhandledRejection", onUnhandled)
    process.off("uncaughtException", onUncaught)
  }
}
