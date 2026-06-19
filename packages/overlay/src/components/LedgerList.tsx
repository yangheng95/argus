import { For, Show, type JSX } from "solid-js"
import { Button } from "./ui/Button"

export interface LedgerListProps<T> {
  items: T[]
  loading?: boolean
  loadingLabel: string
  error?: string
  emptyLabel: string
  retryLabel?: string
  onRetry?: () => void
  children: (item: T) => JSX.Element
}

export function LedgerLoadingStatus(props: { label: string; class?: string; dataUi?: string }) {
  const className = () => (props.class ? `ledger-skeleton ${props.class}` : "ledger-skeleton")
  return (
    <div class={className()} role="status" aria-live="polite" aria-busy="true" data-ui={props.dataUi ?? "ledger-loading"}>
      <span class="ledger-loading-label">{props.label}</span>
      <div class="ledger-skeleton-rows" aria-hidden="true">
        <div class="ledger-skeleton-row task-list-skeleton-row" />
        <div class="ledger-skeleton-row task-list-skeleton-row" />
        <div class="ledger-skeleton-row task-list-skeleton-row" />
      </div>
    </div>
  )
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
        <LedgerLoadingStatus label={props.loadingLabel} />
      </Show>
      <Show when={!props.loading && props.items.length === 0 && !props.error}>
        <div class="ledger-empty" data-ui="ledger-empty">
          {props.emptyLabel}
        </div>
      </Show>
      <Show when={!props.loading && props.items.length > 0}>
        <For each={props.items}>{(item) => props.children(item)}</For>
      </Show>
    </div>
  )
}
