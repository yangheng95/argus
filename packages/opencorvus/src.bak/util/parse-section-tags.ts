/**
 * Shared utilities for parsing LLM text output with section tags.
 *
 * LLM agents output structured text using <tag>content</tag> markers.
 * This replaces the previous approach of using large tool call schemas
 * (submit_spec, submit_plan) which caused hangs on providers that buffer
 * tool call arguments (e.g., GitHub Copilot's OpenAI compatibility layer).
 */

/**
 * Extract the content of a named section tag from text.
 * Matches `<tag>content</tag>` (case-insensitive, multiline).
 * Returns null if the tag is not found.
 */
export function extractTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i")
  const m = text.match(re)
  return m ? m[1].trim() : null
}

/**
 * Parse a YAML-like list of items from text.
 *
 * Input format:
 * ```
 * - key1: value1
 *   key2: value2
 *   key3: value3
 *
 * - key1: value4
 *   key2: value5
 * ```
 *
 * Returns an array of Record<string, string> objects.
 */
export function parseYamlLikeList(text: string): Array<Record<string, string>> {
  if (!text.trim()) return []

  const items: Array<Record<string, string>> = []
  let current: Record<string, string> | null = null

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // New item starts with "- key: value"
    const newItemMatch = trimmed.match(/^-\s+(\w[\w_]*):\s*(.*)/)
    if (newItemMatch) {
      if (current) items.push(current)
      current = { [newItemMatch[1]]: newItemMatch[2].trim() }
      continue
    }

    // Continuation key: "  key: value"
    const contMatch = trimmed.match(/^(\w[\w_]*):\s*(.*)/)
    if (contMatch && current) {
      current[contMatch[1]] = contMatch[2].trim()
      continue
    }

    // Plain line continuation — append to last key's value
    if (current) {
      const lastKey = Object.keys(current).at(-1)
      if (lastKey) {
        current[lastKey] = current[lastKey] ? current[lastKey] + " " + trimmed : trimmed
      }
    }
  }
  if (current) items.push(current)

  return items
}

/**
 * Parse a simple bullet list from text.
 * Each line starting with "- " is an item.
 * Lines without bullets are appended to the previous item.
 */
export function parseList(text: string): string[] {
  if (!text.trim()) return []

  const items: string[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)/)
    if (bulletMatch) {
      items.push(bulletMatch[1].trim())
    } else if (items.length > 0) {
      // Continuation of previous item
      items[items.length - 1] += " " + trimmed
    } else {
      // No bullet prefix — treat as standalone item
      items.push(trimmed)
    }
  }
  return items
}

/**
 * Parse assumption pairs from text.
 * Format:
 * ```
 * - Q: question text
 *   A: assumption text
 * ```
 */
export function parseAssumptions(text: string): Array<{ question: string; assumption: string }> {
  if (!text.trim()) return []

  const items = parseYamlLikeList(text)
  return items
    .map((item) => {
      // Support both "Q/A" and "question/assumption" keys
      const question = item.Q || item.question || ""
      const assumption = item.A || item.assumption || ""
      return question ? { question, assumption } : null
    })
    .filter((x): x is { question: string; assumption: string } => x !== null)
}

/**
 * Parse clarification entries from text.
 * Format:
 * ```
 * - header: Section Name
 *   question: What needs to be clarified?
 *   context: Why this matters
 *   default_assumption: What we'll assume if no answer
 * ```
 */
export function parseClarifications(
  text: string,
): Array<{ header: string; question: string; context?: string; default_assumption?: string }> | undefined {
  if (!text.trim()) return undefined

  const items = parseYamlLikeList(text)
  const result = items
    .map((item) => {
      if (!item.header || !item.question) return null
      return {
        header: item.header,
        question: item.question,
        context: item.context || undefined,
        default_assumption: item.default_assumption || undefined,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  return result.length > 0 ? result : undefined
}
