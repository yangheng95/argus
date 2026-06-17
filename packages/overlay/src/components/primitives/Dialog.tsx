import {
  Content as KobalteDialogContent,
  Overlay as KobalteDialogOverlay,
  Portal as KobalteDialogPortal,
  Root as KobalteDialogRoot,
  Title as KobalteDialogTitle,
} from "@kobalte/core/dialog"
import { mergeProps, Show, splitProps, type JSX } from "solid-js"

export interface DialogProps {
  /** Controlled open state for the Kobalte dialog root. */
  open: boolean
  /** Dialog title rendered in the header bar. */
  title: JSX.Element
  /** Optional header action row rendered on the right side. */
  headerActions?: JSX.Element
  /** Optional footer action row rendered in .dialog-actions. */
  footer?: JSX.Element
  /** Optional class names applied to the header wrapper. */
  headerClass?: string
  /** Wider width variant for dense surfaces such as the log viewer. */
  wide?: boolean
  /** Widest width variant for dense multi-pane dialogs. */
  wider?: boolean
  /** Render title as `h2` by default, override only when semantics require it. */
  titleAs?: "div" | "h1" | "h2" | "span"
  /** Whether clicking outside the content closes the dialog. */
  backdropClose?: boolean
  /** Whether Kobalte traps focus and disables outside pointer events. */
  modal?: boolean
  /** Extra class names applied to the dialog content element. */
  class?: string
  /** Extra class names applied to the Kobalte overlay element. */
  overlayClass?: string
  /** Extra class names applied to .dialog-form. */
  formClass?: string
  /** Forwarded ref for imperative focus or metrics. */
  ref?: ((el: HTMLElement) => void) | HTMLElement
  /** Kobalte autofocus hook forwarded to dialog content. */
  onOpenAutoFocus?: (event: Event) => void
  /** Kobalte close autofocus hook forwarded to dialog content. */
  onCloseAutoFocus?: (event: Event) => void
  /** Close callback fired after Kobalte requests the controlled dialog to close. */
  onClose?: (dialog: HTMLElement) => void
  /** Dialog body content. */
  children: JSX.Element
  /** Optional DOM id for the dialog root. */
  id?: string
  [key: `data-${string}`]: string | boolean | undefined
}

export function Dialog(rawProps: DialogProps) {
  const merged = mergeProps(
    { wide: false, wider: false, titleAs: "h2" as const, backdropClose: true, modal: true },
    rawProps,
  )
  const [local, rest] = splitProps(merged, [
    "open",
    "title",
    "headerActions",
    "footer",
    "headerClass",
    "wide",
    "wider",
    "titleAs",
    "backdropClose",
    "modal",
    "class",
    "overlayClass",
    "formClass",
    "ref",
    "onClose",
    "children",
  ])

  let dialogRef: HTMLElement | undefined

  function closeFromKobalte(nextOpen: boolean) {
    if (nextOpen) return
    if (dialogRef) local.onClose?.(dialogRef)
  }

  function handleInteractOutside(event: Event) {
    if (local.backdropClose === false) event.preventDefault()
  }

  const dialogContentStyle = (): JSX.CSSProperties | undefined =>
    local.modal ? undefined : { "pointer-events": "none" }

  const dialogOverlayStyle = (): JSX.CSSProperties | undefined =>
    local.modal ? undefined : { "pointer-events": "none" }

  return (
    <KobalteDialogRoot open={local.open} onOpenChange={closeFromKobalte} modal={local.modal}>
      <KobalteDialogPortal>
        <KobalteDialogOverlay
          class={["dialog-overlay", local.overlayClass].filter(Boolean).join(" ")}
          data-dialog-modal={local.modal ? "true" : "false"}
          style={dialogOverlayStyle()}
        />
        <KobalteDialogContent
          {...rest}
          class={["dialog", local.wide ? "dialog-wide" : "", local.wider ? "dialog-wider" : "", local.class]
            .filter(Boolean)
            .join(" ")}
          aria-modal={local.modal ? "true" : undefined}
          ref={(el) => {
            dialogRef = el
            if (typeof local.ref === "function") local.ref(el)
          }}
          onInteractOutside={handleInteractOutside}
          style={dialogContentStyle()}
        >
          <div class={["dialog-form", local.formClass].filter(Boolean).join(" ")}>
            <div class={["dialog-header", local.headerClass].filter(Boolean).join(" ")}>
              <KobalteDialogTitle as={local.titleAs} class="dialog-title">
                {local.title}
              </KobalteDialogTitle>
              <Show when={local.headerActions}>
                <div class="dialog-header-actions">{local.headerActions}</div>
              </Show>
            </div>
            {local.children}
            <Show when={local.footer}>
              <div class="dialog-actions">{local.footer}</div>
            </Show>
          </div>
        </KobalteDialogContent>
      </KobalteDialogPortal>
    </KobalteDialogRoot>
  )
}
