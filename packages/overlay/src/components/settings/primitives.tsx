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
import { Dynamic } from "solid-js/web"
import type { JSX } from "solid-js"
import { SegmentedControl, type SegmentedControlOption, type SegmentedControlTone } from "../ui/SegmentedControl"
import { SelectControl } from "../ui/SelectControl"

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

export interface SettingsGroupProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "children" | "title"> {
  title?: JSX.Element
  actions?: JSX.Element
  children: JSX.Element
  id?: string
  class?: string
}

export function SettingsGroup(props: SettingsGroupProps): JSX.Element {
  const [local, rest] = splitProps(props, ["title", "actions", "children", "id", "class"])
  return (
    <section {...rest} class={local.class ? `s-group ${local.class}` : "s-group"} id={local.id}>
      <Show when={local.title || local.actions}>
        <header class="s-group-head">
          <span class="s-group-head-title">{local.title}</span>
          <Show when={local.actions}>
            <span class="s-group-head-actions">{local.actions}</span>
          </Show>
        </header>
      </Show>
      <div class="s-group-body">{local.children}</div>
    </section>
  )
}

export interface SettingsRowProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "children" | "title"> {
  /** Root element. Use button for selectable settings rows. */
  as?: "div" | "button"
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
  /** Let complex domain rows provide their own inner grid while this primitive owns row chrome. */
  customContent?: boolean
  /** Center-align the row instead of the default top-align. */
  align?: "start" | "center"
  /** Opt-in hover wash. Default false — rows are static unless declared interactive. */
  interactive?: boolean
  /** Native tooltip title; kept separate from the visual title slot. */
  nativeTitle?: string
  id?: string
  class?: string
}

export function SettingsRow(props: SettingsRowProps): JSX.Element {
  const [local, rest] = splitProps(props, [
    "leading",
    "as",
    "title",
    "desc",
    "meta",
    "actions",
    "children",
    "customContent",
    "align",
    "interactive",
    "nativeTitle",
    "id",
    "class",
  ])
  const merged = mergeProps({ align: "start" as const, as: "div" as const, interactive: false }, local)
  return (
    <Dynamic
      component={merged.as}
      {...rest}
      class={merged.class ? `s-row ${merged.class}` : "s-row"}
      type={merged.as === "button" ? "button" : undefined}
      id={merged.id}
      title={merged.nativeTitle}
      data-align={merged.align === "center" ? "center" : undefined}
      data-interactive={merged.interactive ? "true" : undefined}
    >
      <Show
        when={merged.customContent}
        fallback={
          <>
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
          </>
        }
      >
        {merged.children}
      </Show>
    </Dynamic>
  )
}

export interface SettingsPillProps extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "class"> {
  tone?: SettingsPillTone
  children: JSX.Element
  class?: string
}

export function SettingsPill(props: SettingsPillProps): JSX.Element {
  const [local, rest] = splitProps(props, ["tone", "children", "class"])
  return (
    <span {...rest} class={local.class ? `s-pill ${local.class}` : "s-pill"} data-tone={local.tone ?? "neutral"}>
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
    props.triggerClass ? `field-input ${props.triggerClass}` : "field-input"

  return (
    <SelectControl<T>
      class={rootClass()}
      options={props.options}
      value={selectedOption()}
      onChange={setSelectedOption}
      optionValue="value"
      optionTextValue="label"
      disabled={props.disabled}
      disallowEmptySelection
      gutter={4}
      sameWidth
      triggerClass={triggerClass()}
      triggerTestID={props.testid}
      ariaLabel={props.ariaLabel}
      contentClass={props.contentClass ?? "settings-select-content"}
      listboxClass={props.listboxClass ?? "settings-select-listbox"}
      optionClass={props.optionClass ?? "settings-select-option"}
      indicatorClass={props.indicatorClass}
      optionCopyClass={props.optionTextClass}
      optionData={props.optionData}
      renderValue={(selected) => <span>{selected?.label ?? props.placeholder ?? ""}</span>}
      renderOptionLabel={(option) => option.label}
      renderOptionDescription={(option) => option.description}
    />
  )
}

export interface SettingsSegmentedOption<T extends string> extends SegmentedControlOption<T> {}

export interface SettingsSegmentedProps<T extends string> {
  options: SettingsSegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  ariaLabel: string
}

export function SettingsSegmented<T extends string>(props: SettingsSegmentedProps<T>): JSX.Element {
  return (
    <SegmentedControl
      class="s-segmented"
      itemClass="s-segmented-btn"
      options={props.options}
      value={props.value}
      onChange={props.onChange}
      ariaLabel={props.ariaLabel}
    />
  )
}
