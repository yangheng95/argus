import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type RemoteFunction = {
  __opencorvusFunction: string
}

type RpcRequest = {
  id: number
  method: string
  params?: JsonValue
}

type RpcResponse =
  | { id: number; ok: true; result: JsonValue }
  | { id: number; ok: false; error: string; stack?: string }
  | { event: string; pageId: string; payload: JsonValue }

type EventHandler = (payload: unknown) => void | Promise<void>

export type OverlayPage = {
  setViewport(viewport: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>
  setViewportSize(viewport: { width: number; height: number }): Promise<void>
  setContent(html: string, options?: Record<string, unknown>): Promise<void>
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>
  waitForSelector(selector: string, options?: Record<string, unknown> & { visible?: boolean }): Promise<unknown>
  waitForFunction(fn: Function | string, optionsOrArg?: unknown, argOrOptions?: unknown): Promise<unknown>
  evaluate<T = unknown>(fn: Function | string, arg?: unknown): Promise<T>
  evaluateOnNewDocument(fn: Function | string, arg?: unknown): Promise<void>
  addInitScript(fn: Function | string, arg?: unknown): Promise<void>
  reload(options?: Record<string, unknown>): Promise<unknown>
  route(pattern: string, handler: (route: OverlayRoute) => Promise<void> | void): Promise<void>
  click(selector: string, options?: Record<string, unknown>): Promise<void>
  type(selector: string, text: string, options?: Record<string, unknown>): Promise<void>
  focus(selector: string): Promise<void>
  hover(selector: string): Promise<void>
  screenshot(options?: Record<string, unknown>): Promise<Buffer>
  close(): Promise<void>
  url(): Promise<string>
  content(): Promise<string>
  $(selector: string): Promise<OverlayElement | null>
  $$(selector: string): Promise<OverlayElement[]>
  $eval<T = unknown>(selector: string, fn: Function | string, arg?: unknown): Promise<T>
  $$eval<T = unknown>(selector: string, fn: Function | string, arg?: unknown): Promise<T>
  locator(selector: string): { click(options?: Record<string, unknown>): Promise<void> }
  keyboard: {
    down(key: string): Promise<void>
    up(key: string): Promise<void>
    press(key: string): Promise<void>
    type(text: string, options?: Record<string, unknown>): Promise<void>
  }
  mouse: {
    click(x: number, y: number, options?: Record<string, unknown>): Promise<void>
    move(x: number, y: number, options?: Record<string, unknown>): Promise<void>
    down(options?: Record<string, unknown>): Promise<void>
    up(options?: Record<string, unknown>): Promise<void>
  }
  on(event: string, handler: EventHandler): void
}

export type OverlayElement = {
  click(options?: Record<string, unknown>): Promise<void>
  screenshot(options?: Record<string, unknown>): Promise<Buffer>
}

export type OverlayRoute = {
  request(): {
    url(): string
    method(): string
  }
  fulfill(options: Record<string, unknown>): Promise<void>
  continue(options?: Record<string, unknown>): Promise<void>
}

export type OverlayBrowser = {
  newPage(): Promise<OverlayPage>
  close(): Promise<void>
  once(event: string, handler: () => void): void
}

let browserQueue: Promise<void> = Promise.resolve()
const browserLockDir = join(tmpdir(), "pptr-overlay-browser-lock")
const browserLockHeartbeat = join(browserLockDir, "heartbeat")
const STALE_BROWSER_LOCK_MS = 120_000

function lockedOwnerIsDead() {
  try {
    const owner = readFileSync(join(browserLockDir, "owner"), "utf8")
    const pid = Number(owner.split(/\r?\n/, 1)[0])
    if (!Number.isSafeInteger(pid) || pid <= 0) return true
    try {
      process.kill(pid, 0)
      return false
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      return code === "ESRCH"
    }
  } catch {
    return true
  }
}

async function acquireBrowserLock() {
  while (true) {
    try {
      mkdirSync(browserLockDir)
      writeFileSync(join(browserLockDir, "owner"), `${process.pid}\n${Date.now()}\n`)
      writeFileSync(browserLockHeartbeat, `${Date.now()}\n`)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code !== "EEXIST") throw error
      try {
        const lockStat = statSync(browserLockHeartbeat)
        const age = Date.now() - lockStat.mtimeMs
        if (lockedOwnerIsDead() || age > STALE_BROWSER_LOCK_MS) {
          rmSync(browserLockDir, { recursive: true, force: true })
          continue
        }
      } catch {
        rmSync(browserLockDir, { recursive: true, force: true })
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

function releaseBrowserLock() {
  try {
    rmSync(browserLockDir, { recursive: true, force: true })
  } catch {
    // ignore release races between close/disconnect handlers
  }
}

export async function launchBrowser(extraArgs?: string[]): Promise<OverlayBrowser> {
  const waitForTurn = browserQueue
  let releaseTurn!: () => void
  browserQueue = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })

  await waitForTurn
  await acquireBrowserLock()
  const heartbeat = setInterval(() => {
    writeFileSync(browserLockHeartbeat, `${Date.now()}\n`)
  }, Math.floor(STALE_BROWSER_LOCK_MS / 4))

  let released = false
  const releaseOnce = () => {
    if (released) return
    released = true
    clearInterval(heartbeat)
    releaseTurn()
    releaseBrowserLock()
  }

  try {
    const client = new OverlayBrowserSidecar(extraArgs ?? [], releaseOnce)
    await client.start()
    return client.browserProxy()
  } catch (error) {
    releaseOnce()
    throw error
  }
}

class OverlayBrowserSidecar {
  private child: ChildProcessWithoutNullStreams | undefined
  private nextId = 1
  private pending = new Map<number, { resolve: (value: JsonValue) => void; reject: (error: Error) => void }>()
  private pageHandlers = new Map<string, Map<string, EventHandler[]>>()
  private buffer = ""
  private disconnectedHandlers: Array<() => void> = []

  constructor(
    private readonly extraArgs: string[],
    private readonly release: () => void,
  ) {}

  async start() {
    const nodeExecutable = process.env.OPENCORVUS_BROWSER_MCP_NODE ?? (process.platform === "win32" ? "node.exe" : "node")
    this.child = spawn(nodeExecutable, ["-e", NODE_OVERLAY_BROWSER_SCRIPT], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENCORVUS_OVERLAY_PLAYWRIGHT_REQUIRE_PATH: createRequire(import.meta.url).resolve("playwright"),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.child.stdout.setEncoding("utf8")
    this.child.stderr.setEncoding("utf8")
    this.child.stdout.on("data", (chunk) => this.readStdout(chunk))
    this.child.stderr.on("data", (chunk) => {
      if (chunk.trim()) console.error(`[overlay-browser-node] ${chunk.trim()}`)
    })
    this.child.once("exit", () => {
      this.release()
      for (const item of this.disconnectedHandlers) item()
    })
    await this.call("launch", { extraArgs: this.extraArgs })
  }

  browserProxy(): OverlayBrowser {
    return {
      newPage: async () => {
        const id = await this.callString("newPage")
        return this.pageProxy(id)
      },
      close: async () => {
        try {
          await Promise.race([
            this.call("closeBrowser"),
            new Promise((resolve) => setTimeout(resolve, 5_000)),
          ])
        } finally {
          this.child?.kill()
          this.release()
        }
      },
      once: (event, handler) => {
        if (event === "disconnected") this.disconnectedHandlers.push(handler)
      },
    }
  }

  private pageProxy(pageId: string): OverlayPage {
    const remote = (method: string, args: unknown[] = []) => this.call("pageMethod", { pageId, method, args: encode(args) })
    return {
      setViewport: (viewport) => remote("setViewportSize", [{ width: viewport.width, height: viewport.height }]) as Promise<void>,
      setViewportSize: (viewport) => remote("setViewportSize", [viewport]) as Promise<void>,
      setContent: (html, options = {}) => remote("setContent", [html, options]) as Promise<void>,
      goto: (url, options) => remote("goto", [url, options]),
      waitForSelector: (selector, options) => remote("waitForSelector", [selector, options]),
      waitForFunction: (fn, optionsOrArg, argOrOptions) => remote("waitForFunction", [fn, optionsOrArg, argOrOptions]),
      evaluate: (fn, arg) => remote("evaluate", [fn, arg]) as Promise<unknown>,
      evaluateOnNewDocument: (fn, arg) => remote("addInitScript", [fn, arg]) as Promise<void>,
      addInitScript: (fn, arg) => remote("addInitScript", [fn, arg]) as Promise<void>,
      reload: (options = {}) => remote("reload", [options]) as Promise<unknown>,
      route: async (pattern, handler) => {
        const events = this.pageHandlers.get(pageId) ?? new Map<string, EventHandler[]>()
        events.set("route", [async (payload) => {
          const item = payload as { routeId: string; url: string; method: string }
          const route: OverlayRoute = {
            request: () => ({
              url: () => item.url,
              method: () => item.method,
            }),
            fulfill: (options) => this.call("routeAction", { routeId: item.routeId, action: "fulfill", options: encode(options) }) as Promise<void>,
            continue: (options) => this.call("routeAction", { routeId: item.routeId, action: "continue", options: encode(options) }) as Promise<void>,
          }
          try {
            await handler(route)
          } catch {
            await route.continue().catch(() => undefined)
          }
        }])
        this.pageHandlers.set(pageId, events)
        await this.call("registerRoute", { pageId, pattern })
      },
      click: (selector, options) => remote("click", [selector, options]) as Promise<void>,
      type: (selector, text, options) => remote("type", [selector, text, options]) as Promise<void>,
      focus: (selector) => remote("focus", [selector]) as Promise<void>,
      hover: (selector) => remote("hover", [selector]) as Promise<void>,
      screenshot: async (options) => decodeBuffer(await remote("screenshot", [options])),
      close: () => remote("close") as Promise<void>,
      url: () => this.callString("pageUrl", { pageId }),
      content: () => this.callString("pageMethod", { pageId, method: "content", args: [] }),
      $: async (selector) => {
        const handleId = await this.callStringOrNull("queryOne", { pageId, selector })
        return handleId ? this.elementProxy(pageId, handleId) : null
      },
      $$: async (selector) => {
        const ids = await this.call("queryAll", { pageId, selector })
        return (ids as string[]).map((handleId) => this.elementProxy(pageId, handleId))
      },
      $eval: (selector, fn, arg) => remote("$eval", [selector, fn, arg]) as Promise<unknown>,
      $$eval: (selector, fn, arg) => remote("$$eval", [selector, fn, arg]) as Promise<unknown>,
      locator: (selector) => ({
        click: (options) => remote("locatorClick", [selector, options]) as Promise<void>,
      }),
      keyboard: {
        down: (key) => remote("keyboard.down", [key]) as Promise<void>,
        up: (key) => remote("keyboard.up", [key]) as Promise<void>,
        press: (key) => remote("keyboard.press", [key]) as Promise<void>,
        type: (text, options) => remote("keyboard.type", [text, options]) as Promise<void>,
      },
      mouse: {
        click: (x, y, options = {}) => remote("mouse.click", [x, y, options]) as Promise<void>,
        move: (x, y, options = {}) => remote("mouse.move", [x, y, options]) as Promise<void>,
        down: (options = {}) => remote("mouse.down", [options]) as Promise<void>,
        up: (options = {}) => remote("mouse.up", [options]) as Promise<void>,
      },
      on: (event, handler) => {
        const events = this.pageHandlers.get(pageId) ?? new Map<string, EventHandler[]>()
        const handlers = events.get(event) ?? []
        handlers.push(handler)
        events.set(event, handlers)
        this.pageHandlers.set(pageId, events)
        void this.call("registerPageEvent", { pageId, event })
      },
    } as OverlayPage
  }

  private elementProxy(pageId: string, handleId: string): OverlayElement {
    return {
      click: (options) => this.call("elementMethod", { pageId, handleId, method: "click", args: encode([options]) }) as Promise<void>,
      screenshot: async (options) =>
        decodeBuffer(await this.call("elementMethod", { pageId, handleId, method: "screenshot", args: encode([options]) })),
    }
  }

  private readStdout(chunk: string) {
    this.buffer += chunk
    while (true) {
      const index = this.buffer.indexOf("\n")
      if (index < 0) return
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      this.handleMessage(JSON.parse(line) as RpcResponse)
    }
  }

  private handleMessage(message: RpcResponse) {
    if ("event" in message) {
      const handlers = this.pageHandlers.get(message.pageId)?.get(message.event) ?? []
      const payload = decodeEvent(message.event, message.payload)
      for (const handler of handlers) void handler(payload)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(decode(message.result))
    else pending.reject(Object.assign(new Error(message.error), { stack: message.stack }))
  }

  private call(method: string, params?: unknown): Promise<JsonValue> {
    if (!this.child) throw new Error("Overlay browser sidecar is not started")
    const id = this.nextId++
    const request: RpcRequest = { id, method, params: encode(params) as JsonValue }
    this.child.stdin.write(`${JSON.stringify(request)}\n`)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  private async callString(method: string, params?: unknown) {
    const value = await this.call(method, params)
    if (typeof value !== "string") throw new Error(`${method} did not return a string`)
    return value
  }

  private async callStringOrNull(method: string, params?: unknown) {
    const value = await this.call(method, params)
    if (value === null || typeof value === "string") return value
    throw new Error(`${method} did not return a string or null`)
  }
}

function encode(value: unknown): JsonValue | RemoteFunction {
  if (typeof value === "function") return { __opencorvusFunction: value.toString() }
  if (value === undefined) return null
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Buffer.isBuffer(value)) return { __opencorvusBuffer: value.toString("base64") } as unknown as JsonValue
  if (Array.isArray(value)) return value.map((item) => encode(item) as JsonValue)
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = encode(item) as JsonValue
    return out
  }
  return String(value)
}

function decode(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(decode) as JsonValue
  if (value && typeof value === "object") {
    if (typeof value.__opencorvusBuffer === "string") return Buffer.from(value.__opencorvusBuffer, "base64") as unknown as JsonValue
    const out: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value)) out[key] = decode(item as JsonValue)
    return out
  }
  return value
}

function decodeBuffer(value: JsonValue): Buffer {
  const decoded = decode(value)
  if (Buffer.isBuffer(decoded)) return decoded
  if (decoded && typeof decoded === "object" && typeof (decoded as Record<string, unknown>).__opencorvusBuffer === "string") {
    return Buffer.from((decoded as Record<string, string>).__opencorvusBuffer, "base64")
  }
  return Buffer.alloc(0)
}

function decodeEvent(event: string, payload: JsonValue) {
  if (event === "console" && payload && typeof payload === "object") {
    const item = payload as { type?: string; text?: string }
    return { type: () => item.type ?? "", text: () => item.text ?? "" }
  }
  if (event === "response" && payload && typeof payload === "object") {
    const item = payload as { url?: string; status?: number; statusText?: string }
    return { url: () => item.url ?? "", status: () => item.status ?? 0, statusText: () => item.statusText ?? "" }
  }
  if (event === "requestfailed" && payload && typeof payload === "object") {
    const item = payload as { url?: string; method?: string; errorText?: string }
    return {
      url: () => item.url ?? "",
      method: () => item.method ?? "GET",
      failure: () => ({ errorText: item.errorText ?? "request failed" }),
    }
  }
  if (event === "pageerror" && payload && typeof payload === "object") {
    const item = payload as { message?: string; stack?: string }
    return Object.assign(new Error(item.message ?? "page error"), { stack: item.stack })
  }
  return payload
}

const NODE_OVERLAY_BROWSER_SCRIPT = String.raw`
const fs = require("node:fs/promises");
const readline = require("node:readline");
const { chromium } = require(process.env.OPENCORVUS_OVERLAY_PLAYWRIGHT_REQUIRE_PATH || "playwright");

const browsers = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

let browser;
const pages = new Map();
const handles = new Map();
const routes = new Map();
const registeredEvents = new Set();
let nextPageId = 1;
let nextHandleId = 1;
let nextRouteId = 1;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function ok(id, result) {
  send({ id, ok: true, result: encode(result) });
}

function fail(id, error) {
  send({ id, ok: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
}

function encode(value, seen = new WeakSet()) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { __opencorvusBuffer: Buffer.from(value).toString("base64") };
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => encode(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return null;
    seen.add(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = encode(item, seen);
    return out;
  }
  return String(value);
}

function decode(value) {
  if (value && typeof value === "object" && typeof value.__opencorvusFunction === "string") {
    return eval("(" + value.__opencorvusFunction + ")");
  }
  if (value && typeof value === "object" && typeof value.__opencorvusBuffer === "string") {
    return Buffer.from(value.__opencorvusBuffer, "base64");
  }
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = decode(item);
    return out;
  }
  return value;
}

async function findBrowser() {
  const explicit = process.env.OPENCORVUS_BROWSER_EXECUTABLE || process.env.BROWSER_EXECUTABLE;
  if (explicit) return explicit;
  for (const item of browsers) {
    try {
      await fs.access(item);
      return item;
    } catch {}
  }
  throw new Error("No local Edge/Chrome executable found for overlay test");
}

async function callPage(page, method, rawArgs) {
  const args = decode(rawArgs || []);
  if (method === "setViewportSize") return page.setViewportSize(args[0]);
  if (method === "goto") {
    const response = await page.goto(args[0], args[1] || {});
    return response ? { url: response.url(), status: response.status() } : null;
  }
  if (method === "waitForSelector") {
    const [selector, options] = args;
    const { visible, ...rest } = options || {};
    const handle = await page.waitForSelector(selector, visible === undefined ? rest : { ...rest, state: visible ? "visible" : "hidden" });
    return Boolean(handle);
  }
  if (method === "waitForFunction") {
    const [fn, optionsOrArg, argOrOptions] = args;
    if (args.length >= 3) {
      await page.waitForFunction(fn, argOrOptions, optionsOrArg || {});
      return true;
    }
    const looksLikeOptions = optionsOrArg && typeof optionsOrArg === "object" && ("timeout" in optionsOrArg || "polling" in optionsOrArg);
    if (looksLikeOptions) await page.waitForFunction(fn, undefined, optionsOrArg);
    else await page.waitForFunction(fn, optionsOrArg);
    return true;
  }
  if (method === "$eval") return page.$eval(args[0], args[1], args[2]);
  if (method === "$$eval") return page.$$eval(args[0], args[1], args[2]);
  if (method === "locatorClick") return page.locator(args[0]).click(args[1] || {});
  if (method.includes(".")) {
    const [owner, fn] = method.split(".");
    await page[owner][fn](...args);
    return null;
  }
  const result = await page[method](...args);
  if (result === undefined) return null;
  return result;
}

function pageEventPayload(event, item) {
  if (event === "console") return { type: item.type(), text: item.text() };
  if (event === "response") return { url: item.url(), status: item.status(), statusText: item.statusText() };
  if (event === "requestfailed") return { url: item.url(), method: item.method(), errorText: item.failure()?.errorText || "request failed" };
  if (event === "pageerror") return { message: item.message, stack: item.stack };
  return String(item);
}

async function handle(request) {
  const { id, method } = request;
  const params = decode(request.params || {});
  if (method === "launch") {
    const executablePath = await findBrowser();
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check", ...(params.extraArgs || [])],
    });
    return ok(id, true);
  }
  if (method === "newPage") {
    const page = await browser.newPage();
    const pageId = "page_" + nextPageId++;
    pages.set(pageId, page);
    return ok(id, pageId);
  }
  if (method === "closeBrowser") {
    await browser?.close().catch(() => undefined);
    return ok(id, true);
  }
  if (method === "pageUrl") {
    return ok(id, pages.get(params.pageId).url());
  }
  if (method === "pageMethod") {
    return ok(id, await callPage(pages.get(params.pageId), params.method, params.args));
  }
  if (method === "queryOne") {
    const handle = await pages.get(params.pageId).$(params.selector);
    if (!handle) return ok(id, null);
    const handleId = "handle_" + nextHandleId++;
    handles.set(handleId, handle);
    return ok(id, handleId);
  }
  if (method === "queryAll") {
    const found = await pages.get(params.pageId).$$(params.selector);
    const ids = found.map((handle) => {
      const handleId = "handle_" + nextHandleId++;
      handles.set(handleId, handle);
      return handleId;
    });
    return ok(id, ids);
  }
  if (method === "elementMethod") {
    const handle = handles.get(params.handleId);
    return ok(id, await handle[params.method](...(decode(params.args || []))));
  }
  if (method === "registerPageEvent") {
    const key = params.pageId + ":" + params.event;
    if (!registeredEvents.has(key)) {
      registeredEvents.add(key);
      pages.get(params.pageId).on(params.event, (item) => {
        send({ event: params.event, pageId: params.pageId, payload: encode(pageEventPayload(params.event, item)) });
      });
    }
    return ok(id, true);
  }
  if (method === "registerRoute") {
    const page = pages.get(params.pageId);
    await page.route(params.pattern, async (route) => {
      const routeId = "route_" + nextRouteId++;
      const request = route.request();
      await new Promise((resolve) => {
        routes.set(routeId, { route, resolve });
        send({
          event: "route",
          pageId: params.pageId,
          payload: encode({ routeId, url: request.url(), method: request.method() }),
        });
      });
    });
    return ok(id, true);
  }
  if (method === "routeAction") {
    const pending = routes.get(params.routeId);
    if (!pending) return ok(id, false);
    routes.delete(params.routeId);
    if (params.action === "fulfill") await pending.route.fulfill(decode(params.options || {}));
    else await pending.route.continue(decode(params.options || {}));
    pending.resolve();
    return ok(id, true);
  }
  throw new Error("Unknown overlay browser RPC method: " + method);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  try {
    await handle(request);
  } catch (error) {
    fail(request.id, error);
  }
});

process.on("SIGTERM", () => browser?.close().finally(() => process.exit(0)));
process.on("SIGINT", () => browser?.close().finally(() => process.exit(130)));
`;
