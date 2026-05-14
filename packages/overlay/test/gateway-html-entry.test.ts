import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HTML = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const MAIN = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")

test("Sidebar exposes a Gateway entry button (PRD §6.2)", () => {
  expect(HTML).toContain('id="btnGateway"')
  expect(HTML).toContain('data-ui="sidebar-gateway-button"')
  expect(HTML).toContain('data-i18n="gateway.open"')
})

test("Index links the gateway surface CSS so the new page styles ship", () => {
  expect(HTML).toContain('href="styles/surfaces/gateway.css"')
})

test("Index ships a dedicated Gateway mount node outside the conversation panel", () => {
  expect(HTML).toContain('id="solidGatewayMount"')
})

test("main.tsx wires the Gateway button and mounts the Gateway component", () => {
  expect(MAIN).toContain('document.getElementById("btnGateway")?.addEventListener("click"')
  expect(MAIN).toContain('setPageMode(pageMode() === "gateway" ? "panel" : "gateway")')
  expect(MAIN).toContain('document.getElementById("solidGatewayMount")')
  expect(MAIN).toContain("render(() => <Gateway />, gatewayMountEl)")
})

test("main.tsx reflects pageMode onto body[data-page-mode] (drives gateway.css visibility)", () => {
  expect(MAIN).toContain("document.body.dataset.pageMode = pageMode()")
})

test("New chat button switches back to panel mode before focusing the composer (PRD §6.3)", () => {
  // Operator clicking +New Chat from inside Gateway should not get stuck on
  // an invisible composer — the page must flip back to panel first.
  expect(MAIN).toMatch(/btnCreateTask[\s\S]*setPageMode\("panel"\)[\s\S]*selectTask\(""\)/)
})
