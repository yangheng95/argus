export function createInactivityGuard(timeoutMs: number, onTimeout: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = () => {
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      onTimeout()
    }, timeoutMs)
  }

  const clear = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = undefined
  }

  arm()
  return {
    bump() {
      arm()
    },
    clear,
  }
}
