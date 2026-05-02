export type DeliveryRetryFeedbackDetail = {
  category: string
  error: string
  file?: string
  suggestion?: string
  visual_spec_id?: string
}

export function composeDeliveryRetryFeedback(input: {
  iteration: number
  verdict: string
  summary: string
  manifestFailureDetails: string[]
  ownDetails: DeliveryRetryFeedbackDetail[]
}) {
  const detailLines = input.ownDetails.map((detail) => {
    const parts: string[] = [`[${detail.category}] ${detail.error}`]
    if (detail.file) parts.push(`(file: ${detail.file})`)
    if (detail.suggestion) parts.push(`suggestion: ${detail.suggestion}`)
    if (detail.visual_spec_id) parts.push(`visual_spec: ${detail.visual_spec_id}`)
    return `- ${parts.join(" ")}`
  })
  return [
    `Delivery agent rejected the integrated deliverable (iteration ${input.iteration}, agent_verdict=${input.verdict}).`,
    `Task-level summary: ${input.summary}`,
    ...(input.manifestFailureDetails.length > 0
      ? [
          "Host manifest gate failures:",
          ...input.manifestFailureDetails.map((item) => `- ${item}`),
        ]
      : []),
    "Issues attributed to this goal:",
    ...detailLines,
  ].join("\n")
}
