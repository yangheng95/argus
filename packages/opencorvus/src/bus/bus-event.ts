import z from "zod"
import type { ZodType } from "zod"

export namespace BusEvent {
  export type Definition = ReturnType<typeof define>

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    const result = {
      type,
      properties,
    }
    registry.set(type, result)
    return result
  }

  export function payloads() {
    return z
      .discriminatedUnion(
        "type",
        registry
          .entries()
          .map(([type, def]) => {
            return z
              .object({
                type: z.literal(type),
                properties: def.properties,
              })
              .meta({
                ref: "Event" + "." + def.type,
              })
          })
          // Zod discriminatedUnion requires a non-empty tuple but toArray() returns a generic array;
          // registry is guaranteed non-empty at boot time
          .toArray() as any,
      )
      .meta({
        ref: "Event",
      })
  }
}
