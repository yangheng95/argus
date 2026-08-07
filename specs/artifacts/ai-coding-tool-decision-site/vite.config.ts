import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"

// base 使用相对路径：构建产物 dist/ 可被任意本地静态服务托管（离线可用，无运行时 CDN 依赖）
export default defineConfig({
  base: "./",
  plugins: [solid(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5178 },
  preview: { host: "127.0.0.1", port: 4178 },
})
