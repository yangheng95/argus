import { For, Show } from "solid-js"
import { todoStatusIconName } from "../utils/status-mapping"
import { extractTodos, type TodoItem } from "../utils/todos"
import { Icon } from "./Icon"

export { extractTodos, type TodoItem }

function todoCounts(todos: TodoItem[]) {
  let completed = 0
  let active = 0
  let pending = 0
  let cancelled = 0
  for (const todo of todos) {
    if (todo.status === "completed") completed += 1
    else if (todo.status === "in_progress") active += 1
    else if (todo.status === "cancelled") cancelled += 1
    else pending += 1
  }
  return {
    total: todos.length,
    completed,
    active,
    pending,
    cancelled,
    remaining: active + pending,
  }
}

function TodoItems(props: { todos: TodoItem[]; listClass: string }) {
  return (
    <ul class={props.listClass}>
      <For each={props.todos}>
        {(todo) => (
          <li class="msg-todo-item" data-status={todo.status}>
            <span class="msg-todo-icon" aria-hidden="true">
              <Icon name={todoStatusIconName(todo.status)} />
            </span>
            <span class="msg-todo-content">
              {todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content}
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
  )
}

export function TodoListPart(props: { todos: TodoItem[]; variant?: "inline" | "card" }) {
  const variant = () => props.variant ?? "inline"
  const counts = () => todoCounts(props.todos)
  const progress = () => {
    const total = counts().total
    if (total <= 0) return 0
    return Math.round((counts().completed / total) * 100)
  }

  if (variant() !== "card") {
    return <TodoItems todos={props.todos} listClass="msg-todo-list" />
  }

  return (
    <section class="msg-todo-card">
      <div class="msg-todo-card__summary">
        <div class="msg-todo-card__headline">
          <span class="msg-todo-card__count">{counts().remaining}</span>
          <span class="msg-todo-card__label">{counts().remaining === 1 ? "item left" : "items left"}</span>
        </div>
        <div class="msg-todo-card__meta">
          {counts().completed}/{counts().total} done
        </div>
      </div>

      <div class="msg-todo-card__progress" aria-hidden="true">
        <span class="msg-todo-card__progress-fill" style={{ "--todo-progress": `${progress()}%` }} />
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
  )
}
