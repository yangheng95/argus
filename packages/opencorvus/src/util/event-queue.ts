/**
 * Single-source push-based async iterable with chunk-driven idle timeout.
 *
 * Both `executor/managed.ts` and `executor/opencorvus.ts` implement the same
 * ExecutorAdapter.events() shape: "a queue of {type,summary,payload}
 * notifications produced by one source, consumed by one async for-await,
 * stopped on completion OR external abort". Before this module each side
 * hand-rolled the queue/wake/loop — and `opencorvus.ts` in particular had
 * no idle timeout, which left goal runs silently stuck when the upstream
 * TCP went quiet.
 *
 * createEventQueue() is the single implementation. Source code adapts to
 * it via three primitive writes (push / complete / abort); consumers read
 * via the returned `iterable`. The built-in withStreamActivity monitor aborts
 * the stream with a standard AbortError when `idleMs` elapses without a
 * push — the same unwinding path external aborts use.
 *
 * CLAUDE.md #22 (no dual source), #24 (pattern extracted), #1 (no fallback
 * — abort, caller decides), #26 (no options soup: idleMs, signal, label).
 */

import { withStreamActivity } from "./stream-activity"

export interface EventQueue<T> {
  /** Enqueue an event; wakes a parked consumer. No-op after complete/abort. */
  push(item: T): void
  /** Drain remaining buffered items then end the iterable cleanly. Idempotent. */
  complete(): void
  /** End the iterable by throwing `reason` through the consumer. Idempotent. */
  abort(reason: unknown): void
  /** Async iterable surface for the consumer. Single reader. */
  readonly iterable: AsyncIterable<T>
  /** Timestamp of the most recent push (or construction). */
  lastActivityAt(): number
}

export interface EventQueueOptions {
  /** Idle window (no push) before the queue aborts with AbortError. Must be > 0. */
  idleMs: number
  /** External signal; when it aborts the queue ends cleanly unless the signal has an Error reason. */
  signal?: AbortSignal
  /** Log-visible identifier; appears in AbortError messages. */
  label?: string
}

export function createEventQueue<T>(options: EventQueueOptions): EventQueue<T> {
  const buffer: T[] = []
  let done = false
  let aborted: { reason: unknown } | null = null
  let wake: (() => void) | undefined

  const monitor = withStreamActivity({
    idleMs: options.idleMs,
    signal: options.signal,
    label: options.label ?? "event-queue",
  })

  const bumpWake = () => {
    const w = wake
    wake = undefined
    w?.()
  }

  // Monitor abort (idle OR external) wakes the consumer so it can observe.
  const onMonitorAbort = () => bumpWake()
  if (!monitor.signal.aborted) {
    monitor.signal.addEventListener("abort", onMonitorAbort, { once: true })
  }

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<T>> {
          while (true) {
            if (aborted) {
              const reason = aborted.reason
              throw reason instanceof Error ? reason : new Error(String(reason))
            }
            if (buffer.length > 0) {
              return { value: buffer.shift()!, done: false }
            }
            if (done) return { value: undefined, done: true }
            if (monitor.signal.aborted) {
              // External abort with Error reason → throw; otherwise end clean.
              const reason = monitor.signal.reason
              if (reason instanceof Error) throw reason
              return { value: undefined, done: true }
            }
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
        },
        async return(value?: T): Promise<IteratorResult<T>> {
          done = true
          monitor.dispose()
          monitor.signal.removeEventListener("abort", onMonitorAbort)
          return { value: value as T, done: true }
        },
      }
    },
  }

  return {
    push(item) {
      if (done || aborted) return
      buffer.push(item)
      monitor.observe()
      bumpWake()
    },
    complete() {
      if (done || aborted) return
      done = true
      monitor.dispose()
      monitor.signal.removeEventListener("abort", onMonitorAbort)
      bumpWake()
    },
    abort(reason) {
      if (done || aborted) return
      aborted = { reason }
      monitor.dispose()
      monitor.signal.removeEventListener("abort", onMonitorAbort)
      bumpWake()
    },
    get iterable() {
      return iterable
    },
    lastActivityAt() {
      return monitor.lastActivityAt()
    },
  }
}
