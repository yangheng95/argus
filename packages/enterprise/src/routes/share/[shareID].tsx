import { AssistantMessage, Message, Part, Session, UserMessage } from "@opencorvus-ai/sdk/v2"
import { Dialog } from "@opencorvus-ai/ui/dialog"
import { useDialog } from "@opencorvus-ai/ui/context/dialog"
import { createAsync, query, useParams } from "@solidjs/router"
import { createEffect, createMemo, ErrorBoundary, For, onCleanup, Show } from "solid-js"
import { Share } from "~/core/share"
import { Binary } from "@opencorvus-ai/util/binary"
import { NamedError } from "@opencorvus-ai/util/error"
import { DateTime } from "luxon"
import z from "zod"
import NotFound from "../[...404]"
import { Meta, Title } from "@solidjs/meta"

const SessionDataMissingError = NamedError.create(
  "SessionDataMissingError",
  z.object({
    sessionID: z.string(),
    message: z.string().optional(),
  }),
)

const getData = query(async (shareID) => {
  "use server"
  const share = await Share.get(shareID)
  if (!share) throw new SessionDataMissingError({ sessionID: shareID })
  const data = await Share.data(shareID)
  const result: {
    sessionID: string
    shareID: string
    session: Session[]
    message: {
      [sessionID: string]: Message[]
    }
    part: {
      [messageID: string]: Part[]
    }
  } = {
    sessionID: share.sessionID,
    shareID,
    session: [],
    message: {},
    part: {},
  }
  for (const item of data) {
    switch (item.type) {
      case "session":
        result.session.push(item.data)
        break
      case "message":
        result.message[item.data.sessionID] = result.message[item.data.sessionID] ?? []
        result.message[item.data.sessionID].push(item.data)
        break
      case "part":
        result.part[item.data.messageID] = result.part[item.data.messageID] ?? []
        result.part[item.data.messageID].push(item.data)
        break
    }
  }
  const match = Binary.search(result.session, share.sessionID, (s) => s.id)
  if (!match.found) throw new SessionDataMissingError({ sessionID: share.sessionID })
  return result
}, "getShareData")

