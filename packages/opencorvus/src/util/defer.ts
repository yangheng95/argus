export function defer(
  fn: () => void | Promise<void>,
): Disposable & AsyncDisposable {
  return {
    [Symbol.dispose]() {
      const result = fn()
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          console.error("[defer] async cleanup failed in synchronous dispose:", err)
        })
      }
    },
    [Symbol.asyncDispose]() {
      return Promise.resolve(fn())
    },
  }
}
