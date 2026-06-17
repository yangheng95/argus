/**
 * Settings primitives — single source for every settings panel's
 * surface vocabulary. Each component renders the `.s-*` class
 * contract defined in styles/surfaces/settings.css. Panels MUST
 * compose these instead of hand-writing `<div class="...">`
 * wrappers so the design tokens stay enforced.
 *
 * Visual contract: flat (no card border by default), hierarchy via
 * font weight + color tokens, hover via the dialog's
 * settings-surface-hover wash. See
 * specs/overlay-settings-primitives-2026-05-26.md.
 */
import { Show, mergeProps, splitProps } from "solid-js"
import * as Select from "@kobalte/core/select"
import type { JSX } from "solid-js"
import { Icon } from "../Icon"
import { SegmentedControl, type SegmentedControlOption, type SegmentedControlTone } from "../ui/SegmentedControl"

export type SettingsPillTone = SegmentedControlTone

export interface SettingsPanelProps {
  children: JSX.Element
  id?: string
  class?: string
}

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  return (
    <div class={props.class ? `s-panel ${props.class}` : "s-panel"} id={props.id}>
      {props.children}
    </div>
  )
}

export interface SettingsGroupProps {
  title?: JSX.Element
  actions?: JSX.Element
  children: JSX.Element
  id?: string
}

export function SettingsGroup(props: SettingsGroupProps): JSX.Element {
  return (
    <section class="s-group" id={props.id}>
      <Show when={props.title || props.actions}>
        <header class="s-group-head">
          <span class="s-group-head-title">{props.title}</span>
          <Show when={props.actions}>
            <span class="s-group-head-actions">{props.actions}</span>
          </Show>
        </header>
      </Show>
      <div class="s-group-body">{props.children}</div>
    </section>
  )
}

export interface SettingsRowProps {
  /** Optional leading slot (icon, avatar, drag handle). */
  leading?: JSX.Element
  /** Bold title — typically a label or item name. */
  title?: JSX.Element
  /** Soft secondary line — explanation / hint. */
  desc?: JSX.Element
  /** Muted footnotes — credits, paths, counts. Accepts array for chips. */
  meta?: JSX.Element
  /** Right-side button cluster. */
  actions?: JSX.Element
  /** Use children when the main column needs richer content than title/desc. */
  children?: JSX.Element
  /** Center-align the row instead of the default top-align. */
  align?: "start" | "center"
  /** Opt-in hover wash. Default false — rows are static unless declared interactive. */
  interactive?: boolean
  id?: string
}

export function SettingsRow(props: SettingsRowProps): JSX.Element {
  const merged = mergeProps({ align: "start" as const, interactive: false }, props)
  return (
    <div
      class="s-row"
      id={merged.id}
      data-align={merged.align === "center" ? "center" : undefined}
      data-interactive={merged.interactive ? "true" : undefined}
    >
      <Show when={merged.leading}>
        <span class="s-row-leading">{merged.leading}</span>
      </Show>
      <div class="s-row-main">
        <Show when={merged.title}>
          <span class="s-row-title">{merged.title}</span>
        </Show>
        <Show when={merged.children}>{merged.children}</Show>
        <Show when={merged.desc}>
          <span class="s-row-desc">{merged.desc}</span>
        </Show>
        <Show when={merged.meta}>
          <span class="s-row-meta">{merged.meta}</span>
        </Show>
      </div>
      <Show when={merged.actions}>
        <div class="s-row-actions">{merged.actions}</div>
      </Show>
    </div>
  )
}

export interface SettingsPillProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "class"> {
  tone?: SettingsPillTone
  children: JSX.Element
}

export function SettingsPill(props: SettingsPillProps): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children"])
  return (
    <span {...rest} class="s-pill" data-tone={local.tone ?? "neutral"}>
      {local.children}
    </span>
  )
}

export interface SettingsToolbarProps {
  children: JSX.Element
}

export function SettingsToolbar(props: SettingsToolbarProps): JSX.Element {
  return <div class="s-toolbar">{props.children}</div>
}

export interface SettingsEmptyProps {
  children: JSX.Element
}

