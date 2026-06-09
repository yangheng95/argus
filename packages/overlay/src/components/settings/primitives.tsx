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
import { For, Show, mergeProps, splitProps } from "solid-js"
import type { JSX } from "solid-js"

export type SettingsPillTone = "ok" | "warn" | "bad" | "accent" | "muted" | "neutral"

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

export interface SettingsSegmentedOption<T extends string> {
  value: T
  label: JSX.Element
  /** Tone applied to the active state — defaults to "neutral". */
  tone?: SettingsPillTone
  title?: string
  disabled?: boolean
}

export interface SettingsSegmentedProps<T extends string> {
  options: SettingsSegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  ariaLabel?: string
}

export function SettingsSegmented<T extends string>(props: SettingsSegmentedProps<T>): JSX.Element {
  return (
    <div class="s-segmented" role="group" aria-label={props.ariaLabel}>
      <For each={props.options}>
        {(opt) => (
          <button
            type="button"
            class="s-segmented-btn"
            data-active={props.value === opt.value ? "true" : undefined}
            data-tone={opt.tone ?? "neutral"}
            data-value={opt.value}
            title={opt.title}
            disabled={opt.disabled}
            aria-pressed={props.value === opt.value}
            onClick={() => {
              if (props.value !== opt.value) props.onChange(opt.value)
            }}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  )
}
