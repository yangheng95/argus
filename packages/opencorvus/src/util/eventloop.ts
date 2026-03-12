import { Log } from "./log"

interface ProcessWithInternals {
  _getActiveHandles(): unknown[]
  _getActiveRequests(): unknown[]
}

export namespace EventLoop {
  export async function wait() {
    const proc = process as unknown as ProcessWithInternals
    if (typeof proc._getActiveHandles !== "function" || typeof proc._getActiveRequests !== "function") {
      Log.Default.warn("eventloop", { message: "process internals unavailable, resolving immediately" })
      return
    }
    return new Promise<void>((resolve) => {
      const check = () => {
        const handles = proc._getActiveHandles()
        const requests = proc._getActiveRequests()
        Log.Default.info("eventloop", {
          active: [...handles, ...requests],
        })
        if (handles.length === 0 && requests.length === 0) {
          resolve()
        } else {
          setImmediate(check)
        }
      }
      check()
    })
  }
}