export function SettingsEmpty(props: SettingsEmptyProps): JSX.Element {
  return <div class="s-empty">{props.children}</div>
}

export interface SettingsSelectOption {
  value: string
  label: string
  description?: string
}

export interface SettingsSelectProps<T extends SettingsSelectOption> {
  options: T[]
  value: string
  ariaLabel: string
  onChange: (next: string) => void
  disabled?: boolean
  placeholder?: string
  testid?: string
  class?: string
  triggerClass?: string
  contentClass?: string
  listboxClass?: string
  optionClass?: string
  indicatorClass?: string
  optionTextClass?: string
  optionData?: (option: T) => Record<string, string | undefined>
}

export function SettingsSelect<T extends SettingsSelectOption>(props: SettingsSelectProps<T>): JSX.Element {
  const selectedOption = () => props.options.find((option) => option.value === props.value) ?? null
  const setSelectedOption = (option: T | null) => {
    if (!option || option.value === props.value) return
    props.onChange(option.value)
  }
  const rootClass = () => (props.class ? `settings-select ${props.class}` : "settings-select")
  const triggerClass = () =>
    props.triggerClass ? `field-input oc-select-trigger ${props.triggerClass}` : "field-input oc-select-trigger"
  const contentClass = () =>
    props.contentClass ? `oc-select-content ${props.contentClass}` : "oc-select-content settings-select-content"
  const listboxClass = () =>
    props.listboxClass ? `oc-select-listbox ${props.listboxClass}` : "oc-select-listbox settings-select-listbox"
  const optionClass = () =>
    props.optionClass ? `oc-select-option ${props.optionClass}` : "oc-select-option settings-select-option"
  const indicatorClass = () =>
    props.indicatorClass ? `oc-select-indicator ${props.indicatorClass}` : "oc-select-indicator"
  const optionTextClass = () =>
    props.optionTextClass ? `oc-select-option-copy ${props.optionTextClass}` : "oc-select-option-copy"

  function SettingsSelectOptionItem(itemProps: Select.SelectRootItemComponentProps<T>): JSX.Element {
    const option = () => itemProps.item.rawValue
    const optionData = () => props.optionData?.(option()) ?? {}
    const optionCopy = () => (
      <>
        <Select.ItemLabel>{option().label}</Select.ItemLabel>
        <Show when={option().description}>{(description) => <small>{description()}</small>}</Show>
      </>
    )
    return (
      <Select.Item item={itemProps.item} class={optionClass()} {...optionData()}>
        <Show when={props.optionTextClass || option().description} fallback={optionCopy()}>
          <span class={optionTextClass()}>{optionCopy()}</span>
        </Show>
        <Select.ItemIndicator class={indicatorClass()}>
          <Icon name="status-completed" size={12} />
        </Select.ItemIndicator>
      </Select.Item>
    )
  }

  return (
    <Select.Root<T>
      class={rootClass()}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={selectedOption()}
      onChange={setSelectedOption}
      itemComponent={SettingsSelectOptionItem}
      disabled={props.disabled}
      disallowEmptySelection
      gutter={4}
      sameWidth
    >
      <Select.Trigger class={triggerClass()} data-testid={props.testid} aria-label={props.ariaLabel}>
        <Select.Value<T>>{(state) => <span>{state.selectedOption()?.label ?? props.placeholder ?? ""}</span>}</Select.Value>
        <Select.Icon>
          <Icon name="caret-down" size={12} />
        </Select.Icon>
      </Select.Trigger>
      <Select.HiddenSelect aria-label={props.ariaLabel} />
      <Select.Portal>
        <Select.Content class={contentClass()}>
          <Select.Listbox class={listboxClass()} />
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

export interface SettingsSegmentedOption<T extends string> extends SegmentedControlOption<T> {}

export interface SettingsSegmentedProps<T extends string> {
  options: SettingsSegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  ariaLabel?: string
}

export function SettingsSegmented<T extends string>(props: SettingsSegmentedProps<T>): JSX.Element {
  return (
    <SegmentedControl
      class="s-segmented"
      itemClass="s-segmented-btn"
      options={props.options}
      value={props.value}
      onChange={props.onChange}
      aria-label={props.ariaLabel}
    />
  )
}
