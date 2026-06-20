import { createUniqueId, splitProps, type JSX } from "solid-js"
import { useArmedConfirm } from "../../solid/armed-confirm"
import { Button, type ButtonProps } from "./Button"

export interface ArmedConfirmButtonProps
  extends Omit<
    ButtonProps,
    "aria-describedby" | "aria-label" | "aria-pressed" | "children" | "onBlur" | "onClick" | "title"
  > {
  label: string
  armedDescription: string
  confirmWindowMs?: number
  onConfirm: () => void
  children: JSX.Element
  confirmChildren: JSX.Element
}

export function ArmedConfirmButton(props: ArmedConfirmButtonProps): JSX.Element {
  const [local, buttonProps] = splitProps(props, [
    "label",
    "armedDescription",
    "confirmWindowMs",
    "onConfirm",
    "children",
    "confirmChildren",
  ])
  const confirm = useArmedConfirm(local.confirmWindowMs)
  const instanceID = createUniqueId()
  const descriptionID = () => `${instanceID}-armed-confirm-status`

  return (
    <Button
      {...buttonProps}
      title={local.label}
      aria-label={local.label}
      aria-pressed={confirm.armed() ? "true" : "false"}
      aria-describedby={confirm.armed() ? descriptionID() : undefined}
      data-confirm={confirm.armed() ? "true" : undefined}
      onClick={(event) => {
        event.stopPropagation()
        confirm.confirm(local.onConfirm)
      }}
      onBlur={confirm.disarm}
    >
      {local.children}
      {local.confirmChildren}
      <span id={descriptionID()} class="oc-armed-confirm-status" role="status" aria-live="polite">
        {confirm.armed() ? local.armedDescription : ""}
      </span>
    </Button>
  )
}
