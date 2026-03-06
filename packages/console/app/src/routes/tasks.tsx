import "./tasks.css"
import { Title } from "@solidjs/meta"
import { A, createAsync, useLocation } from "@solidjs/router"
import { createEffect, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { IconWorkspaceLogo } from "~/component/icon"
import { useLanguage } from "~/context/language"
import { CreateTaskResult, getProjectBoard, getProjects, ProjectBoard, type ProjectBoardInfo, type ProjectInfoItem } from "./board/common"

export default function TasksPage() {
  const location = useLocation()
  const language = useLanguage()
  const [store, setStore] = createStore({
    creating: false,
    refreshing: false,
    error: "",
    notice: "",
    projects: [] as ProjectInfoItem[],
    projectBoard: undefined as ProjectBoardInfo | undefined,
    directory: "",
    title: "",
    request: "",
    priority: "normal",
    requestID: "",
    mirror: false,
    slackChannel: "",
  })

  const initialProjects = createAsync(() => getProjects())
  const selectedDirectory = createMemo(() => {
    const value = location.query.directory
    return Array.isArray(value) ? value[0] : value
  })
  const initialBoard = createAsync((): Promise<ProjectBoardInfo | undefined> => {
    const directory = selectedDirectory()
    if (!directory) return Promise.resolve(undefined)
    return getProjectBoard(directory)
  })

  createEffect(() => {
    const items = initialProjects()
    if (items) setStore("projects", items)
  })

  createEffect(() => {
    const value = initialBoard()
    if (value) setStore("projectBoard", value)
  })

  createEffect(() => {
    if (!store.directory && selectedDirectory()) {
      setStore("directory", selectedDirectory()!)
    }
    if (!store.directory && store.projects[0]?.worktree) {
      setStore("directory", store.projects[0]!.worktree)
    }
  })

  const go = (directory: string) => {
    const query = new URLSearchParams()
    query.set("directory", directory)
    window.location.href = `/tasks?${query.toString()}`
  }

  const refresh = async () => {
    const directory = selectedDirectory() ?? store.directory
    if (!directory) return
    setStore("refreshing", true)
    const response = await fetch(`/tasks-data?directory=${encodeURIComponent(directory)}`)
    const next = response.ok
      ? await response.json().then((body) => ProjectBoard.parse(body)).catch(() => undefined)
      : undefined
    if (next) {
      setStore("notice", "Task list refreshed")
      setStore("error", "")
      setStore("projectBoard", next)
    }
    if (!next) {
      setStore("error", `Refresh failed (${response.status})`)
    }
    setStore("refreshing", false)
  }

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!store.directory || !store.request.trim()) return
    setStore("creating", true)
    setStore("error", "")
    const response = await fetch("/task-create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        directory: store.directory,
        title: store.title.trim() || undefined,
        request: store.request.trim(),
        priority: store.priority,
        requestID: store.requestID.trim() || undefined,
        mirror_to_slack: store.mirror,
        slack_channel: store.slackChannel.trim() || undefined,
      }),
    })
    const result = response.ok
      ? await response.json().then((body) => CreateTaskResult.parse(body)).catch(() => undefined)
      : undefined
    if (result?.task_id) {
      const query = new URLSearchParams()
      query.set("task_id", result.task_id)
      query.set("directory", store.directory)
      window.location.href = `/board?${query.toString()}`
      return
    }
    setStore("error", `Create task failed (${response.status})`)
    setStore("creating", false)
  }

  const tasks = createMemo(() => store.projectBoard?.tasks ?? [])

  return (
    <main data-page="tasks">
      <Title>OpenCorvus Tasks</Title>
      <div data-component="shell">
        <header data-component="topbar">
          <div data-slot="brand">
            <A href={language.route("/")} data-slot="home">
              <IconWorkspaceLogo />
            </A>
            <div>
              <span data-slot="eyebrow">Control plane</span>
              <strong>Task Console</strong>
            </div>
          </div>
          <div data-slot="actions">
            <button onClick={() => void refresh()} disabled={store.refreshing || !selectedDirectory()}>
              {store.refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        <div data-component="layout">
          <section data-component="create">
            <header data-slot="section-head">
              <span data-slot="eyebrow">New task</span>
              <strong>Publish a task to OpenCorvus</strong>
            </header>
            <form onSubmit={submit}>
              <label>
                <span>Project</span>
                <select value={store.directory} onChange={(event) => setStore("directory", event.currentTarget.value)}>
                  <For each={store.projects}>
                    {(project) => (
                      <option value={project.worktree}>
                        {project.name ? `${project.name} - ${project.worktree}` : project.worktree}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <label>
                <span>Directory override</span>
                <input
                  value={store.directory}
                  onInput={(event) => setStore("directory", event.currentTarget.value)}
                  placeholder="D:\\repo or /path/to/repo"
                />
              </label>
              <label>
                <span>Title</span>
                <input value={store.title} onInput={(event) => setStore("title", event.currentTarget.value)} placeholder="Optional short title" />
              </label>
              <label>
                <span>Request</span>
                <textarea
                  value={store.request}
                  onInput={(event) => setStore("request", event.currentTarget.value)}
                  placeholder="Describe the task, acceptance expectations, and any important constraints."
                />
              </label>
              <div data-slot="row">
                <label>
                  <span>Priority</span>
                  <select value={store.priority} onChange={(event) => setStore("priority", event.currentTarget.value)}>
                    <option value="high">high</option>
                    <option value="normal">normal</option>
                    <option value="low">low</option>
                  </select>
                </label>
                <label>
                  <span>Request ID</span>
                  <input
                    value={store.requestID}
                    onInput={(event) => setStore("requestID", event.currentTarget.value)}
                    placeholder="Optional idempotency key"
                  />
                </label>
              </div>
              <label data-slot="check">
                <input type="checkbox" checked={store.mirror} onChange={(event) => setStore("mirror", event.currentTarget.checked)} />
                <span>Mirror task and later operator messages to Slack</span>
              </label>
              <Show when={store.mirror}>
                <label>
                  <span>Slack channel</span>
                  <input
                    value={store.slackChannel}
                    onInput={(event) => setStore("slackChannel", event.currentTarget.value)}
                    placeholder="Optional channel id, defaults to server SLACK_CHANNEL_ID"
                  />
                </label>
              </Show>
              <div data-slot="foot">
                <Show when={store.error}>
                  <span data-tone="bad">{store.error}</span>
                </Show>
                <button type="submit" disabled={store.creating || !store.directory || !store.request.trim()}>
                  {store.creating ? "Creating..." : "Create task"}
                </button>
              </div>
            </form>
          </section>

          <section data-component="list">
            <header data-slot="section-head">
              <div>
                <span data-slot="eyebrow">Project board</span>
                <strong>{store.projectBoard?.project.name ?? selectedDirectory() ?? "Select a project"}</strong>
              </div>
              <Show when={store.projectBoard}>
                <span data-slot="path">{store.projectBoard?.project.worktree}</span>
              </Show>
            </header>

            <Show when={store.projectBoard} fallback={<div data-component="empty">Select a project to load tasks.</div>}>
              {(project) => (
                <>
                  <div data-component="summary">
                    <Stat label="Open" value={project().summary.open_tasks} />
                    <Stat label="Running" value={project().summary.running_tasks} />
                    <Stat label="Blocked" value={project().summary.blocked_tasks} />
                    <Stat label="Completed" value={project().summary.completed_tasks} />
                    <Stat label="Failed" value={project().summary.failed_tasks} />
                    <Stat
                      label="Median time"
                      value={(() => {
                        const median = project().summary.median_completion_ms
                        return typeof median === "number" ? `${Math.round(median / 1000)}s` : "-"
                      })()}
                    />
                  </div>

                  <div data-component="projects">
                    <For each={store.projects}>
                      {(project) => (
                        <button
                          data-component="project-pill"
                          data-active={project.worktree === selectedDirectory() ? "true" : undefined}
                          onClick={() => go(project.worktree)}
                        >
                          {project.name ?? project.worktree}
                        </button>
                      )}
                    </For>
                  </div>

                  <div data-component="tasks">
                    <Show when={tasks().length} fallback={<div data-component="empty">No tasks for this project yet.</div>}>
                      <For each={tasks()}>
                        {(item) => {
                          const query = new URLSearchParams()
                          query.set("task_id", item.task.id)
                          query.set("directory", project().project.worktree)
                          return (
                            <A href={`/board?${query.toString()}`} data-component="task-card">
                              <div data-slot="task-top">
                                <span data-tone={item.task.status}>{item.task.status}</span>
                                <span>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(item.updated_at)}</span>
                              </div>
                              <strong>{item.task.title}</strong>
                              <p>{item.task.request}</p>
                              <div data-slot="task-meta">
                                <span>run: {item.run?.phase ?? "-"}</span>
                                <span>pending: {item.pending_interactions}</span>
                                <span>eval: {item.evaluation?.status ?? "-"}</span>
                              </div>
                            </A>
                          )
                        }}
                      </For>
                    </Show>
                  </div>
                </>
              )}
            </Show>
          </section>
        </div>
      </div>
    </main>
  )
}

function Stat(props: { label: string; value: string | number }) {
  return (
    <div data-component="stat">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}
