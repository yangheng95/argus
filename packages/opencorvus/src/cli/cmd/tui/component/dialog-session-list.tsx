import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createResource, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { Spinner } from "./spinner"
import { useToast } from "../ui/toast"

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const [search, setSearch] = createDebouncedSignal("", 150)

  const [searchResults] = createResource(search, async (query) => {
    if (!query) return undefined
    const result = await sdk.client.session.list({ search: query, limit: 30 })
    return result.data ?? []
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => searchResults() ?? sync.data.session)

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return sessions()
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "streaming"
        return {
          title: x.title,
          value: x.id,
          category,
          footer: Locale.time(x.time.updated),
          gutter: isWorking ? () => <Spinner /> : undefined,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      actions={[
        {
          command: "session.delete",
          title: "delete",
          onTrigger: async (option) => {
            const result = await sdk.client.session.delete({
              sessionID: option.value,
            })
            if (result.error) {
              toast.show({ message: "Failed to delete session", variant: "error" })
              return
            }
            toast.show({ message: "Session deleted", variant: "success" })
          },
        },
        {
          command: "session.rename",
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
