import { For, Show, type JSX } from "solid-js"
import { Button } from "./ui/Button"

export interface LedgerListProps<T> {
  items: T[]
  loading?: boolean
  error?: string
  emptyLabel: string
  retryLabel?: string
  onRetry?: () => void
  children: (item: T) => JSX.Element
}

export function LedgerList<T>(props: LedgerListProps<T>) {
  return (
    <div class="ledger-list" data-ui="ledger-list">
      <Show when={props.error}>
        <div class="mission-error" role="alert" data-ui="ledger-error">
          <span>{props.error}</span>
          <Show when={props.onRetry}>
            <Button type="button" variant="outline" size="sm" tone="danger" onClick={() => props.onRetry?.()}>
              {props.retryLabel}
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={props.loading}>
        <div class="ledger-skeleton" aria-hidden="true" data-ui="ledger-loading">
          <div class="ledger-skeleton-row" />
          <div class="ledger-skeleton-row" />
          <div class="ledger-skeleton-row" />
        </div>
      </Show>
      <Show when={!props.loading && props.items.length === 0 && !props.error}>
        <div class="ledger-empty" data-ui="ledger-empty">{props.emptyLabel}</div>
      </Show>
      <Show when={!props.loading && props.items.length > 0}>
        <For each={props.items}>{(item) => props.children(item)}</For>
      </Show>
    </div>
  )
}
