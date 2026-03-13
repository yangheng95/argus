import { Config } from "@/config/config"

type ClarificationQuestion = {
  header?: string
  question: string
  context?: string
  default_assumption?: string
}

type Assumption = {
  question: string
  assumption: string
}

function enabled(value: string | undefined) {
  return value === "1" || value === "true"
}

export async function unattendedProject() {
  if (enabled(process.env.OPENCORVUS_UNATTENDED)) return true
  const config = await Config.get().catch(() => undefined)
  return config?.experimental?.unattended === true
}

function assumptionText(item: ClarificationQuestion) {
  const text = item.default_assumption?.trim()
  if (text) return text
  return "Use reasonable defaults consistent with the task request, continue execution, and document the assumption."
}

export function clarificationAssumptions(questions: ClarificationQuestion[]) {
  const seen = new Set<string>()
  return questions.flatMap((item) => {
    const question = item.question?.trim()
    if (!question) return []
    const assumption = assumptionText(item)
    const key = `${question}\u0000${assumption}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ question, assumption }]
  })
}

function mergeAssumptions(existing: Assumption[] | undefined, questions: ClarificationQuestion[]) {
  const seen = new Set<string>()
  return [...(existing ?? []), ...clarificationAssumptions(questions)].flatMap((item) => {
    const question = item.question?.trim()
    const assumption = item.assumption?.trim()
    if (!question || !assumption) return []
    const key = `${question}\u0000${assumption}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ question, assumption }]
  })
}

function assumptionSection(questions: ClarificationQuestion[]) {
  if (questions.length === 0) return ""
  const body = clarificationAssumptions(questions)
    .map((item, index) => `${index + 1}. ${item.question}\n   Assumption: ${item.assumption}`)
    .join("\n\n")
  if (!body) return ""
  return `## Auto-Assumed Clarifications\n\n${body}`
}

export function suppressClarifications<T extends {
  clarifications?: ClarificationQuestion[]
  assumptions?: Assumption[]
  content?: string
}>(input: T) {
  const questions = Array.isArray(input.clarifications)
    ? input.clarifications.filter((item) => item && typeof item === "object" && typeof item.question === "string" && item.question.trim())
    : []
  if (questions.length === 0) return input
  const section = assumptionSection(questions)
  const content =
    typeof input.content === "string" && section && !input.content.includes("## Auto-Assumed Clarifications")
      ? `${input.content.trim()}\n\n${section}`
      : input.content
  return {
    ...input,
    content,
    assumptions: mergeAssumptions(input.assumptions, questions),
    clarifications: [],
  }
}
