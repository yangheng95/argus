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

async function waitFor<T>(read: () => T | null | Promise<T | null>, label: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("workspace terminal command opens the terminal panel with measured PTY geometry", async () => {
  const createBodies: Record<string, unknown>[] = [];

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
      if (path === "/coding/cli/profiles") return send({ profiles: [] });
      if (path === "/pty/profiles") {
        return send({
          defaultProfileID: "default",
          profiles: [
            { id: "default", label: "PowerShell", icon: "powershell" },
            { id: "cmd", label: "Command Prompt", icon: "command-prompt" },
          ],
        });
      }
      if (path === "/pty" && req.method === "GET") return send([]);
      if (path === "/pty" && req.method === "POST") {
        const createBody = await req.json() as Record<string, unknown>;
        createBodies.push(createBody);
        const cols = Number(createBody.cols);
        const rows = Number(createBody.rows);
        if (!Number.isFinite(cols) || cols <= 0 || !Number.isFinite(rows) || rows <= 0) {
          return send({ message: "invalid terminal dimensions" }, { status: 400 });
        }
        return send({
          id: `pty_test_${createBodies.length}`,
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
    page.setDefaultTimeout(5_000);
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((portValue) => {
      localStorage.setItem("oc_directory", "D:/overlay/workspace/app");
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`);
    }, server.port);
    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui="workspace-terminal-open"]');
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-terminal-open"]');
      return !!button && !button.disabled;
    });

    const removedTogglePresent = await page.$("#btnWorkspaceToggle");
    expect(removedTogglePresent).toBeNull();

    await page.click('[data-ui="workspace-terminal-menu"]');
    await page.waitForSelector('[data-terminal-profile="default"]');
    await page.waitForSelector('[data-terminal-profile="cmd"]');
    await page.keyboard.press("Escape");
    await page.click('[data-ui="workspace-terminal-open"]');
    await page.waitForSelector(".workspace-terminal");
    const body = await waitFor(() => createBodies[0] ?? null, "terminal create request");

    expect(body.cwd).toBe("D:/overlay/workspace/app");
    expect(body.profileID).toBe("default");
    expect(body.title).toBe("PowerShell");
    expect(Number(body.cols)).toBeGreaterThan(0);
    expect(Number(body.rows)).toBeGreaterThan(0);

    const profileState = await waitFor(async () => {
      return await page.evaluate(() => {
        const profile = document.querySelector<HTMLSelectElement>('[data-ui="workspace-terminal-profile"]');
        if (!profile || profile.disabled) return null;
        return {
          value: profile.value,
          options: Array.from(profile.options).map((option) => option.value),
        };
      });
    }, "terminal profile selector");

    expect(profileState.value).toBe("default");
    expect(profileState.options).toEqual(["default", "cmd"]);

    await page.evaluate(() => {
      const profile = document.querySelector<HTMLSelectElement>('[data-ui="workspace-terminal-profile"]');
      const button = document.querySelector<HTMLButtonElement>('[data-ui="workspace-terminal-new"]');
      if (!profile) throw new Error("terminal profile selector missing");
      if (!button) throw new Error("new terminal button missing");
      profile.value = "cmd";
      profile.dispatchEvent(new Event("change", { bubbles: true }));
      button.click();
    });
    const selectedBody = await waitFor(() => createBodies[1] ?? null, "selected terminal create request");

    expect(selectedBody.cwd).toBe("D:/overlay/workspace/app");
    expect(selectedBody.profileID).toBe("cmd");
    expect(selectedBody.title).toBe("Command Prompt");

    const panelState = await page.evaluate(() => {
      const mount = document.querySelector<HTMLElement>("#solidWorkspaceMount");
      const view = document.querySelector<HTMLElement>('.workspace-view[data-kind="terminal"]');
      const terminal = document.querySelector<HTMLElement>(".workspace-terminal");
      const banner = document.querySelector<HTMLElement>(".workspace-terminal-banner");
      const profile = document.querySelector<HTMLSelectElement>('[data-ui="workspace-terminal-profile"]');
      const viewport = document.querySelector<HTMLElement>(".workspace-terminal-viewport");
      const viewportBackground = viewport ? getComputedStyle(viewport).backgroundColor : "";
      const readThemeBackground = (theme: string) => {
        document.documentElement.dataset.theme = theme;
        document.body.dataset.theme = theme;
        return viewport ? getComputedStyle(viewport).backgroundColor : "";
      };
      const lightViewportBackground = readThemeBackground("light");
      const darkViewportBackground = readThemeBackground("dark");
      return {
        mountHidden: mount?.hidden ?? true,
        terminalActive: view?.dataset.active,
        terminalWidth: terminal?.getBoundingClientRect().width ?? 0,
        terminalHeight: terminal?.getBoundingClientRect().height ?? 0,
        errorText: banner?.textContent?.trim() ?? "",
        selectedProfileID: profile?.value ?? "",
        viewportBackground,
        lightViewportBackground,
        darkViewportBackground,
      };
    });

    expect(panelState.mountHidden).toBe(false);
    expect(panelState.terminalActive).toBe("true");
    expect(panelState.terminalWidth).toBeGreaterThan(0);
    expect(panelState.terminalHeight).toBeGreaterThan(0);
    expect(panelState.errorText).toBe("");
    expect(panelState.selectedProfileID).toBe("cmd");
    expect(panelState.viewportBackground).not.toBe("");
    expect(panelState.viewportBackground).not.toBe("rgb(16, 20, 24)");
    expect(panelState.lightViewportBackground).not.toBe(panelState.darkViewportBackground);
  } finally {
    await browser.close();
    server.stop(true);
  }
});
