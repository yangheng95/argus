import { expect, test } from "bun:test";
import { launchBrowser } from "./launch";
import { ensureOverlayDist, overlayStaticResponse } from "./overlay-dist";

await ensureOverlayDist();

function route(url: URL) {
  return url.pathname.replace(/\/+$/, "") || "/";
}

function send(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers || {}),
    },
  });
}

async function waitFor<T>(read: () => T | null, label: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("workspace terminal command opens the terminal panel with measured PTY geometry", async () => {
  let createBody: Record<string, unknown> | null = null;

  const server = Bun.serve({
    idleTimeout: 255,
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = route(url);
      if (path === "/" || path === "/ui") return Response.redirect(`${url.origin}/ui/index.html`, 302);
      const staticResponse = await overlayStaticResponse(path);
      if (staticResponse) return staticResponse;
      if (path === "/global/health") return send({ version: "1.2.3" });
      if (path === "/tasks" || path === "/global/tasks") return send({ tasks: [] });
      if (path === "/session") return send([]);
      if (path === "/path") return send({ directory: "D:/overlay/workspace/app" });
      if (path === "/vcs") return send({ branch: "dev", clean: true, dirty: false, staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 });
      if (path === "/provider") return send({ all: [], connected: [], default: {} });
      if (path === "/provider/auth") return send({});
      if (path === "/config/providers") return send({ providers: [] });
      if (path === "/config") return send({ model: "" });
      if (path === "/panel/knowledge/memory") return send([]);
      if (path === "/panel/knowledge/preference") return send([]);
      if (path === "/pty" && req.method === "GET") return send([]);
      if (path === "/pty" && req.method === "POST") {
        createBody = await req.json() as Record<string, unknown>;
        const cols = Number(createBody.cols);
        const rows = Number(createBody.rows);
        if (!Number.isFinite(cols) || cols <= 0 || !Number.isFinite(rows) || rows <= 0) {
          return send({ message: "invalid terminal dimensions" }, { status: 400 });
        }
        return send({
          id: "pty_test",
          profileID: createBody.profileID,
          title: createBody.title,
          command: "cmd.exe",
          args: [],
          cwd: createBody.cwd,
          status: "running",
          pid: 42,
          cursor: 0,
        });
      }
      return send({});
    },
  });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app");
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`);
    }, server.port);
    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui="workspace-terminal-open"]');

    const removedTogglePresent = await page.$("#btnWorkspaceToggle");
    expect(removedTogglePresent).toBeNull();

    await page.click('[data-ui="workspace-terminal-open"]');
    await page.waitForSelector(".workspace-terminal");
    const body = await waitFor(() => createBody, "terminal create request");

    expect(body.cwd).toBe("D:/overlay/workspace/app");
    expect(Number(body.cols)).toBeGreaterThan(0);
    expect(Number(body.rows)).toBeGreaterThan(0);

    const panelState = await page.evaluate(() => {
      const mount = document.querySelector<HTMLElement>("#solidWorkspaceMount");
      const view = document.querySelector<HTMLElement>('.workspace-view[data-kind="terminal"]');
      const terminal = document.querySelector<HTMLElement>(".workspace-terminal");
      const banner = document.querySelector<HTMLElement>(".workspace-terminal-banner");
      return {
        mountHidden: mount?.hidden ?? true,
        terminalActive: view?.dataset.active,
        terminalWidth: terminal?.getBoundingClientRect().width ?? 0,
        terminalHeight: terminal?.getBoundingClientRect().height ?? 0,
        errorText: banner?.textContent?.trim() ?? "",
      };
    });

    expect(panelState.mountHidden).toBe(false);
    expect(panelState.terminalActive).toBe("true");
    expect(panelState.terminalWidth).toBeGreaterThan(0);
    expect(panelState.terminalHeight).toBeGreaterThan(0);
    expect(panelState.errorText).toBe("");
  } finally {
    await browser.close();
    server.stop(true);
  }
});
