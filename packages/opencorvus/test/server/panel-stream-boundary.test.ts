import { expect, test } from "bun:test"

test("panel message stream owns SSE write failures", async () => {
  const source = await Bun.file(new URL("../../src/server/routes/panel.ts", import.meta.url)).text()
  const routeStart = source.indexOf('"/message/stream"')
  const nextRoute = source.indexOf("// === knowledge", routeStart)
  const route = source.slice(routeStart, nextRoute)

  expect(route).toContain("const writeData = (event: unknown) =>")
  expect(route).toContain("writes = writes")
  expect(route).toContain(".catch((error) =>")
  expect(route).toContain("void writeData(event)")
  expect(route).toContain("await writes")
  expect(route).toContain("panel message stream write failed")
  expect(route).not.toContain("ControlMessage.handleStream(input, async (event)")
})
