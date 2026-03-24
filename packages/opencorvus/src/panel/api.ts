import z from "zod"

const routes = [
  { method: "GET", path: "panel/capabilities", description: "List panel tool actions available on a surface." },
  { method: "GET", path: "tasks", description: "List project tasks." },
  { method: "GET", path: "task/:taskID/board", description: "Read the full task board for a task." },
  { method: "GET", path: "task/:taskID/transcript", description: "Read the task transcript." },
  { method: "GET", path: "task/:taskID/interactions", description: "List pending and resolved task interactions." },
  { method: "PATCH", path: "task/:taskID/budget", description: "Update task run budget." },
  { method: "POST", path: "task/:taskID/retry", description: "Queue a retry for a task." },
  { method: "POST", path: "task/:taskID/replan", description: "Queue a replan for a task." },
  { method: "POST", path: "task/:taskID/cancel", description: "Cancel a task." },
  { method: "GET", path: "config", description: "Read current config." },
  { method: "PATCH", path: "config", description: "Update current config." },
  { method: "GET", path: "provider", description: "List providers and models." },
  { method: "GET", path: "provider/auth", description: "List provider auth methods." },
  { method: "GET", path: "channel", description: "List channel integrations." },
  { method: "GET", path: "executor", description: "List executors." },
  { method: "PATCH", path: "executor/:executorID/model", description: "Set executor model." },
  { method: "GET", path: "skill/installed", description: "List installed skills." },
  { method: "GET", path: "skill/market", description: "List curated market skills." },
  { method: "POST", path: "skill/install", description: "Install a skill." },
  { method: "POST", path: "skill/remove", description: "Remove a skill." },
  { method: "GET", path: "mcp", description: "Read MCP server config." },
  { method: "PATCH", path: "mcp", description: "Update MCP server config." },
  { method: "GET", path: "panel/knowledge/memory", description: "List memory entries." },
  { method: "POST", path: "panel/knowledge/memory/search", description: "Search memory entries." },
  { method: "GET", path: "panel/knowledge/preference", description: "List workbench preferences." },
  { method: "POST", path: "panel/knowledge/preference", description: "Create a workbench preference." },
  { method: "PATCH", path: "panel/knowledge/preference/:preferenceID", description: "Update a workbench preference." },
  { method: "DELETE", path: "panel/knowledge/preference/:preferenceID", description: "Delete a workbench preference." },
  { method: "GET", path: "path", description: "Read current directory/worktree path context." },
  { method: "POST", path: "path/open", description: "Open a local path with the host OS." },
  { method: "GET", path: "vcs", description: "Read current VCS status." },
  { method: "GET", path: "log/tail", description: "Read recent server logs." },
  { method: "GET", path: "global/health", description: "Read global health and version info." },
] as const

export namespace PanelApi {
  export const Route = z.object({
    method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
    path: z.string(),
    description: z.string(),
  })

  export const Catalog = z.array(Route).meta({ ref: "PanelApiCatalog" })

  export function list() {
    return Catalog.parse(routes)
  }

  export function allow(method: string, path: string) {
    const nextMethod = method.trim().toUpperCase()
    const nextPath = path.replace(/^\/+/, "").replace(/\?.*$/, "")
    return routes.some((item) => {
      if (item.method !== nextMethod) return false
      const pattern = new RegExp(`^${item.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:([A-Za-z0-9_]+)/g, "[^/]+")}$`)
      return pattern.test(nextPath)
    })
  }
}
