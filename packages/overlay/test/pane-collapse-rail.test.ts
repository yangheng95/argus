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

test("panel header collapse controls keep side panes in place", async () => {
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
        sidebarTitleVisible: getComputedStyle(document.querySelector<HTMLElement>(".sidebar-title")!).display !== "none",
        sectionsTabsVisible: getComputedStyle(document.querySelector<HTMLElement>(".sections-tabs")!).display !== "none",
      };
    });

    expect(collapsed.sidebar.hidden).toBe(false);
    expect(collapsed.sidebar.display).toBe("flex");
    expect(Math.abs(collapsed.sidebar.width - beforeCollapse.sidebar.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.sidebar.height - beforeCollapse.sidebar.height)).toBeLessThanOrEqual(1);
    expect(collapsed.leftResizer.hidden).toBe(false);
    expect(collapsed.leftResizer.display).not.toBe("none");
    expect(collapsed.leftResizer.disabled).toBe("true");
    expect(Math.abs(collapsed.leftResizer.width - beforeCollapse.leftResizer.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.chat.width - beforeCollapse.chat.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.chat.height - beforeCollapse.chat.height)).toBeLessThanOrEqual(1);
    expect(collapsed.sections.hidden).toBe(false);
    expect(collapsed.sections.display).toBe("flex");
    expect(Math.abs(collapsed.sections.width - beforeCollapse.sections.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(collapsed.sections.height - beforeCollapse.sections.height)).toBeLessThanOrEqual(1);
    expect(collapsed.rightResizer.hidden).toBe(false);
    expect(collapsed.rightResizer.display).not.toBe("none");
    expect(collapsed.rightResizer.disabled).toBe("true");
    expect(Math.abs(collapsed.rightResizer.width - beforeCollapse.rightResizer.width)).toBeLessThanOrEqual(1);
    expect(collapsed.leftToggle.hidden).toBe(false);
    expect(collapsed.leftToggle.display).not.toBe("none");
    expect(collapsed.rightToggle.hidden).toBe(false);
    expect(collapsed.rightToggle.display).not.toBe("none");
    expect(collapsed.sidebarTitleVisible).toBe(false);
    expect(collapsed.sectionsTabsVisible).toBe(false);

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
  } finally {
    await browser.close();
    server.stop(true);
  }
});
