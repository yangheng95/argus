import z from "zod"
import type { ZodType } from "zod"

export namespace BusEvent {
  export type NotifyTier = 1 | 2 | 3
  export const NotifyDescriptorSchema = z.object({
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    badge: z.boolean().optional(),
  })
  export type NotifyDescriptor = z.infer<typeof NotifyDescriptorSchema>
  export type NotifyResolver<Properties extends ZodType> = (
    payload: z.infer<Properties>,
  ) => NotifyDescriptor | undefined

  export interface Definition<Type extends string = string, Properties extends ZodType = ZodType> {
    type: Type
    properties: Properties
    notify?: NotifyDescriptor | NotifyResolver<Properties>
  }

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(
    type: Type,
    properties: Properties,
    notify?: NotifyDescriptor | NotifyResolver<Properties>,
  ) {
    const result = {
      type,
      properties,
      notify,
    }
    registry.set(type, result)
    return result
  }

  export function resolveNotify(type: string, payload: Record<string, unknown>): NotifyDescriptor | undefined {
    const def = registry.get(type)
    if (!def?.notify) return undefined
    const descriptor = typeof def.notify === "function" ? def.notify(def.properties.parse(payload)) : def.notify
    return descriptor ? NotifyDescriptorSchema.parse(descriptor) : undefined
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
          .toArray() as any,
      )
      .meta({
        ref: "Event",
      })
  }
}
