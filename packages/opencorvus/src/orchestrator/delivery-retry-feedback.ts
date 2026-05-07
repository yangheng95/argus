export type DeliveryRetryFeedbackDetail = {
  category: string
  error: string
  goal_id?: string
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
  scope?: "goal" | "integrated_tree"
  rawFeedbackPacket?: unknown
}) {
  const scope = input.scope ?? "goal"
  const detailLines = input.ownDetails.map((detail) => {
    const parts: string[] = [`[${detail.category}] ${detail.error}`]
    if (detail.goal_id) parts.push(`goal_id: ${detail.goal_id}`)
    if (detail.file) parts.push(`(file: ${detail.file})`)
    if (detail.suggestion) parts.push(`suggestion: ${detail.suggestion}`)
    if (detail.visual_spec_id) parts.push(`visual_spec: ${detail.visual_spec_id}`)
    return `- ${parts.join(" ")}`
  })
  const issueHeading = scope === "goal"
    ? "Issues attributed to this goal:"
    : "Issues the integrated-tree rework must address:"
  const noIssueLine = scope === "goal"
    ? "- No rejection_details entry was attributed to this goal; use the host manifest failures and the raw packet to decide whether this goal is still implicated."
    : "- Delivery did not provide scoped rejection_details; treat this as a task-scope integrated-tree blocker."
  const rawPacket = input.rawFeedbackPacket === undefined
    ? []
    : [
        "Canonical delivery feedback packet (JSON, copied from persisted artifacts):",
        "```json",
        JSON.stringify(input.rawFeedbackPacket, null, 2),
        "```",
      ]
  return [
    `Delivery agent rejected the integrated deliverable (iteration ${input.iteration}, agent_verdict=${input.verdict}).`,
    `Task-level summary: ${input.summary}`,
    ...(input.manifestFailureDetails.length > 0
      ? [
          "Host manifest gate failures:",
          ...input.manifestFailureDetails.map((item) => `- ${item}`),
        ]
      : []),
    issueHeading,
    ...(detailLines.length > 0 ? detailLines : [noIssueLine]),
    ...rawPacket,
  ].join("\n")
}
