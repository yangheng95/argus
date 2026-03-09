export function plannerClarification(planDraft: {
  metadata?: Record<string, unknown>
}) {
  const clarification = planDraft.metadata?.clarification
  if (!clarification || typeof clarification !== "object") return
  const meta = clarification as Record<string, unknown>
  const reason = typeof meta.reason === "string" ? meta.reason : "Clarification required before planning."
  const raw = meta.questions
  const questions = Array.isArray(raw)
    ? raw.flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return []
        const row = item as Record<string, unknown>
        if (typeof row.question !== "string" || !row.question.trim()) return []
        return [{
          header: typeof row.header === "string" && row.header.trim() ? row.header : "Clarification",
          question: row.question,
          context: typeof row.context === "string" && row.context.trim() ? row.context : undefined,
          default_assumption:
            typeof row.default_assumption === "string" && row.default_assumption.trim()
              ? row.default_assumption
              : undefined,
        }]
      })
    : []
  if (questions.length === 0) return
  return {
    reason,
    questions,
  }
}
