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

function normalized(value: string | undefined) {
  const next = value?.trim().toLowerCase()
  return next ? next : undefined
}

function enabled(value: string | undefined) {
  const next = normalized(value)
  return next === "1" || next === "true"
}

function disabled(value: string | undefined) {
  const next = normalized(value)
  return next === "0" || next === "false"
}

export async function unattendedProject() {
  if (disabled(process.env.OPENCORVUS_UNATTENDED)) return false
  if (enabled(process.env.OPENCORVUS_UNATTENDED)) return true
  const config = await Config.get()
  if (config.experimental?.unattended === false) return false
  return true
}

export const UNATTENDED_AUTO_REPLY =
  "Complete the task autonomously end-to-end. Choose reasonable defaults consistent with the request, keep scope minimal, continue execution, and do not ask again unless the request is contradictory or unsafe."

function assumptionText(item: ClarificationQuestion) {
  const text = item.default_assumption?.trim()
  if (text) return text
  return `${UNATTENDED_AUTO_REPLY} Document the assumption you used.`
}

function clarificationAssumptions(questions: ClarificationQuestion[]) {
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
