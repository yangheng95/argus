export type ContextMenuEventTarget = Pick<EventTarget, "addEventListener">

export function suppressNativeContextMenu(event: Event): void {
  event.preventDefault()
}

export function installNativeContextMenuSuppression(target: ContextMenuEventTarget, signal?: AbortSignal): void {
  target.addEventListener("contextmenu", suppressNativeContextMenu, {
    capture: true,
    signal,
  })
}
