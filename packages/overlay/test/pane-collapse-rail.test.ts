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

test("panel header collapse controls shrink side panes to header rails", async () => {
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
      if (path === "/tui/runtime/status") return send({ running: false, mode: "none", url: null, sessionID: null });
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
    await page.waitForSelector('[data-ui="sidebar-header-collapse-toggle"]');

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
        chat: measure("#chatSection"),
        sections: measure("#sections"),
        rightResizer: measure("#rightPaneResizer"),
      };
    });

    await page.click('[data-ui="sidebar-header-collapse-toggle"]');
    await page.click('[data-ui="right-panel-header-collapse-toggle"]');

    const collapsed = await page.evaluate(() => {
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
        chat: measure("#chatSection"),
        sections: measure("#sections"),
        rightResizer: measure("#rightPaneResizer"),
        leftToggle: measure('[data-ui="sidebar-header-collapse-toggle"]'),
        rightToggle: measure('[data-ui="right-panel-header-collapse-toggle"]'),
        sidebarContentVisible: getComputedStyle(document.querySelector<HTMLElement>("#sidebar .side-panel-content")!).display !== "none",
        sectionsContentVisible: getComputedStyle(document.querySelector<HTMLElement>("#sections .side-panel-content")!).display !== "none",
      };
    });

    expect(collapsed.sidebar.hidden).toBe(false);
    expect(collapsed.sidebar.display).toBe("flex");
    expect(collapsed.sidebar.width).toBeLessThanOrEqual(48);
    expect(collapsed.sidebar.width).toBeLessThan(beforeCollapse.sidebar.width / 2);
    expect(Math.abs(collapsed.sidebar.height - beforeCollapse.sidebar.height)).toBeLessThanOrEqual(1);
    expect(collapsed.leftResizer.hidden).toBe(true);
    expect(collapsed.leftResizer.display).toBe("none");
    expect(collapsed.leftResizer.disabled).toBe("true");
    expect(collapsed.leftResizer.width).toBe(0);
    expect(collapsed.chat.width).toBeGreaterThan(beforeCollapse.chat.width + 200);
    expect(Math.abs(collapsed.chat.height - beforeCollapse.chat.height)).toBeLessThanOrEqual(1);
    expect(collapsed.sections.hidden).toBe(false);
    expect(collapsed.sections.display).toBe("flex");
    expect(collapsed.sections.width).toBeLessThanOrEqual(48);
    expect(collapsed.sections.width).toBeLessThan(beforeCollapse.sections.width / 2);
    expect(Math.abs(collapsed.sections.height - beforeCollapse.sections.height)).toBeLessThanOrEqual(1);
    expect(collapsed.rightResizer.hidden).toBe(true);
    expect(collapsed.rightResizer.display).toBe("none");
    expect(collapsed.rightResizer.disabled).toBe("true");
    expect(collapsed.rightResizer.width).toBe(0);
    expect(collapsed.leftToggle.hidden).toBe(false);
    expect(collapsed.leftToggle.display).not.toBe("none");
    expect(collapsed.rightToggle.hidden).toBe(false);
    expect(collapsed.rightToggle.display).not.toBe("none");
    expect(collapsed.sidebarContentVisible).toBe(false);
    expect(collapsed.sectionsContentVisible).toBe(false);

    await page.click('[data-ui="sidebar-header-collapse-toggle"]');
    await page.click('[data-ui="right-panel-header-collapse-toggle"]');

    const expanded = await page.evaluate(() => {
      const measure = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        return {
          hidden: node.hidden,
          width: node.getBoundingClientRect().width,
          disabled: node.dataset.disabled || "",
        };
      };
      return {
        sidebar: measure("#sidebar"),
        leftResizer: measure("#leftPaneResizer"),
        sections: measure("#sections"),
        rightResizer: measure("#rightPaneResizer"),
      };
    });

    expect(expanded.sidebar.hidden).toBe(false);
    expect(Math.abs(expanded.sidebar.width - beforeCollapse.sidebar.width)).toBeLessThanOrEqual(1);
    expect(expanded.leftResizer.hidden).toBe(false);
    expect(expanded.leftResizer.disabled).toBe("false");
    expect(expanded.sections.hidden).toBe(false);
    expect(Math.abs(expanded.sections.width - beforeCollapse.sections.width)).toBeLessThanOrEqual(1);
    expect(expanded.rightResizer.hidden).toBe(false);
    expect(expanded.rightResizer.disabled).toBe("false");

    await page.setViewport({ width: 607, height: 900 });
    await page.evaluate(() => {
      localStorage.setItem("oc_sidebar_collapsed", "true");
      localStorage.setItem("oc_right_panel_collapsed", "true");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui="sidebar-header-collapse-toggle"]');

    const narrowCollapsed = await page.evaluate(() => {
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
        chat: measure("#chatSection"),
        sections: measure("#sections"),
        rightResizer: measure("#rightPaneResizer"),
      };
    });

    expect(narrowCollapsed.sidebar.hidden).toBe(false);
    expect(narrowCollapsed.sidebar.width).toBeGreaterThan(600);
    expect(narrowCollapsed.sidebar.height).toBeLessThanOrEqual(48);
    expect(narrowCollapsed.leftResizer.hidden).toBe(true);
    expect(narrowCollapsed.leftResizer.display).toBe("none");
    expect(narrowCollapsed.leftResizer.disabled).toBe("true");
    expect(narrowCollapsed.chat.height).toBeGreaterThan(500);
    expect(narrowCollapsed.sections.hidden).toBe(false);
    expect(narrowCollapsed.sections.width).toBeGreaterThan(600);
    expect(narrowCollapsed.sections.height).toBeLessThanOrEqual(48);
    expect(narrowCollapsed.rightResizer.hidden).toBe(true);
    expect(narrowCollapsed.rightResizer.display).toBe("none");
    expect(narrowCollapsed.rightResizer.disabled).toBe("true");
  } finally {
    await browser.close();
    server.stop(true);
  }
}, { timeout: 60_000 });
