import serverDefaults from "../../../opencorvus/server-defaults.json"

const DEFAULT_LOCAL_SERVER_URL = `http://${serverDefaults.host}:${serverDefaults.port}`

export const DEFAULT_SERVER = (() => {
  if (
    typeof window !== "undefined" &&
    window.location.protocol.startsWith("http") &&
    window.location.pathname.startsWith("/ui")
  ) {
    return window.location.origin
  }
  return DEFAULT_LOCAL_SERVER_URL
})()
