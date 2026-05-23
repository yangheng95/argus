import { ProjectRuntimePaths } from "@/project/runtime-paths"

export const USER_REQUEST_PROMPT_WORD_LIMIT = 500
export const USER_REQUEST_BUNDLE_PATH_TEMPLATE = ".opencorvus/runtime/tasks/<taskID>/intent/request.md"
export const USER_REQUEST_BUNDLE_PATH = USER_REQUEST_BUNDLE_PATH_TEMPLATE

const REQUEST_WORD_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+(?:[.'-][\p{L}\p{N}_]+)*|\S/gu

export interface UserRequestExcerpt {
  text: string
  wordCount: number
  omittedWords: number
  truncated: boolean
}

export function excerptUserRequest(
  request: string,
  wordLimit = USER_REQUEST_PROMPT_WORD_LIMIT,
): UserRequestExcerpt {
  if (wordLimit < 1) {
    throw new Error(`excerptUserRequest: wordLimit must be >= 1, got ${wordLimit}`)
  }

  const matches = [...request.matchAll(REQUEST_WORD_PATTERN)]
  const wordCount = matches.length
  if (wordCount <= wordLimit) {
    return {
      text: request.trimEnd(),
      wordCount,
      omittedWords: 0,
      truncated: false,
    }
  }

  const lastIncluded = matches[wordLimit - 1]
  const start = lastIncluded.index
  if (start === undefined) {
    throw new Error("excerptUserRequest: tokenizer match missing index")
  }
  const end = start + lastIncluded[0].length
  return {
    text: request.slice(0, end).trimEnd(),
    wordCount,
    omittedWords: wordCount - wordLimit,
    truncated: true,
  }
}

export function renderUserRequestSection(input: {
  heading: string
  request: string
  title?: string
  taskID?: string
  bundlePath?: string
  wordLimit?: number
}): string {
  const bundlePath = input.bundlePath ??
    (input.taskID ? ProjectRuntimePaths.taskRelative(input.taskID, "intent", "request.md") : USER_REQUEST_BUNDLE_PATH)
  const wordLimit = input.wordLimit ?? USER_REQUEST_PROMPT_WORD_LIMIT
  const excerpt = excerptUserRequest(input.request, wordLimit)
  const lines: string[] = [input.heading, ""]
  if (input.title?.trim()) {
    lines.push(`Title: ${input.title.trim()}`, "")
  }
  lines.push(`Request excerpt (first ${wordLimit} words; full request is materialized at \`${bundlePath}\`):`)
  lines.push("")
  lines.push(excerpt.text)
  if (excerpt.truncated) {
    lines.push("")
    lines.push(`... (${excerpt.omittedWords} word(s) omitted from prompt injection)`)
  }
  lines.push("")
  lines.push(`For exact PRD details, grep/read \`${bundlePath}\` for the relevant section or term before relying on summaries.`)
  return lines.join("\n")
}
