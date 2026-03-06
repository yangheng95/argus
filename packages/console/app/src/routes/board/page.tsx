import "./[id].css"
import { Title } from "@solidjs/meta"
import { A, createAsync, useLocation, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { IconChevronRight, IconWorkspaceLogo } from "~/component/icon"
import { useLanguage } from "~/context/language"
import { SessionMessage, TaskBoard, TaskMessageResult, queryTaskBoard } from "./common"
import type { TaskBoardInfo } from "./common"

const laneCopy = {
  run: "Current execution and retry posture.",
  goals: "Acceptance targets and current verdicts.",
  blockers: "Items waiting on human or environment input.",
  preferences: "Durable constraints inferred from the operator.",
  notes: "Short-term working memory and planning hints.",
}

const tone = (value?: string) => {
  if (!value) return "neutral"
  if (["completed", "passed", "accepted", "answered"].includes(value)) return "good"
  if (["failed", "rejected", "error", "cancelled", "aborted", "expired"].includes(value)) return "bad"
  if (["blocked", "pending", "inconclusive"].includes(value)) return "warn"
  if (["running", "evaluating", "accepted"].includes(value)) return "live"
  return "neutral"
}

const relative = (value: number) => {
  const delta = Date.now() - value
  if (delta < 10_000) return "just now"
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  return `${Math.round(delta / 3_600_000)}h ago`
}

const date = (value?: number) => {
  if (!value) return "-"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
}

export default function BoardPage() {
  const params = useParams()
  const location = useLocation()
  const language = useLanguage()
  const taskID = createMemo(() => {
    if (params.id) return params.id
    const value = location.query.task_id
    return Array.isArray(value) ? value[0] : value
  })
  const directory = createMemo(() => {
    const value = location.query.directory
    return Array.isArray(value) ? value[0] : value
  })
  const initial = createAsync((): Promise<TaskBoardInfo | undefined> => {
    const value = taskID()
    if (!value) return Promise.resolve(undefined)
    return queryTaskBoard(value, directory())
  })
  const [selected, setSelected] = createSignal<{ laneID: string; cardID: string }>()
  const [store, setStore] = createStore({
    board: undefined as TaskBoardInfo | undefined,
    syncing: false,
    sending: false,
    live: false,
    error: "",
    notice: "",
    draft: "",
    session: [] as Array<{ info: { id: string; role: string; sessionID: string }; parts: Array<{ id: string; type: string; text?: string; tool?: string; state?: { status?: string; output?: string; error?: string } }> }>,
    sessionLoading: false,
    replies: {} as Record<string, string>,
    resolving: "",
    updatedAt: 0,
    open: {
      request: true,
      plan: true,
      prompt: false,
      brief: true,
      composer: true,
      metadata: false,
      results: true,
      interactions: true,
      timeline: false,
      session: false,
    },
  })

  const search = createMemo(() => {
    const query = new URLSearchParams()
    if (taskID()) query.set("task_id", taskID()!)
    if (directory()) query.set("directory", directory()!)
    if (query.size === 0) return ""
    return `?${query.toString()}`
  })
  const tasksHref = createMemo(() => {
    const query = new URLSearchParams()
    if (directory()) query.set("directory", directory()!)
    return `/tasks${query.size > 0 ? `?${query.toString()}` : ""}`
  })

  createEffect(() => {
    const value = initial()
    if (!value) return
    setStore("board", value)
    setStore("updatedAt", Date.now())
  })

  const cards = createMemo(() =>
    (store.board?.lanes ?? []).flatMap((lane) => lane.cards.map((card) => ({ lane, card }))),
  )

  const current = createMemo(() => {
    const value = selected()
    if (!value) return cards()[0]
    return cards().find((item) => item.lane.id === value.laneID && item.card.id === value.cardID) ?? cards()[0]
  })

  createEffect(() => {
    const next = current()
    if (!next) return
    const value = selected()
    if (value?.laneID === next.lane.id && value.cardID === next.card.id) return
    setSelected({
      laneID: next.lane.id,
      cardID: next.card.id,
    })
  })

  const stats = createMemo(() => {
    const lanes = store.board?.lanes ?? []
    return {
      goals: lanes.find((lane) => lane.id === "goals")?.cards.length ?? 0,
      blockers: lanes.find((lane) => lane.id === "blockers")?.cards.length ?? 0,
      preferences: lanes.find((lane) => lane.id === "preferences")?.cards.length ?? 0,
      notes: lanes.find((lane) => lane.id === "notes")?.cards.length ?? 0,
    }
  })

  const refresh = async (silent = false) => {
    if (!taskID()) return
    if (store.syncing) return
    setStore("syncing", true)
    const response = await fetch(`/board-data${search()}`)
    const board = response.ok
      ? await response
          .json()
          .then((body) => TaskBoard.parse(body))
          .catch(() => undefined)
      : undefined
    if (board) {
      setStore("board", board)
      setStore("updatedAt", Date.now())
      setStore("error", "")
      if (!silent) setStore("notice", "Board refreshed")
    }
    if (!board) {
      setStore("error", `Refresh failed (${response.status})`)
    }
    setStore("syncing", false)
  }

  createEffect(() => {
    if (typeof window !== "object") return
    if (!taskID()) return
    const timer = window.setInterval(() => {
      if (store.live) return
      void refresh(true)
    }, 4500)
    const source = new EventSource(`/board-events${search()}`)
    source.onopen = () => {
      setStore("live", true)
      setStore("error", "")
    }
    source.onerror = () => {
      setStore("live", false)
    }
    source.onmessage = () => {
      void refresh(true)
    }
    onCleanup(() => {
      window.clearInterval(timer)
      source.close()
    })
  })

  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!taskID()) return
    const text = store.draft.trim()
    if (!text || store.sending) return
    setStore("sending", true)
    setStore("error", "")

    const response = await fetch(`/board-message${search()}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        source: "console-board",
      }),
    })

    const result = response.ok
      ? await response
          .json()
          .then((body) => TaskMessageResult.parse(body))
          .catch(() => undefined)
      : undefined

    if (result) {
      setStore("draft", "")
      setStore("notice", result.message)
      await refresh(true)
    }
    if (!result) {
      setStore("error", `Message failed (${response.status})`)
    }

    setStore("sending", false)
  }

  const resolveInteraction = async (input: {
    id: string
    type: "permission" | "question"
    action: "once" | "always" | "reject" | "answer"
  }) => {
    if (!directory()) return
    setStore("resolving", input.id)
    setStore("error", "")
    const response =
      input.action === "reject"
        ? await fetch("/interaction-reject", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              interaction_id: input.id,
              directory: directory(),
              message: store.replies[input.id],
            }),
          })
        : await fetch("/interaction-reply", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(
              input.type === "permission"
                ? {
                    interaction_id: input.id,
                    directory: directory(),
                    reply: input.action,
                  }
                : {
                    interaction_id: input.id,
                    directory: directory(),
                    answers: [[store.replies[input.id] || ""]],
                  },
            ),
          })
    if (!response.ok) {
      setStore("error", `Interaction update failed (${response.status})`)
      setStore("resolving", "")
      return
    }
    setStore("notice", "Interaction updated")
    setStore("replies", input.id, "")
    setStore("resolving", "")
    await refresh(true)
  }

  const loadSession = async () => {
    if (!taskID()) return
    if (store.sessionLoading || store.session.length > 0) return
    setStore("sessionLoading", true)
    const response = await fetch(`/task-session${search()}`)
    const session = response.ok
      ? await response.json().then((body) => SessionMessage.array().parse(body)).catch(() => undefined)
      : undefined
    if (session) {
      setStore("session", session as never)
      setStore("error", "")
    }
    if (!session) {
      setStore("error", `Session load failed (${response.status})`)
    }
    setStore("sessionLoading", false)
  }

  return (
    <main data-page="board">
      <Title>{store.board?.task.title ?? taskID() ?? "Board"} | OpenCorvus Board</Title>
      <div data-component="shell">
        <header data-component="topbar">
          <div data-slot="brand">
            <A href={language.route("/")} data-slot="home">
              <IconWorkspaceLogo />
            </A>
            <div data-slot="crumbs">
              <span data-slot="eyebrow">Autonomous board</span>
              <strong>{store.board?.task.title ?? taskID() ?? "Task board"}</strong>
            </div>
          </div>
          <div data-slot="actions">
            <A href={tasksHref()} data-slot="tasks-link">
              Tasks
            </A>
            <Show when={directory()}>
              <span data-slot="directory">{directory()}</span>
            </Show>
            <button onClick={() => void refresh()} disabled={store.syncing}>
              {store.syncing ? "Syncing..." : "Refresh"}
            </button>
          </div>
        </header>

        <Show
          when={store.board}
          fallback={
            <section data-component="empty">
              <h1>{taskID() ? "Loading board" : "Board needs a task id"}</h1>
              <p>
                {taskID()
                  ? "The first board snapshot is being fetched from the orchestrator."
                  : "Open this page with ?task_id=... or /board/:id to load a task board."}
              </p>
            </section>
          }
        >
          {(board) => (
            <>
              <section data-component="hero">
                <div data-slot="hero-copy">
                  <span data-slot="eyebrow">Task {board().task.id}</span>
                  <h1>{board().task.title}</h1>
                  <p>{board().task.request}</p>
                </div>
                <div data-slot="hero-meta">
                  <div data-component="meta-card">
                    <span data-slot="label">Task</span>
                    <strong>{board().task.status}</strong>
                    <span data-tone={tone(board().task.status)}>{board().task.priority}</span>
                  </div>
                  <div data-component="meta-card">
                    <span data-slot="label">Run</span>
                    <strong>{board().run?.phase ?? "idle"}</strong>
                    <span data-tone={tone(board().run?.status)}>{board().run?.status ?? "waiting"}</span>
                  </div>
                  <div data-component="meta-card">
                    <span data-slot="label">Plan</span>
                    <strong>v{board().plan?.version ?? 0}</strong>
                    <span data-tone={tone(board().plan?.status)}>{board().plan?.status ?? "missing"}</span>
                  </div>
                  <div data-component="meta-card">
                    <span data-slot="label">Live</span>
                    <strong>{relative(store.updatedAt || board().brief.updated_at)}</strong>
                    <span>{store.live ? "sse connected" : date(board().brief.updated_at)}</span>
                  </div>
                </div>
                <div data-slot="hero-stats">
                  <div>
                    <span>Goals</span>
                    <strong>{stats().goals}</strong>
                  </div>
                  <div>
                    <span>Blockers</span>
                    <strong>{stats().blockers}</strong>
                  </div>
                  <div>
                    <span>Preferences</span>
                    <strong>{stats().preferences}</strong>
                  </div>
                  <div>
                    <span>Notes</span>
                    <strong>{stats().notes}</strong>
                  </div>
                </div>
                <Show when={store.error || store.notice || board().task.blockingReason || board().task.error}>
                  <div data-slot="alerts">
                    <Show when={board().task.blockingReason}>
                      <div data-tone="warn">Blocked: {board().task.blockingReason}</div>
                    </Show>
                    <Show when={board().task.error}>
                      <div data-tone="bad">Task error: {board().task.error}</div>
                    </Show>
                    <Show when={store.notice}>
                      <div data-tone="good">{store.notice}</div>
                    </Show>
                    <Show when={store.error}>
                      <div data-tone="bad">{store.error}</div>
                    </Show>
                  </div>
                </Show>
              </section>

              <div data-component="grid">
                <section data-component="lanes">
                  <For each={board().lanes}>
                    {(lane) => (
                      <article data-component="lane">
                        <header data-slot="lane-top">
                          <div>
                            <strong>{lane.title}</strong>
                            <p>{laneCopy[lane.id as keyof typeof laneCopy] ?? "Projected board lane."}</p>
                          </div>
                          <span data-slot="count">{lane.cards.length}</span>
                        </header>
                        <div data-slot="lane-cards">
                          <Show
                            when={lane.cards.length}
                            fallback={<div data-component="lane-empty">No items in this lane.</div>}
                          >
                            <For each={lane.cards}>
                              {(card) => (
                                <button
                                  data-component="lane-card"
                                  data-active={
                                    current()?.card.id === card.id && current()?.lane.id === lane.id ? "true" : undefined
                                  }
                                  data-tone={tone(card.status)}
                                  onClick={() =>
                                    setSelected({
                                      laneID: lane.id,
                                      cardID: card.id,
                                    })
                                  }
                                >
                                  <div data-slot="card-top">
                                    <span data-slot="kind">{card.kind.replace("_", " ")}</span>
                                    <Show when={card.status}>
                                      <span data-slot="status">{card.status}</span>
                                    </Show>
                                  </div>
                                  <strong>{card.title}</strong>
                                  <Show when={card.detail}>
                                    <p>{card.detail}</p>
                                  </Show>
                                </button>
                              )}
                            </For>
                          </Show>
                        </div>
                      </article>
                    )}
                  </For>
                </section>

                <aside data-component="rail">
                  <section data-component="detail">
                    <header data-slot="section-head">
                      <div>
                        <span data-slot="eyebrow">Selected</span>
                        <strong>{current()?.card.title ?? "No card selected"}</strong>
                      </div>
                      <Show when={current()}>
                        <span data-tone={tone(current()?.card.status)}>{current()?.card.status ?? current()?.card.kind}</span>
                      </Show>
                    </header>
                    <Show
                      when={current()}
                      fallback={<p data-slot="empty-copy">Choose a card to inspect its full detail and metadata.</p>}
                    >
                      {(value) => (
                        <>
                          <p data-slot="detail-copy">{value().card.detail ?? "No extra detail on this card yet."}</p>
                          <dl data-slot="detail-grid">
                            <div>
                              <dt>Lane</dt>
                              <dd>{value().lane.title}</dd>
                            </div>
                            <div>
                              <dt>Kind</dt>
                              <dd>{value().card.kind}</dd>
                            </div>
                            <div>
                              <dt>Card ID</dt>
                              <dd>{value().card.id}</dd>
                            </div>
                            <div>
                              <dt>Status</dt>
                              <dd>{value().card.status ?? "-"}</dd>
                            </div>
                          </dl>
                          <Show when={value().card.metadata && Object.keys(value().card.metadata ?? {}).length}>
                            <button
                              data-component="toggle"
                              onClick={() => setStore("open", "metadata", (value) => !value)}
                            >
                              <span>{store.open.metadata ? "Hide metadata" : "Show metadata"}</span>
                              <IconChevronRight />
                            </button>
                            <Show when={store.open.metadata}>
                              <pre data-slot="json">{JSON.stringify(value().card.metadata, null, 2)}</pre>
                            </Show>
                          </Show>
                        </>
                      )}
                    </Show>
                  </section>

                  <section data-component="stack">
                    <button data-component="toggle" onClick={() => setStore("open", "brief", (value) => !value)}>
                      <span>Assistant brief</span>
                      <IconChevronRight />
                    </button>
                    <Show when={store.open.brief}>
                      <pre data-slot="copy">{board().brief.content}</pre>
                    </Show>

                    <button data-component="toggle" onClick={() => setStore("open", "request", (value) => !value)}>
                      <span>Original request</span>
                      <IconChevronRight />
                    </button>
                    <Show when={store.open.request}>
                      <div data-slot="rich-copy">{board().task.request}</div>
                    </Show>

                    <button data-component="toggle" onClick={() => setStore("open", "plan", (value) => !value)}>
                      <span>Plan summary</span>
                      <IconChevronRight />
                    </button>
                    <Show when={store.open.plan}>
                      <div data-slot="rich-copy">
                        <strong>{board().plan?.summary ?? "No active plan yet."}</strong>
                        <dl data-slot="detail-grid">
                          <div>
                            <dt>Created</dt>
                            <dd>{date(board().plan?.time.created)}</dd>
                          </div>
                          <div>
                            <dt>Updated</dt>
                            <dd>{date(board().plan?.time.updated)}</dd>
                          </div>
                        </dl>
                      </div>
                    </Show>

                    <Show when={board().plan?.prompt}>
                      <button data-component="toggle" onClick={() => setStore("open", "prompt", (value) => !value)}>
                        <span>Execution prompt</span>
                        <IconChevronRight />
                      </button>
                      <Show when={store.open.prompt}>
                        <pre data-slot="copy">{board().plan?.prompt}</pre>
                      </Show>
                    </Show>

                    <button data-component="toggle" onClick={() => setStore("open", "results", (value) => !value)}>
                      <span>Results</span>
                      <IconChevronRight />
                    </button>
                    <Show when={store.open.results}>
                      <div data-slot="rich-copy">
                        <strong>{board().delivery?.summary ?? "No delivery yet."}</strong>
                        <Show when={board().evaluation}>
                          <dl data-slot="detail-grid">
                            <div>
                              <dt>Verdict</dt>
                              <dd>{board().evaluation?.verdict}</dd>
                            </div>
                            <div>
                              <dt>Status</dt>
                              <dd>{board().evaluation?.status}</dd>
                            </div>
                          </dl>
                          <p>{board().evaluation?.summary}</p>
                          <Show when={board().evaluation?.checks.length}>
                            <ul data-component="check-list">
                              <For each={board().evaluation?.checks}>
                                {(check) => (
                                  <li>
                                    <strong>{check.name}</strong>
                                    <span data-tone={tone(check.status)}>{check.status}</span>
                                    <Show when={check.evidence}>
                                      <p>{check.evidence}</p>
                                    </Show>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        </Show>
                        <Show when={board().delivery?.result.changedFiles.length}>
                          <div data-component="artifact-group">
                            <span data-slot="eyebrow">Changed files</span>
                            <ul data-component="pill-list">
                              <For each={board().delivery?.result.changedFiles}>
                                {(file) => <li>{file}</li>}
                              </For>
                            </ul>
                          </div>
                        </Show>
                        <Show when={board().delivery?.result.diffs.length}>
                          <div data-component="artifact-group">
                            <span data-slot="eyebrow">Diffs</span>
                            <ul data-component="artifact-list">
                              <For each={board().delivery?.result.diffs}>
                                {(diff: any) => (
                                  <li>
                                    <strong>{diff.file ?? "file"}</strong>
                                    <pre data-slot="copy">{String(diff.diff ?? diff.patch ?? JSON.stringify(diff, null, 2))}</pre>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        </Show>
                        <Show when={board().artifacts.length}>
                          <div data-component="artifact-group">
                            <span data-slot="eyebrow">Artifacts</span>
                            <ul data-component="artifact-list">
                              <For each={board().artifacts}>
                                {(artifact) => (
                                  <li>
                                    <strong>{artifact.kind}</strong>
                                    <span>{artifact.label}</span>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </div>
                        </Show>
                      </div>
                    </Show>

                    <button data-component="toggle" onClick={() => setStore("open", "interactions", (value) => !value)}>
                      <span>Interactions</span>
                      <IconChevronRight />
                    </button>
                    <Show when={store.open.interactions}>
                      <div data-slot="rich-copy">
                        <Show
                          when={board().interactions.length}
                          fallback={<p>No interaction history for this task.</p>}
                        >
                          <For each={board().interactions}>
                            {(interaction) => (
                              <div data-component="interaction-item">
                                <div data-slot="interaction-top">
                                  <strong>{interaction.title}</strong>
                                  <span data-tone={tone(interaction.status)}>{interaction.status}</span>
                                </div>
                                <p>{interaction.body}</p>
                                <Show when={interaction.status === "pending"}>
                                  <div data-component="interaction-actions">
                                    <Show when={interaction.type === "permission"}>
                                      <>
                                        <button disabled={store.resolving === interaction.id} onClick={() => void resolveInteraction({ id: interaction.id, type: "permission", action: "once" })}>allow once</button>
                                        <button disabled={store.resolving === interaction.id} onClick={() => void resolveInteraction({ id: interaction.id, type: "permission", action: "always" })}>allow always</button>
                                        <button disabled={store.resolving === interaction.id} onClick={() => void resolveInteraction({ id: interaction.id, type: "permission", action: "reject" })}>reject</button>
                                      </>
                                    </Show>
                                    <Show when={interaction.type === "question"}>
                                      <>
                                        <textarea
                                          value={store.replies[interaction.id] ?? ""}
                                          onInput={(event) => setStore("replies", interaction.id, event.currentTarget.value)}
                                          placeholder="Reply to the question"
                                        />
                                        <button
                                          disabled={store.resolving === interaction.id || !(store.replies[interaction.id] ?? "").trim()}
                                          onClick={() => void resolveInteraction({ id: interaction.id, type: "question", action: "answer" })}
                                        >
                                          submit answer
                                        </button>
                                      </>
                                    </Show>
                                  </div>
                                </Show>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </Show>

                    <button data-component="toggle" onClick={() => setStore("open", "timeline", (value) => !value)}>
                      <span>Timeline</span>
                      <IconChevronRight />
                    </button>
                    <Show when={store.open.timeline}>
                      <div data-slot="rich-copy">
                        <Show when={board().snapshots.length} fallback={<p>No progress snapshots yet.</p>}>
                          <ul data-component="timeline">
                            <For each={board().snapshots}>
                              {(snapshot) => (
                                <li>
                                  <div>
                                    <strong>{snapshot.summary}</strong>
                                    <span data-tone={tone(snapshot.status)}>{snapshot.status}</span>
                                  </div>
                                  <span>{date(snapshot.time.created)}</span>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                      </div>
                    </Show>

                    <button
                      data-component="toggle"
                      onClick={() => {
                        setStore("open", "session", (value) => !value)
                        void loadSession()
                      }}
                    >
                      <span>Raw session</span>
                      <IconChevronRight />
                    </button>
                    <Show when={store.open.session}>
                      <div data-slot="rich-copy">
                        <Show when={!store.sessionLoading} fallback={<p>Loading session messages...</p>}>
                          <Show when={store.session.length} fallback={<p>No session messages loaded.</p>}>
                            <ul data-component="timeline">
                              <For each={store.session}>
                                {(message) => (
                                  <li>
                                    <div>
                                      <strong>{message.info.role}</strong>
                                      <span>{message.parts.length} parts</span>
                                    </div>
                                    <Show when={message.parts.length}>
                                      <ul data-component="artifact-list">
                                        <For each={message.parts}>
                                          {(part) => (
                                            <li>
                                              <strong>{part.type}</strong>
                                              <Show when={typeof (part as any).text === "string"}>
                                                <p>{String((part as any).text).slice(0, 400)}</p>
                                              </Show>
                                              <Show when={typeof (part as any).tool === "string"}>
                                                <p>{String((part as any).tool)}</p>
                                              </Show>
                                            </li>
                                          )}
                                        </For>
                                      </ul>
                                    </Show>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        </Show>
                      </div>
                    </Show>
                  </section>

                  <section data-component="composer">
                    <button data-component="toggle" onClick={() => setStore("open", "composer", (value) => !value)}>
                      <span>Operator input</span>
                      <IconChevronRight />
                    </button>
                    <Show when={store.open.composer}>
                      <form onSubmit={submit}>
                        <textarea
                          value={store.draft}
                          onInput={(event) => setStore("draft", event.currentTarget.value)}
                          placeholder="Add a preference, tighten the scope, ask for a smaller diff, or leave an operator note."
                        />
                        <div data-slot="composer-foot">
                          <span>Natural language is interpreted into preference, goal, plan, or note.</span>
                          <button type="submit" disabled={store.sending || !store.draft.trim()}>
                            {store.sending ? "Sending..." : "Send to task"}
                          </button>
                        </div>
                      </form>
                    </Show>
                  </section>
                </aside>
              </div>
            </>
          )}
        </Show>
      </div>
    </main>
  )
}