export default function () {
  const params = useParams()
  const dialog = useDialog()
  const data = createAsync(async () => {
    if (!params.shareID) throw new Error("Missing shareID")
    return getData(params.shareID)
  })

  return (
    <ErrorBoundary
      fallback={(error) => {
        if (SessionDataMissingError.isInstance(error)) {
          return <NotFound />
        }
        console.error(error)
        const details = error instanceof Error ? (error.stack ?? error.message) : String(error)
        return (
          <div class="min-h-screen w-full bg-background-base text-text-base flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p class="text-16-medium">Unable to render this share.</p>
            <p class="text-14-regular text-text-weaker">Check the console for more details.</p>
            <pre class="text-12-mono text-left whitespace-pre-wrap break-words w-full max-w-200 bg-background-stronger rounded-md p-4">
              {details}
            </pre>
          </div>
        )
      }}
    >
      <Meta name="robots" content="noindex, nofollow" />
      <Show when={data()}>
        {(data) => {
          const match = createMemo(() => Binary.search(data().session, data().sessionID, (s) => s.id))
          if (!match().found) throw new Error(`Session ${data().sessionID} not found`)
          const info = createMemo(() => data().session[match().index])
          const all = createMemo(() => (data().message[data().sessionID] ?? []).sort((a, b) => a.time.created - b.time.created))
          const users = createMemo(() => all().filter((x): x is UserMessage => x.role === "user"))
          const assists = createMemo(() => all().filter((x): x is AssistantMessage => x.role === "assistant"))
          const turn = createMemo(() =>
            users().map((u) => {
              const msg = data().part[u.id] ?? []
              const prompt = msg
                .filter((x): x is Extract<Part, { type: "text" }> => x.type === "text")
                .map((x) => x.text.trim())
                .filter(Boolean)
                .join(" ")
              const child = assists().filter((x) => x.parentID === u.id)
              const childID = new Set(child.map((x) => x.id))
              const tool = child
                .flatMap((x) => data().part[x.id] ?? [])
                .filter((x): x is Extract<Part, { type: "tool" }> => x.type === "tool")
                .findLast((x) => x.state.status === "running" || x.state.status === "pending")
              const hasError = child.some((x) => !!x.error && x.error.name !== "MessageAbortedError")
              const running = child.some((x) => !x.time.completed)
              const idle = child.length > 0 && !running && !hasError
              return {
                id: u.id,
                created: u.time.created,
                prompt,
                replies: child.length,
                tools: Object.values(data().part)
                  .flat()
                  .filter((x): x is Extract<Part, { type: "tool" }> => x.type === "tool")
                  .filter((x) => childID.has(x.messageID)).length,
                state: hasError ? "error" : running || child.length === 0 ? "running" : idle ? "idle" : "idle",
                detail:
                  tool?.state.status === "running"
                    ? tool.state.title || tool.tool
                    : tool?.state.status === "pending"
                      ? `waiting ${tool.tool}`
                      : String(child.at(-1)?.error?.data?.message || "idle"),
              }
            }),
          )
          const last = createMemo(() => turn().at(-1))
          const status = createMemo(() => {
            if (!last()) return { key: "idle", label: "IDLE" }
            if (last()!.state === "running") return { key: "running", label: "RUNNING" }
            if (last()!.state === "error") return { key: "error", label: "ERROR" }
            return { key: "idle", label: "IDLE" }
          })
          const text = (value: string) => (value.length > 120 ? `${value.slice(0, 120)}...` : value)

          const panel = () => (
            <Dialog
              size="x-large"
              class="desktop-window"
              title={
                <div class="desktop-window-title">
                  <div class="desktop-window-name">{info().title}</div>
                  <div class="desktop-window-meta">Session v{info().version}</div>
                </div>
              }
              action={
                <span class="desktop-status" data-state={status().key}>
                  {status().label}
                </span>
              }
              description="OpenCorvus conversation state monitor"
            >
              <div class="desktop-body">
                <div class="desktop-grid">
                  <div class="desktop-card">
                    <div class="desktop-label">Session ID</div>
                    <div class="desktop-value">{data().sessionID}</div>
                  </div>
                  <div class="desktop-card">
                    <div class="desktop-label">Directory</div>
                    <div class="desktop-value">{info().directory}</div>
                  </div>
                  <div class="desktop-card">
                    <div class="desktop-label">Turns</div>
                    <div class="desktop-value">{turn().length}</div>
                  </div>
                  <div class="desktop-card">
                    <div class="desktop-label">Messages</div>
                    <div class="desktop-value">{all().length}</div>
                  </div>
                </div>
                <div class="desktop-list">
                  <div class="desktop-list-title">Recent Turns</div>
                  <Show when={turn().length > 0} fallback={<div class="desktop-empty">No turns yet.</div>}>
                    <For each={turn().toReversed()}>
                      {(item) => (
                        <div class="desktop-row" data-state={item.state}>
                          <div class="desktop-row-head">
                            <span class="desktop-row-time">
                              {DateTime.fromMillis(item.created).toFormat("MM-dd HH:mm:ss")}
                            </span>
                            <span class="desktop-row-badge">{item.state.toUpperCase()}</span>
                          </div>
                          <div class="desktop-row-text">{text(item.prompt || "(no prompt text)")}</div>
                          <div class="desktop-row-meta">
                            replies {item.replies} | tools {item.tools} | {text(item.detail)}
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Dialog>
          )

          createEffect(() => {
            dialog.show(panel)
            onCleanup(() => dialog.close())
          })

          return (
            <>
              <Show when={info().title}>
                <Title>{info().title} | OpenCorvus</Title>
              </Show>
              <Meta name="description" content="OpenCorvus desktop dialog session monitor." />
              <div class="desktop-root">
                <div class="desktop-stripe">
                  <div class="desktop-pill">OpenCorvus Desktop</div>
                  <div class="desktop-pill">{DateTime.fromMillis(info().time.updated).toFormat("HH:mm")}</div>
                </div>
              </div>
            </>
          )
        }}
      </Show>
    </ErrorBoundary>
  )
}

