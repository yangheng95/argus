export interface TodoItem {
  content: string
  status: string
  priority?: string
  activeForm?: string
}

function statusKey(raw: unknown): string {
  const s = String(raw || "")
    .toLowerCase()
    .trim()
  if (s === "completed" || s === "in_progress" || s === "cancelled" || s === "pending") return s
  return "pending"
}

function priorityKey(raw: unknown): string {
  const s = String(raw || "")
    .toLowerCase()
    .trim()
  if (s === "high" || s === "medium" || s === "low") return s
  return ""
}

function normalizeTodos(list: unknown): TodoItem[] | null {
  if (!Array.isArray(list)) return null
  return list
    .filter((item) => item && typeof item === "object")
    .map((item: any) => ({
      content: String(item.content ?? "").trim(),
      status: statusKey(item.status),
      priority: priorityKey(item.priority) || undefined,
      activeForm: typeof item.activeForm === "string" && item.activeForm.trim() ? item.activeForm.trim() : undefined,
    }))
    .filter((item) => item.content.length > 0)
}

function parseOutputTodos(output: unknown): TodoItem[] | null {
  const out = typeof output === "string" ? output.trim() : ""
  if (!out.startsWith("[")) return null
  try {
    return normalizeTodos(JSON.parse(out))
  } catch {
    return null
  }
}

/**
 * Coerce a TodoWrite/TodoRead/UpdatePlan tool state into the canonical todo
 * list. Completed tool results are authoritative over the original input,
 * because input.todos is only the call-time snapshot and can stay at 0/N.
 */
export function extractTodos(state: any): TodoItem[] | null {
  const metadataTodos = normalizeTodos(state?.metadata?.todos)
  if (metadataTodos) return metadataTodos
  const outputTodos = parseOutputTodos(state?.output)
  if (outputTodos) return outputTodos
  return normalizeTodos(state?.input?.todos)
}
