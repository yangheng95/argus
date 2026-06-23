export async function stopServerWithTimeout(input: {
  stop: () => void | Promise<void>
  timeoutMilliseconds: number
  onStopError: (error: unknown) => void
  onTimeout: () => void
}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(input.stop).catch(input.onStopError),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          input.onTimeout()
          resolve()
        }, input.timeoutMilliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
