import { Log } from "../util/log"
import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { basicAuth } from "hono/basic-auth"
import { NamedError } from "@opencorvus-ai/util/error"
import { Flag } from "../flag/flag"
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"
import { websocket } from "hono/bun"
import z from "zod"
import { AuthRoutes } from "./routes/auth"
import { AppDocumentation } from "./routes/documentation"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { muteAISdkWarnings } from "@/runtime/shims"
import { OverlayUI } from "./overlay-ui"
import { DEFAULT_SERVER_PORT } from "./defaults"
import { requestID, serverErrorResponse } from "./error-handler"

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
  let projectRoutesApp: Hono | undefined

  export function url(): URL {
    if (!_url) throw new Error("Server.url() called before serve() — server not started")
    return _url
  }

  async function loadProjectRoutesApp(root: Hono) {
    if (projectRoutesApp) return projectRoutesApp
    const { AppRoutes } = await import("./routes/app")
    projectRoutesApp = AppRoutes(root)
    return projectRoutesApp
  }

  export async function routeInventoryApp(): Promise<Hono> {
    const { AppRoutes } = await import("./routes/app")
    const documented = AppRoutes(new Hono())
      .route("/global", GlobalRoutes())
      .route("/auth", AuthRoutes())
      .route("/ui", OverlayUI.routes())
    const routed = documented as unknown as Hono & {
      routes: Array<{ method: string }>
    }
    routed.routes = routed.routes.filter((route) => route.method !== "ALL")
    return routed
  }

  type OpenAPIParameter = {
    name?: string
    in?: string
    [key: string]: unknown
  }

  type OpenAPIOperation = {
    parameters?: OpenAPIParameter[]
    [key: string]: unknown
  }

  type OpenAPISpecWithPaths = {
    paths?: Record<string, unknown>
    [key: string]: unknown
  }

  const DIRECTORY_QUERY_PARAMETER = {
    name: "directory",
    in: "query",
    required: false,
    description:
      "Project directory for project-scoped routes. Equivalent to the x-opencorvus-directory request header.",
    schema: {
      type: "string",
    },
  } as const

  const PROJECT_DIRECTORY_BYPASS_PATHS = new Set([
    "/doc",
    "/shutdown",
    "/restart",
    "/log",
    "/log/tail",
    "/favicon.ico",
    "/global/tasks",
    "/mission",
  ])
  const PROJECT_DIRECTORY_BYPASS_PREFIXES = ["/global/", "/auth/", "/ui/"] as const
  const OPENAPI_OPERATION_METHODS = ["get", "post", "put", "patch", "delete"] as const

  function routeRequiresProjectDirectory(routePath: string) {
    const pathOnly = routePath.replace(/\/$/, "") || "/"
    if (PROJECT_DIRECTORY_BYPASS_PATHS.has(pathOnly)) return false
    if (pathOnly === "/global" || pathOnly === "/auth" || pathOnly === "/ui") return false
    return !PROJECT_DIRECTORY_BYPASS_PREFIXES.some((prefix) => pathOnly.startsWith(prefix))
  }

  function addDirectoryQueryParameter<T extends OpenAPISpecWithPaths>(spec: T) {
    for (const [routePath, pathItem] of Object.entries(spec.paths ?? {})) {
      if (!routeRequiresProjectDirectory(routePath)) continue
      if (!pathItem || typeof pathItem !== "object") continue
      const operations = pathItem as Record<string, unknown>
      for (const method of OPENAPI_OPERATION_METHODS) {
        const rawOperation = operations[method]
        if (!rawOperation || typeof rawOperation !== "object") continue
        const operation = rawOperation as OpenAPIOperation
        const existing = operation.parameters ?? []
        if (existing.some((parameter) => parameter.in === "query" && parameter.name === "directory")) continue
        operation.parameters = [DIRECTORY_QUERY_PARAMETER satisfies OpenAPIParameter, ...existing]
      }
    }
    return spec
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
        .onError(serverErrorResponse)
        .use((c, next) => {
          if (c.req.method === "OPTIONS") return next()
          const password = Flag.OPENCORVUS_SERVER_PASSWORD
          if (!password) return next()
          const username = Flag.OPENCORVUS_SERVER_USERNAME ?? "opencorvus"
          return basicAuth({ username, password })(c, next)
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log"
          const id = requestID(c)
          c.header("x-opencorvus-request-id", id)
          const started = Date.now()
          if (!skipLogging) {
            log.info("request", {
              requestID: id,
              method: c.req.method,
              path: c.req.path,
              status: "started",
            })
          }
          try {
            await next()
            if (!skipLogging) {
              log.info("request", {
                requestID: id,
                method: c.req.method,
                path: c.req.path,
                status: "completed",
                statusCode: c.res.status,
                duration: Date.now() - started,
              })
            }
          } catch (error) {
            if (!skipLogging) {
              log.error("request", {
                requestID: id,
                method: c.req.method,
                path: c.req.path,
                status: "failed",
                duration: Date.now() - started,
                error,
              })
            }
            throw error
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
          if (!routeRequiresProjectDirectory(c.req.path)) {
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
        .all("*", async (c) => {
          const projectApp = await loadProjectRoutesApp(app)
          return projectApp.fetch(c.req.raw)
        }) as unknown as Hono,
  )

  export async function openapi() {
    const result = await generateSpecs(await routeInventoryApp(), {
      documentation: AppDocumentation,
    })
    return addDirectoryQueryParameter(result)
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
