import * as DropdownMenu from "@kobalte/core/dropdown-menu"
import type { JSX } from "solid-js"
import { Button } from "./ui/Button"

interface WorkspaceSplitLauncherProps {
  rootClass: string
  rootRole?: JSX.IntrinsicElements["div"]["role"]
  rootAriaLabel?: string
  menuClass: string
  disabled: boolean
  open: boolean
  title: string
  primaryAriaLabel: string
  menuAriaLabel: string
  primaryDataUI?: string
  menuDataUI?: string
  pressed?: boolean
  primaryChildren: JSX.Element
  menuButtonChildren: JSX.Element
  onPrimaryClick: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
  children: JSX.Element
}

export function WorkspaceSplitLauncherItem(props: {
  class: string
  children: JSX.Element
  dataAttributes?: Record<string, string>
  onSelect: () => void | Promise<void>
}): JSX.Element {
  return (
    <DropdownMenu.Item
      as="button"
      type="button"
      class={props.class}
      {...props.dataAttributes}
      onSelect={() => void props.onSelect()}
    >
      {props.children}
    </DropdownMenu.Item>
  )
}

export function WorkspaceSplitLauncher(props: WorkspaceSplitLauncherProps): JSX.Element {
  function close(): void {
    props.onOpenChange(false)
  }

  function primaryClick(): void {
    if (props.disabled) return
    close()
    void props.onPrimaryClick()
  }

  return (
    <DropdownMenu.Root
      open={props.open}
      onOpenChange={(open) => props.onOpenChange(props.disabled ? false : open)}
      placement="bottom-end"
      gutter={6}
    >
      <div class={props.rootClass} data-no-drag="true" role={props.rootRole} aria-label={props.rootAriaLabel}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tone="neutral"
          data-chrome="workspace-split-primary"
          data-ui={props.primaryDataUI}
          aria-pressed={props.pressed}
          title={props.title}
          aria-label={props.primaryAriaLabel}
          disabled={props.disabled}
          onClick={primaryClick}
        >
          {props.primaryChildren}
        </Button>
        <DropdownMenu.Trigger
          as={Button}
          type="button"
          variant="ghost"
          size="icon"
          tone="neutral"
          data-chrome="workspace-split-menu"
          data-ui={props.menuDataUI}
          data-open={props.open ? "true" : "false"}
          disabled={props.disabled}
          title={props.title}
          aria-label={props.menuAriaLabel}
        >
          {props.menuButtonChildren}
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class={props.menuClass}>{props.children}</DropdownMenu.Content>
        </DropdownMenu.Portal>
      </div>
    </DropdownMenu.Root>
  )
}
