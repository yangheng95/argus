import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")

describe("embedded OpenTUI renderer", () => {
  test("captures styled spans and accepts mock keyboard input without a PTY websocket", async () => {
    const proc = Bun.spawn(
      [
        process.execPath,
        "--preload",
        "@opentui/solid/preload",
        "--conditions=browser",
        path.join(ROOT, "test/fixtures/embedded-renderer-probe.tsx"),
      ],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    expect(stderr).toBe("")
    expect(code).toBe(0)
    const result = JSON.parse(stdout) as { title: string; titleFg: string; titleBg: string; frame: string }
    expect(result.title).toContain("OpenCorvus renderer")
    expect(result.titleFg).not.toBe(result.titleBg)
    expect(result.frame).toContain("OpenTUI embed probe submitted")
  }, 30_000)

  test("renders slot fallback content before the plugin runtime finishes installing host slots", async () => {
    const proc = Bun.spawn(
      [
        process.execPath,
        "--preload",
        "@opentui/solid/preload",
        "--conditions=browser",
        path.join(ROOT, "test/fixtures/tui-slot-fallback-probe.tsx"),
      ],
      {
        cwd: ROOT,
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    expect(stderr).toBe("")
    expect(code).toBe(0)
    const result = JSON.parse(stdout) as { frame: string }
    expect(result.frame).toContain("slot fallback visible")
  }, 30_000)

  test("server embed routes reuse the real TUI root instead of the retired PTY browser terminal", () => {
    const app = readFileSync(path.join(ROOT, "src/cli/cmd/tui/app.tsx"), "utf8")
    const home = readFileSync(path.join(ROOT, "src/cli/cmd/tui/routes/home.tsx"), "utf8")
    const slots = readFileSync(path.join(ROOT, "src/cli/cmd/tui/plugin/slots.tsx"), "utf8")
    const embedded = readFileSync(path.join(ROOT, "src/tui/embedded.ts"), "utf8")
    const worker = readFileSync(path.join(ROOT, "src/tui/embedded-worker.tsx"), "utf8")
    const routes = readFileSync(path.join(ROOT, "src/server/routes/tui.ts"), "utf8")

    expect(app).toContain("export function TuiRoot")
    expect(app).toContain("return <TuiRoot {...input} mode={mode} onExit={onExit} />")
    expect(app).toContain('flexDirection="column"')
    expect(home).toContain('width="100%" flexGrow={1} flexDirection="column"')
    expect(home).toContain("<Logo />")
    expect(home).toContain("<BgPulse />")
    expect(home).not.toContain("logo-slot-diagnostic")
    expect(slots).toContain("function fallback")
    expect(slots).toContain("notifySlotRevision()")
    expect(embedded).toContain('"--preload", "@opentui/solid/preload", "--conditions=browser"')
    expect(embedded).toContain('z.enum(["dark", "light"])')
    expect(embedded).toContain('mode: "dark" | "light" | null')
    expect(embedded).toContain("embedded-worker.tsx")
    expect(embedded).toContain('new URL("../..", import.meta.url)')
    expect(embedded).toContain("closed: false")
    expect(embedded).not.toContain("process.killed")
    expect(worker).toContain("await testRender(")
    expect(worker).toContain("<TuiRoot")
    expect(worker).toContain("mode={input.mode}")
    expect(worker).toContain("mode: current.mode")
    expect(worker).toContain("await current.setup.renderOnce()")
    expect(worker).not.toContain("current.setup.flush")
    expect(worker).toContain("captureSpans()")
    expect(worker).toContain("let queue = Promise.resolve()")
    expect(worker).toContain("enqueue(request)")
    expect(worker).toContain("mockInput.typeText")
    expect(routes).toContain('"/embed/start"')
    expect(routes).toContain('"/embed/input"')
    expect(routes).toContain('"/embed/resize"')
    expect(routes).toContain("EmbeddedTui.start")
    expect(embedded).not.toContain("TuiRoot")
    expect(embedded).not.toContain("TuiHost")
    expect(embedded).not.toContain("Pty")
    expect(embedded).not.toContain("WebSocket")
  })
})
