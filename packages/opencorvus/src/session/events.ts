import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { SessionStatus } from "./status"
import { Message } from "./message"

export namespace SessionEvents {
  export const Error = BusEvent.define(
    "session.error",
    z
      .object({
        sessionID: z.string(),
        orderKey: SessionStatus.LifecycleOrderKey,
        channel: z.string().optional(),
        resolvedRole: z.string().optional(),
        goalID: z.string().optional(),
        parentSessionID: z.string().optional(),
        error: Message.Assistant.shape.error.unwrap(),
        summary: z.string().optional(),
      })
      .strict(),
    { tier: 1 },
  )
}
