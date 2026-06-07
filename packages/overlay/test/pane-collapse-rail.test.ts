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

test("left side panel collapses while its panel root stays permanently mounted", async () => {
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
      if (path === "/agent") return send([]);
      if (path === "/channel") return send([]);
      if (path === "/executor") return send([]);
      if (path === "/skill/installed" || path === "/skill") return send([]);
      if (path === "/mcp") return send({});
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
      localStorage.setItem("oc_sidebar_collapsed", "false");
    }, server.port);
    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui="sidebar-header-collapse-toggle"]');
    expect(await page.$('[data-ui="sidebar-header-collapse-toggle"]')).not.toBeNull();
    expect(await page.$("#solidLeftActivityToolbar")).toBeNull();
    expect(await page.$('[data-ui="right-panel-header-collapse-toggle"]')).toBeNull();
    expect(await page.$("#rightPaneResizer")).toBeNull();

    const beforeCollapse = await page.evaluate(() => {
      const measure = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          hidden: node.hidden,
          display: style.display,
          width: rect.width,
          height: rect.height,
          disabled: node.dataset.disabled || "",
        };
      };
      return {
        sidebar: measure("#sidebar"),
        leftResizer: measure("#leftPaneResizer"),
        leftRail: measure(".sidebar-collapsed-rail"),
        chat: measure("#chatSection"),
      };
    });

    await page.click('[data-ui="sidebar-header-collapse-toggle"]');

    const leftCollapsed = await page.evaluate(() => {
      const measure = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          hidden: node.hidden,
          display: style.display,
          width: rect.width,
          height: rect.height,
          disabled: node.dataset.disabled || "",
        };
      };
      return {
        sidebar: measure("#sidebar"),
        leftResizer: measure("#leftPaneResizer"),
        leftRail: measure(".sidebar-collapsed-rail"),
        leftToggle: measure('.sidebar-collapsed-rail [data-ui="sidebar-header-collapse-toggle"]'),
        taskPanelMounted: !!document.querySelector("#leftPanelTasks"),
        sidebarContentVisible: getComputedStyle(document.querySelector<HTMLElement>("#sidebar .side-panel-content")!).display !== "none",
      };
    });

    expect(leftCollapsed.sidebar.hidden).toBe(false);
    expect(leftCollapsed.sidebar.display).toBe("flex");
    expect(leftCollapsed.sidebar.width).toBeLessThanOrEqual(48);
    expect(leftCollapsed.sidebar.width).toBeLessThan(beforeCollapse.sidebar.width / 2);
    expect(leftCollapsed.leftResizer.hidden).toBe(true);
    expect(leftCollapsed.leftResizer.display).toBe("none");
    expect(leftCollapsed.leftResizer.disabled).toBe("true");
    expect(leftCollapsed.leftRail.display).toBe("flex");
    expect(leftCollapsed.leftToggle.hidden).toBe(false);
    expect(leftCollapsed.leftToggle.display).not.toBe("none");
    expect(leftCollapsed.taskPanelMounted).toBe(true);
    expect(leftCollapsed.sidebarContentVisible).toBe(false);

    await page.click('.sidebar-collapsed-rail [data-ui="sidebar-header-collapse-toggle"]');

    const leftExpanded = await page.evaluate(() => {
      const measure = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const style = getComputedStyle(node);
        return {
          hidden: node.hidden,
          display: style.display,
          width: node.getBoundingClientRect().width,
          disabled: node.dataset.disabled || "",
        };
      };
      return {
        sidebar: measure("#sidebar"),
        leftResizer: measure("#leftPaneResizer"),
        leftRail: measure(".sidebar-collapsed-rail"),
        sidebarContentVisible: getComputedStyle(document.querySelector<HTMLElement>("#sidebar .side-panel-content")!).display !== "none",
      };
    });

    expect(leftExpanded.sidebar.hidden).toBe(false);
    expect(Math.abs(leftExpanded.sidebar.width - beforeCollapse.sidebar.width)).toBeLessThanOrEqual(1);
    expect(leftExpanded.leftResizer.hidden).toBe(false);
    expect(leftExpanded.leftResizer.disabled).toBe("false");
    expect(leftExpanded.leftRail.display).toBe("none");
    expect(leftExpanded.sidebarContentVisible).toBe(true);

  } finally {
    await browser.close();
    server.stop(true);
  }
}, { timeout: 60_000 });
