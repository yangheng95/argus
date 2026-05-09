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

test("panel header controls collapse both side panes without residual width", async () => {
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
    await page.waitForSelector('.sidebar-header [data-ui="sidebar-header-collapse-toggle"]');
    expect(await page.$("#titlebar .workspace-layout-controls")).toBeNull();
    expect(await page.$(".workspace-command-dock .workspace-layout-controls")).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-left-panel-toggle"]')).toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-right-panel-toggle"]')).toBeNull();
    expect(await page.$('.pane-edge-controls [data-ui="workspace-left-panel-toggle"]')).toBeNull();
    expect(await page.$('.pane-edge-controls [data-ui="workspace-right-panel-toggle"]')).toBeNull();
    expect(await page.$('.sidebar-header [data-ui="sidebar-header-collapse-toggle"]')).not.toBeNull();
    expect(await page.$('.sections-header [data-ui="right-panel-header-collapse-toggle"]')).not.toBeNull();
    expect(await page.$(".workspace-command-dock .workspace-editor-launchers")).not.toBeNull();
    expect(await page.$('#taskDir [data-path-editor]')).toBeNull();
    expect(await page.$('[data-editor="pycharm"] svg')).not.toBeNull();
    expect(await page.$eval('[data-editor="pycharm"]', (node) => node.textContent)).toBe("");

    const headerPlacement = await page.evaluate(() => {
      const sidebarHeader = document.querySelector<HTMLElement>(".sidebar-header")!.getBoundingClientRect();
      const sidebarTitle = document.querySelector<HTMLElement>(".sidebar-title")!.getBoundingClientRect();
      const left = document.querySelector<HTMLElement>('[data-ui="sidebar-header-collapse-toggle"]')!.getBoundingClientRect();
      const sectionsHeader = document.querySelector<HTMLElement>(".sections-header")!.getBoundingClientRect();
      const sectionsTabs = document.querySelector<HTMLElement>("#solidRightPanelTabs")!.getBoundingClientRect();
      const right = document.querySelector<HTMLElement>('[data-ui="right-panel-header-collapse-toggle"]')!.getBoundingClientRect();
      return {
        leftInsideSidebarHeader: left.left >= sidebarHeader.left && left.right <= sidebarHeader.right,
        leftBeforeTitle: left.right <= sidebarTitle.left,
        rightInsideSectionsHeader: right.left >= sectionsHeader.left && right.right <= sectionsHeader.right,
        rightAfterTabs: right.left >= sectionsTabs.right,
        leftHeight: Math.round(left.height),
        rightHeight: Math.round(right.height),
        leftWidth: Math.round(left.width),
        rightWidth: Math.round(right.width),
      };
    });
    expect(headerPlacement.leftInsideSidebarHeader).toBe(true);
    expect(headerPlacement.leftBeforeTitle).toBe(true);
    expect(headerPlacement.rightInsideSectionsHeader).toBe(true);
    expect(headerPlacement.rightAfterTabs).toBe(true);
    expect(headerPlacement.leftWidth).toBeLessThanOrEqual(28);
    expect(headerPlacement.rightWidth).toBeLessThanOrEqual(28);
    expect(headerPlacement.leftHeight).toBeLessThanOrEqual(28);
    expect(headerPlacement.rightHeight).toBeLessThanOrEqual(28);

    await page.click('[data-ui="sidebar-header-collapse-toggle"]');
    await page.click('[data-ui="right-panel-header-collapse-toggle"]');

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
      return {
        sidebar: measure("#sidebar"),
        leftResizer: measure("#leftPaneResizer"),
        sections: measure("#sections"),
        rightResizer: measure("#rightPaneResizer"),
      };
    });

    expect(collapsed.sidebar).toEqual({ hidden: true, display: "none", width: 0 });
    expect(collapsed.leftResizer).toEqual({ hidden: true, display: "none", width: 0 });
    expect(collapsed.sections).toEqual({ hidden: true, display: "none", width: 0 });
    expect(collapsed.rightResizer).toEqual({ hidden: true, display: "none", width: 0 });
  } finally {
    await browser.close();
    server.stop(true);
  }
});
