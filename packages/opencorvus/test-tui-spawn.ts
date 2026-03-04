import { Tui } from "./src/tui/index.ts"

try {
  console.log("cwd:", process.cwd())
  const handle = await Tui.spawn({})
  console.log("TUI started! URL:", handle.url)
  // Clean up
  await handle.close()
} catch (e: any) {
  console.error("TUI spawn failed:", e.message)
}
