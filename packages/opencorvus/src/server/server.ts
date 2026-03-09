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
import { Filesystem } from "../util/filesystem"
import { ChannelAttachment } from "@/channel/attachment"
import { installRuntimeShims } from "@/runtime/shims"

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []
  let _projectDir: string | undefined

  export function url(): URL {
    return _url ?? new URL("http://localhost:7878")
  }

  function decodeDirectory(raw: string) {
    const dir = (() => {
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    })()
    return Filesystem.resolve(dir)
  }

  export type Handle = {
    hostname: string
    port: number
    url: URL
    stop(closeActiveConnections?: boolean): Promise<void>
  }

  const app = new Hono()
  export const App: () => Hono = lazy(
    () => {
      installRuntimeShims()
      return app
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
          if (
            c.req.path.startsWith("/channel/attachment/") &&
            ChannelAttachment.authorize(
              c.req.path.slice("/channel/attachment/".length),
              c.req.query("e") ?? null,
              c.req.query("s") ?? null,
            )
          )
            return next()
          const password = Flag.OPENCORVUS_SERVER_PASSWORD ?? null
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
        .use(async (c, next) => {
          // Enforce UTF-8 charset on all JSON responses to prevent encoding issues
          // (especially on Windows where terminal encoding may differ)
          await next()
          const ct = c.res.headers.get("Content-Type")
          if (ct && ct.startsWith("application/json") && !ct.includes("charset")) {
            c.res.headers.set("Content-Type", ct + "; charset=utf-8")
          }
        })
        .route("/ui", OverlayUI.routes())
        .get("/", (c) => c.redirect("/ui/"))
        .route("/global", GlobalRoutes())
        .route("/auth", AuthRoutes())
        .use(async (c, next) => {
          if (c.req.path === "/log") return next()
          const raw = c.req.query("directory") || c.req.header("x-opencorvus-directory") || _projectDir || process.cwd()
          const directory = decodeDirectory(raw)
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              return next()
            },
          })
        })
        .route("/", AppRoutes(app)) as unknown as Hono
    },
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
    projectDir?: string
  }): Handle {
    _corsWhitelist = opts.cors ?? []
    _projectDir = opts.projectDir

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
    const hostname = server.hostname ?? server.url.hostname ?? opts.hostname
    const port = server.port ?? Number(server.url.port || opts.port)
    if (!hostname) {
      throw new Error("Server started without a hostname")
    }
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("Server started without a valid port")
    }

    _url = server.url
    process.env.OPENCORVUS_SERVER_URL = server.url.origin

    const shouldPublishMDNS =
      opts.mdns &&
      port &&
      hostname !== "127.0.0.1" &&
      hostname !== "localhost" &&
      hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(port, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    return {
      hostname,
      port,
      url: server.url,
      async stop(closeActiveConnections?: boolean) {
        if (shouldPublishMDNS) MDNS.unpublish()
        await server.stop(closeActiveConnections)
      },
    }
  }
}
