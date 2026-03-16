export class Channel<T> {
  buf: T[] = []
  waiters: Array<(item: T | null) => void> = []
  closed = false

  send(item: T) {
    if (this.closed) return false
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(item)
      return true
    }
    this.buf.push(item)
    return true
  }

  recv(signal?: AbortSignal): Promise<T | null> | T | null {
    if (this.buf.length > 0) return this.buf.shift()!
    if (this.closed) return null
    if (signal?.aborted) return null
    return new Promise<T | null>((resolve) => {
      let settled = false
      const done = (item: T | null) => {
        if (settled) return
        settled = true
        signal?.removeEventListener("abort", abort)
        resolve(item)
      }
      const abort = () => {
        const index = this.waiters.indexOf(done)
        if (index >= 0) this.waiters.splice(index, 1)
        done(null)
      }
      this.waiters.push(done)
      signal?.addEventListener("abort", abort, { once: true })
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter(null)
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const item = await this.recv()
      if (item === null) return
      yield item
    }
  }
}
