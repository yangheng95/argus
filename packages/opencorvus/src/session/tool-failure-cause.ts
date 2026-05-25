import z from "zod"

export const ToolFailureClassification = z.enum([
  "tool-input-invalid",
  "tool-execution",
  "llm-activity",
  "processor-contract",
])

export type ToolFailureClassification = z.infer<typeof ToolFailureClassification>

export const ToolFailureCause = z.object({
  kind: z.string().min(1),
  name: z.string().min(1),
  message: z.string().min(1),
  originSite: z.string().min(1),
  classification: ToolFailureClassification,
  data: z.record(z.string(), z.unknown()).optional(),
}).meta({
  ref: "ToolFailureCause",
})

export type ToolFailureCause = z.infer<typeof ToolFailureCause>

export function toolFailureCauseFromUnknown(input: {
  error: unknown
  originSite: string
  classification: ToolFailureClassification
  kind?: string
  data?: Record<string, unknown>
}): ToolFailureCause {
  if (input.error instanceof Error) {
    return {
      kind: input.kind ?? input.classification,
      name: input.error.name || input.classification,
      message: input.error.message,
      originSite: input.originSite,
      classification: input.classification,
      ...(input.data ? { data: input.data } : {}),
    }
  }
  if (typeof input.error === "string" && input.error.length > 0) {
    return {
      kind: input.kind ?? input.classification,
      name: input.classification,
      message: input.error,
      originSite: input.originSite,
      classification: input.classification,
      ...(input.data ? { data: input.data } : {}),
    }
  }
  const parsed = ToolFailureCause.safeParse(input.error)
  if (parsed.success) return parsed.data
  throw new Error(`Tool failure cause at ${input.originSite} did not include an Error or message string`)
}

export function renderToolFailureCause(cause: ToolFailureCause): string {
  const prefix = `${cause.kind}/${cause.name}`
  return `${prefix} at ${cause.originSite}: ${cause.message}`
}
