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

test("workspace layout controls collapse both side panes without residual width", async () => {
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
    await page.waitForSelector('.workspace-command-dock [data-ui="workspace-left-panel-toggle"]');
    expect(await page.$("#titlebar .workspace-layout-controls")).toBeNull();
    expect(await page.$(".workspace-command-dock .workspace-layout-controls")).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-left-panel-toggle"]')).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-right-panel-toggle"]')).not.toBeNull();
    expect(await page.$('.pane-edge-controls [data-ui="workspace-left-panel-toggle"]')).toBeNull();
    expect(await page.$('.pane-edge-controls [data-ui="workspace-right-panel-toggle"]')).toBeNull();
    expect(await page.$(".workspace-command-dock .workspace-editor-launchers")).not.toBeNull();
    expect(await page.$('#taskDir [data-path-editor]')).toBeNull();
    expect(await page.$('[data-editor="pycharm"] svg')).not.toBeNull();
    expect(await page.$eval('[data-editor="pycharm"]', (node) => node.textContent)).toBe("");

    const dockPlacement = await page.evaluate(() => {
      const dock = document.querySelector<HTMLElement>(".workspace-command-dock")!.getBoundingClientRect();
      const layout = document.querySelector<HTMLElement>(".workspace-command-dock .workspace-layout-controls")!.getBoundingClientRect();
      const left = document.querySelector<HTMLElement>('[data-ui="workspace-left-panel-toggle"]')!.getBoundingClientRect();
      const right = document.querySelector<HTMLElement>('[data-ui="workspace-right-panel-toggle"]')!.getBoundingClientRect();
      return {
        layoutInsideDock: layout.left >= dock.left && layout.right <= dock.right,
        leftInsideLayout: left.left >= layout.left && left.right <= layout.right,
        rightInsideLayout: right.left >= layout.left && right.right <= layout.right,
        leftHeight: Math.round(left.height),
        rightHeight: Math.round(right.height),
        leftWidth: Math.round(left.width),
        rightWidth: Math.round(right.width),
      };
    });
    expect(dockPlacement.layoutInsideDock).toBe(true);
    expect(dockPlacement.leftInsideLayout).toBe(true);
    expect(dockPlacement.rightInsideLayout).toBe(true);
    expect(dockPlacement.leftWidth).toBeLessThanOrEqual(32);
    expect(dockPlacement.rightWidth).toBeLessThanOrEqual(32);
    expect(dockPlacement.leftHeight).toBeLessThanOrEqual(32);
    expect(dockPlacement.rightHeight).toBeLessThanOrEqual(32);

    await page.click('[data-ui="workspace-left-panel-toggle"]');
    await page.click('[data-ui="workspace-right-panel-toggle"]');

    const collapsed = await page.evaluate(() => {
      const measure = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const style = getComputedStyle(node);
        return {
          hidden: node.hidden,
          display: style.display,
          width: node.getBoundingClientRect().width,
        };
      };
      const rectOf = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const rect = node.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      return {
        sidebar: measure("#sidebar"),
        leftResizer: measure("#leftPaneResizer"),
        sections: measure("#sections"),
        rightResizer: measure("#rightPaneResizer"),
        leftToggle: rectOf('[data-ui="workspace-left-panel-toggle"]'),
        rightToggle: rectOf('[data-ui="workspace-right-panel-toggle"]'),
        dock: rectOf(".workspace-command-dock"),
      };
    });

    expect(collapsed.sidebar).toEqual({ hidden: true, display: "none", width: 0 });
    expect(collapsed.leftResizer).toEqual({ hidden: true, display: "none", width: 0 });
    expect(collapsed.sections).toEqual({ hidden: true, display: "none", width: 0 });
    expect(collapsed.rightResizer).toEqual({ hidden: true, display: "none", width: 0 });
    expect(collapsed.leftToggle.left).toBeGreaterThanOrEqual(collapsed.dock.left);
    expect(collapsed.rightToggle.right).toBeLessThanOrEqual(collapsed.dock.right);
    expect(collapsed.leftToggle.width).toBeLessThanOrEqual(32);
    expect(collapsed.rightToggle.width).toBeLessThanOrEqual(32);
    expect(collapsed.leftToggle.height).toBeLessThanOrEqual(32);
    expect(collapsed.rightToggle.height).toBeLessThanOrEqual(32);
  } finally {
    await browser.close();
    server.stop(true);
  }
});
