import { Tui } from "./src/tui/index.ts"
try {
  const handle = await Tui.spawn({})
  console.log("SUCCESS - TUI URL:", handle.url)
} catch (e: any) {
  console.error("FAIL:", e.message)
}
