import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import { fileURLToPath } from "node:url"

const config = import.meta.resolve("@solidjs/start/config")
const runtime = fileURLToPath(new URL("../server/server-runtime.js", config))
const fnsRuntime = fileURLToPath(new URL("../server/server-fns-runtime.js", config))
const app = fileURLToPath(new URL("./src/app.tsx", import.meta.url)).replaceAll("\\", "/")

const fixSolidStartWindowsRuntime = (): PluginOption => ({
  name: "fix-solid-start-windows-runtime",
  enforce: "pre",
  resolveId(id) {
    if (process.platform !== "win32") return
    const value = id.replaceAll("\\", "").replaceAll("/", "").toLowerCase()
    if (value.includes("@solidjsstartdistserverserver-runtime")) return runtime
    if (value.includes("@solidjsstartdistserverserver-fns-runtime")) return fnsRuntime
  },
})

const fixSolidStartWindowsDefine = (): PluginOption => ({
  name: "fix-solid-start-windows-define",
  config() {
    if (process.platform !== "win32") return
    return {
      define: {
        "import.meta.env.START_APP_ENTRY": JSON.stringify(app),
      },
    }
  },
})

export default defineConfig({
  plugins: [
    fixSolidStartWindowsRuntime(),
    solidStart({
      middleware: "./src/middleware.ts",
    }) as PluginOption,
    fixSolidStartWindowsDefine(),
    nitro({
      compatibilityDate: "2024-09-19",
      preset: "cloudflare_module",
      cloudflare: {
        nodeCompat: true,
      },
    }),
  ],
  server: {
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      external: ["cloudflare:workers"],
    },
    minify: false,
  },
})
