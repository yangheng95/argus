import { BusEvent } from "@/bus/bus-event"
import { Message } from "./message"
import z from "zod"

export namespace SessionEvents {
  export const Error = BusEvent.define(
    "session.error",
    z.object({
      sessionID: z.string().optional(),
      error: Message.Assistant.shape.error.unwrap(),
    }),
    { tier: 1 },
  )
}
