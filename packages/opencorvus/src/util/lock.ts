const DEFAULT_KEYED_LOCK_TIMEOUT_MS = 30_000

/**
 * Run an async function under a keyed mutex (one concurrent execution per key).
 * @param timeoutMs  Maximum time to wait for the lock before throwing (default 30s).
 */
export async function withKeyedLock<T>(
  locks: Map<string, Promise<unknown>>,
  key: string,
  fn: () => Promise<T>,
  timeoutMs = DEFAULT_KEYED_LOCK_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (locks.has(key)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error(`withKeyedLock timeout: key="${key}" waited ${timeoutMs}ms`)
    }
    await Promise.race([
      locks.get(key)!.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, remaining)),
    ])
  }
  const promise = fn()
  locks.set(key, promise)
  try {
    return await promise
  } finally {
    if (locks.get(key) === promise) locks.delete(key)
  }
}

export namespace Lock {
  const locks = new Map<
    string,
    {
      readers: number
      writer: boolean
      waitingReaders: (() => void)[]
      waitingWriters: (() => void)[]
    }
  >()

  function get(key: string) {
    if (!locks.has(key)) {
      locks.set(key, {
        readers: 0,
        writer: false,
        waitingReaders: [],
        waitingWriters: [],
      })
    }
    return locks.get(key)!
  }

  function process(key: string) {
    const lock = locks.get(key)
    if (!lock || lock.writer || lock.readers > 0) return

    // Prioritize writers to prevent starvation
    if (lock.waitingWriters.length > 0) {
      const nextWriter = lock.waitingWriters.shift()!
      try {
        nextWriter()
      } catch {
        // If the resolve callback throws, the writer never acquired the lock.
        // Re-run process to wake the next waiter and prevent permanent deadlock.
        process(key)
      }
      return
    }

    // Wake up all waiting readers
    while (lock.waitingReaders.length > 0) {
      const nextReader = lock.waitingReaders.shift()!
      try {
        nextReader()
      } catch {
        // Same safety: if a reader resolve throws, continue waking others.
      }
    }

    // Clean up empty locks — must re-check because waking readers increments lock.readers
    if (lock.readers === 0 && !lock.writer && lock.waitingReaders.length === 0 && lock.waitingWriters.length === 0) {
      locks.delete(key)
    }
  }

  export async function read(key: string): Promise<Disposable> {
    const lock = get(key)

    return new Promise((resolve) => {
      if (!lock.writer && lock.waitingWriters.length === 0) {
        lock.readers++
        resolve({
          [Symbol.dispose]: () => {
            lock.readers--
            process(key)
          },
        })
      } else {
        lock.waitingReaders.push(() => {
          lock.readers++
          resolve({
            [Symbol.dispose]: () => {
              lock.readers--
              process(key)
            },
          })
        })
      }
    })
  }

  export async function write(key: string): Promise<Disposable> {
    const lock = get(key)

    return new Promise((resolve) => {
      if (!lock.writer && lock.readers === 0) {
        lock.writer = true
        resolve({
          [Symbol.dispose]: () => {
            lock.writer = false
            process(key)
          },
        })
      } else {
        lock.waitingWriters.push(() => {
          lock.writer = true
          resolve({
            [Symbol.dispose]: () => {
              lock.writer = false
              process(key)
            },
          })
        })
      }
    })
  }
}
