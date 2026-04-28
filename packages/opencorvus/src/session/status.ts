import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance, lazyInstanceState } from "@/project/instance"
import z from "zod"

export namespace SessionStatus {
  /**
   * Session lifecycle phase. Single source of truth for overlay card spinner
   * state and terminal display — see `specs/new-arch/07-panel-reactivity.md`.
   *
   *   streaming = LLM round-trip in flight (overlay shows spinner)
   *   retry     = streaming, currently sleeping between provider retries
   *   idle      = between turns, awaiting user message / next wake (no spinner)
   *   terminal  = session actor closed; reason explains why
   *
   * Replaces the per-phase `<phase>.completed` bus events that previously
   * served as the only terminal signal for subagent overlay cards.
   */
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("streaming"),
      }),
      z.object({
        type: z.literal("terminal"),
        reason: z.enum(["completed", "error", "aborted"]),
        error: z.string().optional(),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: z.string(),
        status: Info,
      }),
    ),
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: z.string(),
      }),
    ),
  }

  const state = lazyInstanceState(() => {
    const data: Record<string, Info> = {}
    return data
  })

  export function get(sessionID: string) {
    return (
      state()[sessionID] ?? {
        type: "idle",
      }
    )
  }

  export function list() {
    return state()
  }

  export function set(sessionID: string, status: Info) {
    Bus.publish(Event.Status, {
      sessionID,
      status,
    })
    if (status.type === "idle") {
      Bus.publish(Event.Idle, {
        sessionID,
      })
      delete state()[sessionID]
      return
    }
    // Terminal is kept in state (not deleted) so SessionStatus.get() can
    // distinguish a closed session from one that simply has no entry yet.
    // Idle is the default fallback in get(), so we delete idle to avoid
    // unbounded accumulation; terminal is rare and bounded by session count.
    state()[sessionID] = status
  }
}
