import { Tui } from "./src/tui/index.ts"
try {
  const handle = await Tui.spawn({})
  console.log("TUI started! URL:", handle.url)
} catch (e: any) {
  console.error("TUI spawn failed:", e.message)
}
