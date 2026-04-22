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

function todoCounts(todos: TodoItem[]) {
  let completed = 0;
  let active = 0;
  let pending = 0;
  let cancelled = 0;
  for (const todo of todos) {
    if (todo.status === "completed") completed += 1;
    else if (todo.status === "in_progress") active += 1;
    else if (todo.status === "cancelled") cancelled += 1;
    else pending += 1;
  }
  return {
    total: todos.length,
    completed,
    active,
    pending,
    cancelled,
    remaining: active + pending,
  };
}

function TodoItems(props: { todos: TodoItem[]; listClass: string }) {
  return (
    <ul class={props.listClass}>
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

export function TodoListPart(props: { todos: TodoItem[]; variant?: "inline" | "card" }) {
  const variant = () => props.variant ?? "inline";
  const counts = () => todoCounts(props.todos);
  const progress = () => {
    const total = counts().total;
    if (total <= 0) return 0;
    return Math.round((counts().completed / total) * 100);
  };

  if (variant() !== "card") {
    return <TodoItems todos={props.todos} listClass="msg-todo-list" />;
  }

  return (
    <section class="msg-todo-card">
      <div class="msg-todo-card__summary">
        <div class="msg-todo-card__headline">
          <span class="msg-todo-card__count">{counts().remaining}</span>
          <span class="msg-todo-card__label">
            {counts().remaining === 1 ? "item left" : "items left"}
          </span>
        </div>
        <div class="msg-todo-card__meta">{counts().completed}/{counts().total} done</div>
      </div>

      <div class="msg-todo-card__progress" aria-hidden="true">
        <span
          class="msg-todo-card__progress-fill"
          style={{ width: `${progress()}%` }}
        />
      </div>

      <div class="msg-todo-card__stats">
        <Show when={counts().active > 0}>
          <span class="msg-todo-card__stat" data-status="in_progress">
            In progress {counts().active}
          </span>
        </Show>
        <Show when={counts().pending > 0}>
          <span class="msg-todo-card__stat" data-status="pending">
            Pending {counts().pending}
          </span>
        </Show>
        <Show when={counts().completed > 0}>
          <span class="msg-todo-card__stat" data-status="completed">
            Completed {counts().completed}
          </span>
        </Show>
        <Show when={counts().cancelled > 0}>
          <span class="msg-todo-card__stat" data-status="cancelled">
            Cancelled {counts().cancelled}
          </span>
        </Show>
      </div>

      <TodoItems todos={props.todos} listClass="msg-todo-list msg-todo-list--card" />
    </section>
  );
}
