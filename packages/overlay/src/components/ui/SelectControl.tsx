import * as Select from "@kobalte/core/select"
import { Show, type JSX } from "solid-js"
import { Icon } from "../Icon"

type SelectDataAttributes = Record<string, string | undefined>

export interface SelectControlProps<T extends object> {
  options: T[]
  value: T | null
  onChange: (next: T | null) => void
  renderValue: (selected: T | null) => JSX.Element
  renderOptionLabel: (option: T) => JSX.Element
  optionValue?: keyof T | ((option: T) => string | number)
  optionTextValue?: keyof T | ((option: T) => string)
  renderOptionDescription?: (option: T) => JSX.Element | undefined
  optionData?: (option: T) => SelectDataAttributes
  class?: string
  id?: string
  triggerID?: string
  triggerClass?: string
  triggerTitle?: string
  triggerDataUI?: string
  triggerTestID?: string
  triggerRef?: (el: HTMLButtonElement) => void
  ariaLabel?: string
  ariaLabelledBy?: string
  disabled?: boolean
  disallowEmptySelection?: boolean
  gutter?: number
  sameWidth?: boolean
  contentClass?: string
  listboxClass?: string
  optionClass?: string
  optionCopyClass?: string
  indicatorClass?: string
  iconClass?: string
  icon?: JSX.Element
  beforeTrigger?: JSX.Element
}

function withClass(base: string, extra?: string): string {
  return extra ? `${base} ${extra}` : base
}

export function SelectControl<T extends object>(props: SelectControlProps<T>): JSX.Element {
  const triggerClass = () => withClass("oc-select-trigger", props.triggerClass)
  const contentClass = () => withClass("oc-select-content", props.contentClass)
  const listboxClass = () => withClass("oc-select-listbox", props.listboxClass)
  const optionClass = () => withClass("oc-select-option", props.optionClass)
  const optionCopyClass = () => withClass("oc-select-option-copy", props.optionCopyClass)
  const indicatorClass = () => withClass("oc-select-indicator", props.indicatorClass)
  const shouldWrapOptionCopy = () => !!props.optionCopyClass || !!props.renderOptionDescription

  function SelectControlItem(itemProps: Select.SelectRootItemComponentProps<T>): JSX.Element {
    const option = () => itemProps.item.rawValue
    const description = () => props.renderOptionDescription?.(option())
    const optionData = () => props.optionData?.(option()) ?? {}
    const optionCopy = () => (
      <>
        <Select.ItemLabel>{props.renderOptionLabel(option())}</Select.ItemLabel>
        <Show when={description()}>{(value) => <small>{value()}</small>}</Show>
      </>
    )
    return (
      <Select.Item item={itemProps.item} class={optionClass()} {...optionData()}>
        <Show when={shouldWrapOptionCopy()} fallback={optionCopy()}>
          <span class={optionCopyClass()}>{optionCopy()}</span>
        </Show>
        <Select.ItemIndicator class={indicatorClass()}>
          <Icon name="status-completed" size={12} />
        </Select.ItemIndicator>
      </Select.Item>
    )
  }

  return (
    <Select.Root<T>
      id={props.id}
      class={props.class}
      options={props.options}
      optionValue={props.optionValue}
      optionTextValue={props.optionTextValue}
      value={props.value}
      onChange={props.onChange}
      itemComponent={SelectControlItem}
      disabled={props.disabled}
      disallowEmptySelection={props.disallowEmptySelection}
      gutter={props.gutter ?? 4}
      sameWidth={props.sameWidth ?? true}
    >
      {props.beforeTrigger}
      <Select.Trigger
        id={props.triggerID}
        class={triggerClass()}
        title={props.triggerTitle}
        data-ui={props.triggerDataUI}
        data-testid={props.triggerTestID}
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
        ref={props.triggerRef}
      >
        <span class="oc-select-value">{props.renderValue(props.value)}</span>
        <Select.Icon class={props.iconClass}>
          {props.icon ?? <Icon name="caret-down" size={12} />}
        </Select.Icon>
      </Select.Trigger>
      <Select.HiddenSelect aria-label={props.ariaLabel} aria-labelledby={props.ariaLabelledBy} />
      <Select.Portal>
        <Select.Content class={contentClass()}>
          <Select.Listbox class={listboxClass()} />
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
