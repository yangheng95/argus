import { For, Show } from "solid-js";

export interface TodoItem {
  content: string;
  status: string;
  priority?: string;
  activeForm?: string;
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "\u2714"; // ✔
    case "in_progress":
      return "\u25D0"; // ◐
    case "cancelled":
      return "\u2715"; // ✕
    case "pending":
    default:
      return "\u25CB"; // ○
  }
}

function statusKey(raw: unknown): string {
  const s = String(raw || "").toLowerCase().trim();
  if (s === "completed" || s === "in_progress" || s === "cancelled" || s === "pending") return s;
  return "pending";
}

function priorityKey(raw: unknown): string {
  const s = String(raw || "").toLowerCase().trim();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "";
}

/**
 * Coerce a todowrite/todoread tool state into a todos[] array.
 * Input shape varies:
 *   - state.input.todos  (always present while tool streams/executes)
 *   - state.metadata.todos (populated once the tool completes)
 *   - state.output (JSON.stringify of the array — fall-back only)
 */
export function extractTodos(state: any): TodoItem[] | null {
  const input = state?.input;
  if (input && Array.isArray(input.todos)) return normalize(input.todos);
  const meta = state?.metadata;
  if (meta && Array.isArray(meta.todos)) return normalize(meta.todos);
  const out = typeof state?.output === "string" ? state.output.trim() : "";
  if (out.startsWith("[")) {
    try {
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed)) return normalize(parsed);
    } catch {
      // output still streaming / truncated — no structured view yet
    }
  }
  return null;
}

function normalize(list: any[]): TodoItem[] {
  return list
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      content: String(item.content ?? "").trim(),
      status: statusKey(item.status),
      priority: priorityKey(item.priority) || undefined,
      activeForm:
        typeof item.activeForm === "string" && item.activeForm.trim()
          ? item.activeForm.trim()
          : undefined,
    }))
    .filter((item) => item.content.length > 0);
}

export function TodoListPart(props: { todos: TodoItem[] }) {
  return (
    <ul class="msg-todo-list">
      <For each={props.todos}>
        {(todo) => (
          <li class="msg-todo-item" data-status={todo.status}>
            <span class="msg-todo-icon" aria-hidden="true">
              {statusIcon(todo.status)}
            </span>
            <span class="msg-todo-content">
              {todo.status === "in_progress" && todo.activeForm
                ? todo.activeForm
                : todo.content}
            </span>
            <Show when={todo.priority}>
              <span class="msg-todo-priority" data-priority={todo.priority}>
                {todo.priority}
              </span>
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}
