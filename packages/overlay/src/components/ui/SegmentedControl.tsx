import { Item as KobalteToggleGroupItem, Root as KobalteToggleGroupRoot } from "@kobalte/core/toggle-group"
import { For } from "solid-js"
import type { JSX } from "solid-js"

export type SegmentedControlTone = "ok" | "warn" | "bad" | "accent" | "muted" | "neutral"

export interface SegmentedControlOption<T extends string> {
  value: T
  label: JSX.Element
  tone?: SegmentedControlTone
  title?: string
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[]
  value: T
  ariaLabel?: string
  class?: string
  itemClass?: string
  onChange?: (next: T) => void
  onActivate?: (value: T) => void
  itemAttributes?: (option: SegmentedControlOption<T>) => Record<string, string | number | boolean | undefined>
  renderOption?: (option: SegmentedControlOption<T>) => JSX.Element
}

export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>): JSX.Element {
  function handleChange(next: string | null) {
    if (next && next !== props.value) props.onChange?.(next as T)
  }

  return (
    <KobalteToggleGroupRoot
      class={props.class ?? "oc-segmented"}
      value={props.value}
      onChange={handleChange}
      aria-label={props.ariaLabel}
    >
      <For each={props.options}>
        {(option) => (
          <KobalteToggleGroupItem
            {...(props.itemAttributes?.(option) ?? {})}
            class={props.itemClass ?? "oc-segmented__item"}
            value={option.value}
            data-active={props.value === option.value ? "true" : undefined}
            data-tone={option.tone ?? "neutral"}
            data-value={option.value}
            title={option.title}
            disabled={option.disabled}
            onClick={() => props.onActivate?.(option.value)}
          >
            {props.renderOption ? props.renderOption(option) : option.label}
          </KobalteToggleGroupItem>
        )}
      </For>
    </KobalteToggleGroupRoot>
  )
}
