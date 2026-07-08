import { createSignal } from "solid-js"

const [rightToolbarOpen, setRightToolbarOpen] = createSignal(false)

export { rightToolbarOpen }

export function setRightToolbarVisible(open: boolean): void {
  setRightToolbarOpen(open)
}

export function toggleRightToolbarVisible(): void {
  setRightToolbarOpen((open) => !open)
}
