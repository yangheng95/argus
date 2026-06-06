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

test("workspace terminal command opens the selected system terminal profile", async () => {
  const openBodies: Record<string, unknown>[] = [];
  const profileRequestDirectories: string[] = [];

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
      if (path === "/vcs")
        return send({
          branch: "dev",
          clean: true,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicts: 0,
          ahead: 0,
          behind: 0,
        });
      if (path === "/provider") return send({ all: [], connected: [], default: {} });
      if (path === "/provider/auth") return send({});
      if (path === "/config/providers") return send({ providers: [] });
      if (path === "/config") return send({ model: "" });
      if (path === "/panel/knowledge/memory") return send([]);
      if (path === "/panel/knowledge/preference") return send([]);
      if (path === "/coding/cli/profiles") {
        profileRequestDirectories.push(url.searchParams.get("directory") || "");
        return send({ profiles: [] });
      }
      if (path === "/terminal/profiles") {
        profileRequestDirectories.push(url.searchParams.get("directory") || "");
        return send({
          defaultProfileID: "default",
          profiles: [
            { id: "default", label: "PowerShell", icon: "powershell" },
            { id: "cmd", label: "Command Prompt", icon: "command-prompt" },
          ],
        });
      }
      if (path === "/terminal/open" && req.method === "POST") {
        openBodies.push((await req.json()) as Record<string, unknown>);
        return send({ ok: true });
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
    const body = await waitFor(() => openBodies[0] ?? null, "terminal open request");

    expect(body.cwd).toBe("D:/overlay/workspace/app");
    expect(body.profileID).toBe("default");

    await page.click('[data-ui="workspace-terminal-menu"]');
    await page.click('[data-terminal-profile="cmd"]');
    const selectedBody = await waitFor(() => openBodies[1] ?? null, "selected terminal open request");

    expect(selectedBody.cwd).toBe("D:/overlay/workspace/app");
    expect(selectedBody.profileID).toBe("cmd");

    const panelState = await page.evaluate(() => ({
      diffViewActive: document.querySelector<HTMLElement>("#chatDiffPane")?.dataset.active ?? "missing",
      terminalPresent: !!document.querySelector(".workspace-terminal"),
    }));

    expect(panelState.diffViewActive).toBe("false");
    expect(panelState.terminalPresent).toBe(false);
    expect(profileRequestDirectories.length).toBeGreaterThan(0);
    expect(profileRequestDirectories.every((directory) => directory === "D:/overlay/workspace/app")).toBe(true);
  } finally {
    await browser.close();
    server.stop(true);
  }
});
