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

test("panel header controls collapse side panes to message-adjacent rails", async () => {
  const codingCliOpenBodies: Record<string, unknown>[] = [];
  const terminalOpenBodies: Record<string, unknown>[] = [];
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
      if (path === "/terminal/profiles") {
        return send({
          defaultProfileID: "powershell",
          profiles: [
            { id: "powershell", label: "Windows PowerShell", icon: "powershell" },
            { id: "cmd", label: "Command Prompt", icon: "command-prompt" },
          ],
        });
      }
      if (path === "/terminal/open" && req.method === "POST") {
        terminalOpenBodies.push(await req.json() as Record<string, unknown>);
        return send({ ok: true });
      }
      if (path === "/coding/cli/profiles") {
        return send({
          profiles: [
            { id: "codex", label: "Codex", icon: "codex" },
            { id: "claude-code", label: "Claude Code", icon: "claude-code" },
          ],
        });
      }
      if (path === "/coding/cli/open" && req.method === "POST") {
        codingCliOpenBodies.push(await req.json() as Record<string, unknown>);
        return send({ ok: true });
      }
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
      localStorage.setItem("oc_recent_directories", JSON.stringify([
        "C:/Users/chuan/myhexin-local/vibecodingclient",
        "C:/Users/chuan/myhexin-local/demos/invest复刻",
        "C:/Users/chuan/myhexin-local/Hithink.PrefabLibrary",
      ]));
      localStorage.setItem("oc_server_url", `http://127.0.0.1:${portValue}`);
      localStorage.setItem("oc_right_panel_collapsed", "false");
    }, server.port);
    await page.goto(`http://127.0.0.1:${server.port}/ui/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-ui="sidebar-header-collapse-toggle"]');
    expect(await page.$("#titlebar .workspace-layout-controls")).toBeNull();
    expect(await page.$(".workspace-command-dock .workspace-layout-controls")).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-terminal-open"]')).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-terminal-icon="powershell"] svg')).not.toBeNull();
    expect(await page.$(".workspace-command-dock .workspace-coding-cli-launchers")).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-coding-cli-open-default"]')).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-coding-cli-menu"]')).not.toBeNull();
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('.workspace-command-dock [data-ui="workspace-coding-cli-open-default"]');
      return !!button && !button.disabled;
    });
    expect(await page.$('.workspace-command-dock [data-ui="workspace-left-panel-toggle"]')).toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-right-panel-toggle"]')).toBeNull();
    expect(await page.$('.pane-edge-controls [data-ui="workspace-left-panel-toggle"]')).toBeNull();
    expect(await page.$('.pane-edge-controls [data-ui="workspace-right-panel-toggle"]')).toBeNull();
    expect(await page.$('#solidLeftActivityToolbar [data-ui="sidebar-header-collapse-toggle"]')).not.toBeNull();
    expect(await page.$('#solidRightActivityToolbar [data-ui="right-panel-header-collapse-toggle"]')).not.toBeNull();
    expect(await page.$(".workspace-command-dock .workspace-editor-launchers")).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-editor-open-default"]')).not.toBeNull();
    expect(await page.$('.workspace-command-dock [data-ui="workspace-editor-menu"]')).not.toBeNull();
    expect(await page.$('.workspace-command-dock .oc-button[data-ui="workspace-editor-launcher"]')).toBeNull();
    const editorSelectText = ((await page.$eval(
      '.workspace-command-dock [data-ui="workspace-editor-open-default"]',
      (node) => node.textContent,
    )) || "").trim();
    expect(editorSelectText).not.toContain("Open in IDE");
    const editorSelectWidth = await page.$eval(
      '.workspace-command-dock [data-ui="workspace-editor-open-default"]',
      (node) => Math.round(node.getBoundingClientRect().width),
    );
    expect(editorSelectWidth).toBeLessThanOrEqual(32);
    const launcherDimensions = await page.evaluate(() => {
      const measure = (selector: string) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing ${selector}`);
        const rect = node.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      };
      return {
        terminal: measure(".workspace-command-dock .workspace-layout-controls"),
        editor: measure(".workspace-command-dock .workspace-editor-launchers"),
        codingCli: measure(".workspace-command-dock .workspace-coding-cli-launchers"),
      };
    });
    expect(launcherDimensions.terminal).toEqual(launcherDimensions.editor);
    expect(launcherDimensions.terminal).toEqual(launcherDimensions.codingCli);
    expect(await page.$('.workspace-editor-select-icon[data-editor="vscode"] svg')).not.toBeNull();
    await page.click('.workspace-command-dock [data-ui="workspace-terminal-open"]');
    for (let i = 0; i < 40 && terminalOpenBodies.length === 0; i++) {
      await Bun.sleep(50);
    }
    expect(terminalOpenBodies).toHaveLength(1);
    expect(terminalOpenBodies[0]).toMatchObject({
      cwd: "D:/overlay/workspace/app",
      profileID: "powershell",
    });
    expect(await page.$(".workspace-terminal")).toBeNull();
    await page.click('.workspace-command-dock [data-ui="workspace-editor-menu"]');
    const editorMenuState = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('.workspace-command-dock [data-ui="workspace-editor-menu"]');
      const menu = document.querySelector<HTMLElement>(".workspace-editor-menu");
      if (!button || !menu) throw new Error("Missing workspace editor dropdown");
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      return {
        expanded: button.getAttribute("aria-expanded"),
        hidden: menu.hidden,
        portaled: !menu.closest(".workspace-command-dock"),
        topBelowButton: Math.round(menuRect.top) >= Math.round(buttonRect.bottom),
        rightAligned: Math.abs(Math.round(menuRect.right) - Math.round(buttonRect.right)) <= 1,
      };
    });
    expect(editorMenuState.expanded).toBe("true");
    expect(editorMenuState.hidden).toBe(false);
    expect(editorMenuState.portaled).toBe(true);
    expect(editorMenuState.topBelowButton).toBe(true);
    expect(editorMenuState.rightAligned).toBe(true);
    const editorIconSizes = await page.evaluate(() => {
      const entries = Array.from(document.querySelectorAll<HTMLElement>(".workspace-editor-option")).map((option) => {
        const editor = option.dataset.editor || "";
        const svg = option.querySelector<SVGElement>("svg");
        if (!editor || !svg) throw new Error("Missing editor option icon");
        const rect = svg.getBoundingClientRect();
        return [editor, Math.round(rect.width)] as const;
      });
      return Object.fromEntries(entries);
    });
    expect(editorIconSizes.vscode).toBeGreaterThanOrEqual(18);
    expect(editorIconSizes.pycharm).toBeGreaterThanOrEqual(editorIconSizes.vscode);
    expect(editorIconSizes.webstorm).toBeGreaterThanOrEqual(editorIconSizes.vscode);
    expect(editorIconSizes.intellij).toBeGreaterThanOrEqual(editorIconSizes.vscode);
    expect(editorIconSizes.cursor).toBeGreaterThanOrEqual(editorIconSizes.vscode);
    expect(await page.$('#taskDir [data-path-editor]')).toBeNull();
    expect(await page.$('[data-editor="pycharm"] svg')).not.toBeNull();
    expect(((await page.$eval('[data-editor="pycharm"]', (node) => node.textContent)) || "").trim()).toContain("PyCharm");
    await page.keyboard.press("Escape");

    await page.click('[data-ui="workspace-coding-cli-open-default"]');
    for (let i = 0; i < 40 && codingCliOpenBodies.length === 0; i++) {
      await Bun.sleep(50);
    }
    expect(codingCliOpenBodies).toHaveLength(1);
    expect(codingCliOpenBodies[0]).toMatchObject({
      cliID: "codex",
      terminalProfileID: "powershell",
      cwd: "D:/overlay/workspace/app",
    });

    await page.click(".workspace-command-dock [data-ui='workspace-terminal-menu']");
    await page.click('[data-terminal-profile="cmd"]');
    for (let i = 0; i < 40 && terminalOpenBodies.length < 2; i++) {
      await Bun.sleep(50);
    }
    expect(terminalOpenBodies).toHaveLength(2);
    expect(terminalOpenBodies[1]).toMatchObject({
      cwd: "D:/overlay/workspace/app",
      profileID: "cmd",
    });

    await page.click(".workspace-command-dock [data-ui='workspace-coding-cli-menu']");
    const cliMenuState = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>(".workspace-command-dock [data-ui='workspace-coding-cli-menu']");
      const menu = document.querySelector<HTMLElement>(".workspace-coding-cli-menu");
      if (!button || !menu) throw new Error("Missing coding CLI dropdown");
      const buttonRect = button.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      return {
        expanded: button.getAttribute("aria-expanded"),
        hidden: menu.hidden,
        portaled: !menu.closest(".workspace-command-dock"),
        topBelowButton: Math.round(menuRect.top) >= Math.round(buttonRect.bottom),
        rightAligned: Math.abs(Math.round(menuRect.right) - Math.round(buttonRect.right)) <= 1,
      };
    });
    expect(cliMenuState.expanded).toBe("true");
    expect(cliMenuState.hidden).toBe(false);
    expect(cliMenuState.portaled).toBe(true);
    expect(cliMenuState.topBelowButton).toBe(true);
    expect(cliMenuState.rightAligned).toBe(true);
    expect(await page.$('[data-coding-cli="codex"] svg')).not.toBeNull();
    await page.click('[data-coding-cli="claude-code"]');
    for (let i = 0; i < 40 && codingCliOpenBodies.length < 2; i++) {
      await Bun.sleep(50);
    }
    expect(codingCliOpenBodies).toHaveLength(2);
    expect(codingCliOpenBodies[1]).toMatchObject({
      cliID: "claude-code",
      terminalProfileID: "cmd",
      cwd: "D:/overlay/workspace/app",
    });

    await page.click('[data-menu-trigger="workspace"]');
    await page.waitForSelector(".titlebar-menubar-recent-item");
    const projectMenu = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="titlebar-menu-workspace"]');
      if (!panel) throw new Error("Missing Project menu panel");
      const rows = Array.from(panel.querySelectorAll<HTMLElement>(".titlebar-menubar-recent-item")).map((item) => {
        const name = item.querySelector<HTMLElement>(".titlebar-menubar-recent-name");
        const path = item.querySelector<HTMLElement>(".titlebar-menubar-recent-path");
        if (!name || !path) throw new Error("Missing recent row columns");
        return {
          nameLeft: Math.round(name.getBoundingClientRect().left),
          pathLeft: Math.round(path.getBoundingClientRect().left),
          pathAlign: getComputedStyle(path).textAlign,
          pathText: path.textContent || "",
        };
      });
      return {
        text: panel.textContent || "",
        rows,
      };
    });
    expect(projectMenu.text).not.toContain("PyCharm");
    expect(projectMenu.text).not.toContain("WebStorm");
    expect(projectMenu.rows).toHaveLength(3);
    expect(new Set(projectMenu.rows.map((row) => row.pathLeft)).size).toBe(1);
    expect(projectMenu.rows.every((row) => row.pathAlign === "left" || row.pathAlign === "start")).toBe(true);
    expect(projectMenu.rows.every((row) => row.pathText.startsWith("C:/Users/chuan/myhexin-local"))).toBe(true);
    await page.keyboard.press("Escape");

    const toolbarPlacement = await page.evaluate(() => {
      const leftButton = document.querySelector<HTMLElement>('[data-ui="sidebar-header-collapse-toggle"]')!;
      const rightButton = document.querySelector<HTMLElement>('[data-ui="right-panel-header-collapse-toggle"]')!;
      const left = leftButton.getBoundingClientRect();
      const right = rightButton.getBoundingClientRect();
      return {
        leftInsideActivityToolbar: Boolean(leftButton.closest("#solidLeftActivityToolbar")),
        rightInsideActivityToolbar: Boolean(rightButton.closest("#solidRightActivityToolbar")),
        leftHeight: Math.round(left.height),
        rightHeight: Math.round(right.height),
        leftWidth: Math.round(left.width),
        rightWidth: Math.round(right.width),
      };
    });
    expect(toolbarPlacement.leftInsideActivityToolbar).toBe(true);
    expect(toolbarPlacement.rightInsideActivityToolbar).toBe(true);
    expect(toolbarPlacement.leftWidth).toBeLessThanOrEqual(40);
    expect(toolbarPlacement.rightWidth).toBeLessThanOrEqual(40);
    expect(toolbarPlacement.leftHeight).toBeLessThanOrEqual(40);
    expect(toolbarPlacement.rightHeight).toBeLessThanOrEqual(40);

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
      const exists = (selector: string) => document.querySelector(selector) != null;
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
        dockLeftControlExists: exists('.workspace-command-dock [data-ui="workspace-left-panel-toggle"]'),
        dockRightControlExists: exists('.workspace-command-dock [data-ui="workspace-right-panel-toggle"]'),
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
    expect(collapsed.dockLeftControlExists).toBe(false);
    expect(collapsed.dockRightControlExists).toBe(false);

    await page.click('[data-ui="sidebar-header-collapse-toggle"]');
    await page.click('[data-ui="right-panel-header-collapse-toggle"]');

    const expanded = await page.evaluate(() => {
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
}, { timeout: 60_000 });
