import { Log } from "../util/log"
import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import { Provider } from "../provider/provider"
import { NamedError } from "@opencorvus-ai/util/error"
import { Flag } from "../flag/flag"
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { NotFoundError } from "../storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import { AuthRoutes } from "./routes/auth"
import { AppDocumentation, AppRoutes } from "./routes/app"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { muteAISdkWarnings } from "@/runtime/shims"
import { OverlayUI } from "./overlay-ui"
import { DEFAULT_SERVER_PORT } from "./defaults"

muteAISdkWarnings()

export namespace Server {
  const log = Log.create({ service: "server" })

  /**
   * Project-scoped routes require an explicit `directory` (via `?directory=`
   * or `x-opencorvus-directory` header). Falling back to `process.cwd()`
   * silently bound the entire orchestrator to whatever directory the
   * sidecar was launched in — on darwin .app this is `/`, which made
   * every subsequent project request 500 (rule 7: no fallback).
   */
  export const DirectoryRequiredError = NamedError.create(
    "DirectoryRequiredError",
    z.object({
      message: z.string(),
    }),
  )

  let _url: URL | undefined
  let _corsWhitelist: string[] = []

  export function url(): URL {
    if (!_url) throw new Error("Server.url() called before serve() — server not started")
    return _url
  }

  function decodeDirectory(raw: string) {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }

  const app = new Hono()
  export const App: () => Hono = lazy(
    () =>
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err instanceof DirectoryRequiredError) status = 400
            else if (err instanceof Filesystem.InvalidDirectoryError) status = 400
            // R5.1 item 2: a child session does not own a config overlay;
            // "fix your input — target the root session" is a 400.
            else if (err.name === "ChildSessionConfigError") status = 400
            // WorktreeNotGitError is a precondition (the directory is reachable
            // and valid, but does not contain a `.git` repository). 412 lets
            // the overlay distinguish "fix your input" (400) from "init the
            // repo and retry" (412); the former is an irrecoverable user error,
            // the latter is a one-click recovery prompt.
            else if (err.name === "WorktreeNotGitError") status = 412
            else if (err.name.startsWith("Worktree")) status = 400
            // Direct-reply taxonomy — see orchestrator/direct-reply.ts.
            // These three are all about "this session structurally cannot
            // accept the reply you sent", which is a 4xx client situation,
            // not a server crash. The overlay reads err.name to decide
            // whether to retry, hide the reply box, or surface a generic
            // failure dialog. Without this mapping all three collapsed to
            // 500 and AgentSessionReplyBox could not tell them apart from
            // a real server error.
            else if (err.name === "InvalidReplyTargetKindError") status = 400
            else if (err.name === "BuildSessionDirectReplyError") status = 400
            else if (err.name === "ReplyTargetEnvelopeMissingError") status = 409
            else if (err.name === "SessionRuntimeContractMissingError") status = 410
            else status = 500
            return c.json(err.toObject(), { status })
          }
          if (err instanceof HTTPException) return err.getResponse()
          // audit-2026-04-29 W2-V13 — pre-fix the response body
          // returned `err.stack`, which on a managed sidecar leaks
          // the user's local repo path layout (`C:\Users\<user>\
          // ...\packages\opencorvus\src\server\...`) and node_modules
          // structure to any caller who can hit the port. The full
          // stack already lands in `log.error` above, which is the
          // right surface for the operator (who is the server admin
          // in managed mode). Send `err.message` only over the wire.
          const message = err instanceof Error ? err.message : String(err)
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .use((c, next) => {
          if (c.req.method === "OPTIONS") return next()
          const password = Flag.OPENCORVUS_SERVER_PASSWORD
          if (!password) return next()
          const username = Flag.OPENCORVUS_SERVER_USERNAME ?? "opencorvus"
          return basicAuth({ username, password })(c, next)
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log"
          if (!skipLogging) {
            log.info("request", {
              method: c.req.method,
              path: c.req.path,
            })
          }
          const timer = log.time("request", {
            method: c.req.method,
            path: c.req.path,
          })
          await next()
          if (!skipLogging) {
            timer.stop()
          }
        })
        .use(
          cors({
            origin(input) {
              if (!input) return
              if (input.startsWith("http://localhost:")) return input
              if (input.startsWith("http://127.0.0.1:")) return input
              if (
                input === "tauri://localhost" ||
                input === "http://tauri.localhost" ||
                input === "https://tauri.localhost"
              )
                return input
              if (/^https:\/\/([a-z0-9-]+\.)*opencorvus\.ai$/.test(input)) {
                return input
              }
              if (_corsWhitelist.includes(input)) {
                return input
              }
              return
            },
          }),
        )
        .route("/global", GlobalRoutes())
        .route("/auth", AuthRoutes())
        .route("/ui", OverlayUI.routes())
        .use(async (c, next) => {
          // Control-plane routes must stay available even if project bootstrap is broken.
          // /favicon.ico is browser-issued before the overlay UI sets the
          // x-opencorvus-directory header (browsers fetch favicons before
          // any app JS runs). Without this bypass it throws
          // DirectoryRequiredError on every page load — noisy in logs and
          // a real failure for non-Tauri preview windows that have no UI
          // chance to attach the directory header. Falls through to the
          // root router; if no handler matches, the request 404s cleanly.
          if (
            c.req.path === "/log"
            || c.req.path === "/shutdown"
            || c.req.path === "/restart"
            || c.req.path === "/favicon.ico"
            || c.req.path === "/global/tasks"
          ) {
            return next()
          }
          const raw = c.req.query("directory") || c.req.header("x-opencorvus-directory")
          if (!raw) {
            throw new DirectoryRequiredError({
              message: `Project-scoped route ${c.req.path} requires ?directory= query parameter or x-opencorvus-directory header`,
            })
          }
          const directory = decodeDirectory(raw)
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              return next()
            },
          })
        })
        .route("/", AppRoutes(app)) as unknown as Hono,
  )

  export async function openapi() {
    const result = await generateSpecs(App() as Hono, {
      documentation: AppDocumentation,
    })
    return result
  }

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
    /**
     * When true, port=0 maps directly to OS-assigned random port without
     * first attempting DEFAULT_SERVER_PORT. Required by managed sidecar
     * mode (vscode-extension) so multiple workspaces never collide on the
     * default port.
     */
    randomPort?: boolean
  }) {
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
      websocket: websocket,
    } as const
    let failure: unknown
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch (error) {
        failure = error
        return undefined
      }
    }
    let server: ReturnType<typeof Bun.serve> | undefined
    if (opts.randomPort) {
      if (opts.port !== 0) {
        throw new Error(`randomPort=true requires port=0, got ${opts.port}`)
      }
      server = tryServe(0)
    } else if (opts.port === 0) {
      server = tryServe(DEFAULT_SERVER_PORT) ?? tryServe(0)
    } else {
      server = tryServe(opts.port)
    }
    if (!server) {
      const detail = failure instanceof Error ? failure.message : failure ? String(failure) : "unknown"
      throw new Error(`Failed to start server on port ${opts.port}: ${detail}`)
    }

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
