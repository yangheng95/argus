import { createEffect, createSignal, mergeProps, onCleanup, Show, splitProps, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"

const DIALOG_VIEWPORT_MARGIN = 8
const DIALOG_DRAG_IGNORE_SELECTOR =
  'button, input, textarea, select, a, label, summary, [contenteditable="true"], [data-dialog-no-drag="true"]'

function isDialogDragIgnored(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(DIALOG_DRAG_IGNORE_SELECTOR))
}

function clampOffset(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampDialogOffset(form: HTMLElement, x: number, y: number): { x: number; y: number } {
  const rect = form.getBoundingClientRect()
  const availableX = Math.max(0, (window.innerWidth - rect.width) / 2 - DIALOG_VIEWPORT_MARGIN)
  const availableY = Math.max(0, (window.innerHeight - rect.height) / 2 - DIALOG_VIEWPORT_MARGIN)
  return {
    x: clampOffset(x, -availableX, availableX),
    y: clampOffset(y, -availableY, availableY),
  }
}

export interface DialogProps {
  /** Controlled open state for the native dialog element. */
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
  /** Whether clicking the native backdrop closes the dialog. */
  backdropClose?: boolean
  /** Whether the header bar can drag the dialog inside the viewport. */
  draggable?: boolean
  /** Extra class names applied to the native dialog element. */
  class?: string
  /** Extra class names applied to .dialog-form. */
  formClass?: string
  /** Forwarded ref for imperative focus or metrics. */
  ref?: ((el: HTMLDialogElement) => void) | HTMLDialogElement
  /** Close callback fired after the native dialog closes. */
  onClose?: (dialog: HTMLDialogElement) => void
  /** Dialog body content. */
  children: JSX.Element
  /** Optional DOM id for the dialog root. */
  id?: string
  [key: `data-${string}`]: string | boolean | undefined
}

export function Dialog(rawProps: DialogProps) {
  const merged = mergeProps(
    { wide: false, wider: false, titleAs: "h2" as const, backdropClose: true, draggable: true },
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
    "draggable",
    "class",
    "formClass",
    "ref",
    "onClose",
    "children",
  ])

  let dialogRef: HTMLDialogElement | undefined
  let formRef: HTMLDivElement | undefined
  let removeDragListeners: (() => void) | undefined
  const [dialogOffset, setDialogOffset] = createSignal({ x: 0, y: 0 })
  const [dragging, setDragging] = createSignal(false)

  function stopDragging() {
    setDragging(false)
    removeDragListeners?.()
    removeDragListeners = undefined
  }

  function startDialogDrag(event: PointerEvent) {
    const form = formRef
    if (!form || local.draggable === false || event.button !== 0 || event.isPrimary === false) return
    if (isDialogDragIgnored(event.target)) return

    event.preventDefault()
    const origin = dialogOffset()
    const startX = event.clientX
    const startY = event.clientY

    const moveDialog = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault()
      const next = clampDialogOffset(form, origin.x + moveEvent.clientX - startX, origin.y + moveEvent.clientY - startY)
      setDialogOffset(next)
    }

    const finishDialogDrag = () => stopDragging()
    stopDragging()
    setDragging(true)
    window.addEventListener("pointermove", moveDialog)
    window.addEventListener("pointerup", finishDialogDrag, { once: true })
    window.addEventListener("pointercancel", finishDialogDrag, { once: true })
    removeDragListeners = () => {
      window.removeEventListener("pointermove", moveDialog)
      window.removeEventListener("pointerup", finishDialogDrag)
      window.removeEventListener("pointercancel", finishDialogDrag)
    }
  }

  const dialogFormStyle = (): JSX.CSSProperties =>
    ({
      "--dialog-drag-x": `${dialogOffset().x}px`,
      "--dialog-drag-y": `${dialogOffset().y}px`,
    }) as JSX.CSSProperties

  createEffect(() => {
    const dialog = dialogRef
    if (!dialog) return
    if (local.open) {
      setDialogOffset({ x: 0, y: 0 })
      if (!dialog.open) dialog.showModal()
      return
    }
    stopDragging()
    if (dialog.open) dialog.close()
  })

  onCleanup(stopDragging)

  return (
    <dialog
      {...rest}
      class={["dialog", local.wide ? "dialog-wide" : "", local.wider ? "dialog-wider" : "", local.class]
        .filter(Boolean)
        .join(" ")}
      ref={(el) => {
        dialogRef = el
        if (typeof local.ref === "function") local.ref(el)
      }}
      onClick={(event) => {
        if (local.backdropClose !== false && event.target === event.currentTarget) {
          dialogRef?.close()
        }
      }}
      onClose={() => {
        stopDragging()
        if (dialogRef) local.onClose?.(dialogRef)
      }}
    >
      <div
        class={["dialog-form", local.formClass].filter(Boolean).join(" ")}
        data-dialog-draggable={local.draggable !== false}
        data-dialog-dragging={dragging()}
        ref={(el) => {
          formRef = el
        }}
        style={dialogFormStyle()}
      >
        <div
          class={["dialog-header", local.headerClass].filter(Boolean).join(" ")}
          data-dialog-drag-handle={local.draggable !== false}
          onPointerDown={startDialogDrag}
        >
          <Dynamic component={local.titleAs} class="dialog-title">
            {local.title}
          </Dynamic>
          <Show when={local.headerActions}>
            <div class="dialog-header-actions">{local.headerActions}</div>
          </Show>
        </div>
        {local.children}
        <Show when={local.footer}>
          <div class="dialog-actions">{local.footer}</div>
        </Show>
      </div>
    </dialog>
  )
}
