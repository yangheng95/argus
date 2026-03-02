import { spawn as nodeSpawn } from "child_process"
import net from "net"
import type { ChildProcess } from "child_process"

export namespace Tui {
  export interface SpawnOptions {
    /** Working directory for the TUI process (defaults to process.cwd()) */
    directory?: string
    /** Session ID to continue */
    sessionID?: string
    /** Model to use (provider/model format) */
    model?: string
    /** Agent to use */
    agent?: string
    /** Initial prompt text */
    prompt?: string
    /** Continue last session */
    continue?: boolean
    /** Fork session when continuing */
    fork?: boolean
    /** Port for the TUI HTTP server (0 = auto-allocate) */
    port?: number
    /** Hostname for the TUI HTTP server (defaults to 127.0.0.1) */
    hostname?: string
    /** argus executable path (defaults to "argus") */
    bin?: string
  }

  export interface ConnectOptions {
    // reserved for future auth options (e.g. password)
  }

  export class Handle {
    readonly url: string
    private proc: ChildProcess | undefined
    private _closed = false

    constructor(url: string, proc?: ChildProcess) {
      this.url = url
      this.proc = proc
      if (proc) {
        proc.on("exit", () => {
          this._closed = true
        })
      }
    }

    get closed(): boolean {
      return this._closed
    }

    private async post(path: string, body?: unknown): Promise<void> {
      const res = await fetch(`${this.url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error(`TUI request failed: ${res.status} ${path}`)
    }

    /** Append text to the TUI prompt input */
    async appendPrompt(text: string): Promise<void> {
      await this.post("/tui/append-prompt", { text })
    }

    /** Submit the current TUI prompt */
    async submitPrompt(): Promise<void> {
      await this.post("/tui/submit-prompt", {})
    }

    /** Clear the current TUI prompt */
    async clearPrompt(): Promise<void> {
      await this.post("/tui/clear-prompt", {})
    }

    /** Navigate the TUI to a specific session */
    async selectSession(sessionID: string): Promise<void> {
      await this.post("/tui/select-session", { sessionID })
    }

    /** Execute a named TUI command (e.g. "agent_cycle", "session_new") */
    async executeCommand(command: string): Promise<void> {
      await this.post("/tui/execute-command", { command })
    }

    /** Show a toast notification in the TUI */
    async showToast(
      message: string,
      variant: "info" | "success" | "warning" | "error" = "info",
    ): Promise<void> {
      await this.post("/tui/show-toast", { message, variant })
    }

    /** Open the help dialog */
    async openHelp(): Promise<void> {
      await this.post("/tui/open-help", {})
    }

    /** Open the sessions list dialog */
    async openSessions(): Promise<void> {
      await this.post("/tui/open-sessions", {})
    }

    /** Open the themes dialog */
    async openThemes(): Promise<void> {
      await this.post("/tui/open-themes", {})
    }

    /** Open the models dialog */
    async openModels(): Promise<void> {
      await this.post("/tui/open-models", {})
    }

    /** Send SIGTERM to the TUI process (no-op for connect()-created handles) */
    async close(): Promise<void> {
      this._closed = true
      this.proc?.kill("SIGTERM")
    }

    /**
     * Wait for the TUI process to exit and return its exit code.
     * Returns null immediately for connect()-created handles (no owned process).
     */
    waitForExit(): Promise<number | null> {
      if (!this.proc) return Promise.resolve(null)
      return new Promise<number | null>((resolve, reject) => {
        this.proc!.on("exit", (code) => resolve(code))
        this.proc!.on("error", reject)
      })
    }
  }

  function allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer()
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address() as net.AddressInfo
        srv.close(() => resolve(addr.port))
      })
      srv.on("error", reject)
    })
  }

  async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1000) })
        // Any response (even 404) means the HTTP server is up
        if (res.status < 500) return
      } catch {
        // Connection refused — server not up yet
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`TUI server did not become ready within ${timeoutMs}ms at ${url}`)
  }

  /**
   * Spawn a new TUI subprocess, wait until its HTTP server is ready, and return a Handle.
   *
   * The TUI inherits the parent's stdio so it renders in the same terminal.
   */
  export async function spawn(opts: SpawnOptions = {}): Promise<Handle> {
    const port = opts.port ?? (await allocatePort())
    const hostname = opts.hostname ?? "127.0.0.1"
    const bin = opts.bin ?? "argus"
    const cwd = opts.directory ?? process.cwd()

    const args: string[] = ["--port", String(port), "--hostname", hostname]
    if (opts.sessionID) args.push("-s", opts.sessionID)
    if (opts.model) args.push("-m", opts.model)
    if (opts.agent) args.push("--agent", opts.agent)
    if (opts.prompt) args.push("--prompt", opts.prompt)
    if (opts.continue) args.push("--continue")
    if (opts.fork) args.push("--fork")

    const proc = nodeSpawn(bin, args, {
      stdio: "inherit",
      cwd,
    })

    const url = `http://${hostname}:${port}`
    await waitForServer(url)
    return new Handle(url, proc)
  }

  /**
   * Connect to an already-running TUI server and return a Handle for controlling it.
   */
  export function connect(url: string, _opts: ConnectOptions = {}): Handle {
    return new Handle(url)
  }
}
