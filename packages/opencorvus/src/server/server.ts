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
import { NotFoundError } from "../storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { AuthRoutes } from "./routes/auth"
import { AppDocumentation, AppRoutes } from "./routes/app"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { OverlayUI } from "./overlay-ui"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []

  export function url(): URL {
    return _url ?? new URL("http://localhost:7878")
  }

  function decodeDirectory(raw: string) {
    let dir: string
    try {
      dir = decodeURIComponent(raw)
    } catch {
      dir = raw
    }
    // Convert MINGW/MSYS-style paths to Windows paths.
    // MINGW shells set paths like /d/foo/bar which Node's path.resolve
    // misinterprets as D:\d\foo\bar (relative to drive root) instead of D:\foo\bar.
    if (process.platform === "win32") {
      const m = dir.match(/^\/([a-zA-Z])(\/.*)?$/)
      if (m) {
        dir = `${m[1].toUpperCase()}:${m[2] || "\\"}`
      }
    }
    return dir
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
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          if (err instanceof HTTPException) return err.getResponse()
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
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
        .route("/ui", OverlayUI.routes())
        .get("/", (c) => c.redirect("/ui/"))
        .route("/global", GlobalRoutes())
        .route("/auth", AuthRoutes())
        .use(async (c, next) => {
          if (c.req.path === "/log") return next()
          const raw = c.req.query("directory") || c.req.header("x-opencorvus-directory") || process.cwd()
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
    const server = opts.port === 0 ? (tryServe(7878) ?? tryServe(0)) : tryServe(opts.port)
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
