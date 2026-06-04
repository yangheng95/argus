// Copied from OpenCode's provider connectivity helper and adapted to OpenCorvus provider id.
import type { Provider } from "@opencorvus-ai/sdk"
import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"

export function isProviderConnected(item: Provider) {
  return item.id !== "opencorvus" || Object.values(item.models).some((model) => model.cost?.input !== 0)
}

export function useConnected() {
  const sync = useSync()
  return createMemo(() => sync.data.provider.some(isProviderConnected))
}
