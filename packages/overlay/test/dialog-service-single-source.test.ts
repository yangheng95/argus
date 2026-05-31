import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OVERLAY_ROOT = join(import.meta.dir, "..");

function readText(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, rel), "utf8");
}

describe("app/session dialog single source", () => {
  const appDialogService = readText("src/services/app-dialog.ts");
  const dialogService = readText("src/services/dialog.ts");
  const main = readText("src/main.tsx");
  const indexHtml = readText("src/index.html");
  const appHost = readText("src/components/AppDialogHost.tsx");
  const sessionHost = readText("src/components/SessionDialogHost.tsx");
  const goalHost = readText("src/components/GoalDialogHost.tsx");
  const configHost = readText("src/components/ConfigDialogHost.tsx");

  test("app dialog service is store-backed, not bridge-backed DOM mutation", () => {
    expect(appDialogService).not.toContain("installAppDialogBridge");
    expect(appDialogService).not.toContain('document.getElementById("appDialogTitle")');
    expect(appDialogService).not.toContain('document.getElementById("appDialogBody")');
    expect(appDialogService).not.toContain("dialog.showModal()");
    expect(appDialogService).toContain('setDialogStore("app"');
    expect(appDialogService).toContain("settleAppDialog");
    expect(appDialogService).toContain("dismissAppDialog");
  });

  test("session dialog service no longer writes body/title through raw DOM", () => {
    expect(dialogService).not.toContain('document.getElementById("sessionDialogTitle")');
    expect(dialogService).not.toContain('document.getElementById("sessionDialogBody")');
    expect(dialogService).not.toContain('document.getElementById("sessionDialog")');
    expect(dialogService).not.toContain("dialog.showModal()");
    expect(dialogService).toContain("closeBuildSessionDialog");
    expect(dialogService).toContain('setDialogStore("session"');
  });

  test("main mounts host components instead of binding close buttons", () => {
    expect(main).toContain('render(() => <AppDialogHost />, appDialogHost)');
    expect(main).toContain('render(() => <SessionDialogHost />, sessionDialogHost)');
    expect(main).toContain('render(() => <GoalDialogHost />, goalDialogHost)');
    expect(main).toContain('render(() => <ConfigDialogHost />, configDialogHost)');
    expect(main).not.toContain("btnCloseSession");
    expect(main).not.toContain("installAppDialogBridge");
    expect(main).not.toContain("installGoalFormHandlers");
    expect(main).not.toContain('document.getElementById("configSidebar")?.addEventListener("click"');
  });

  test("config dialog host is mounted before async init can block settings menus", () => {
    const ensureIndex = main.indexOf("ensureConfigDialogHost()");
    const initIndex = main.indexOf("await initApp({");
    expect(ensureIndex).toBeGreaterThanOrEqual(0);
    expect(initIndex).toBeGreaterThanOrEqual(0);
    expect(ensureIndex).toBeLessThan(initIndex);
  });

  test("index html no longer contains static app/session/goal/config dialog shells", () => {
    expect(indexHtml).not.toContain('id="appDialog"');
    expect(indexHtml).not.toContain('id="btnAppDialogOk"');
    expect(indexHtml).not.toContain('id="sessionDialog"');
    expect(indexHtml).not.toContain('id="btnCloseSession"');
    expect(indexHtml).not.toContain('id="goalDialog"');
    expect(indexHtml).not.toContain('id="configDialog"');
    expect(indexHtml).not.toContain('id="btnCloseConfigDialog"');
  });

  test("host components own the canonical app/session/goal/config dialog ids", () => {
    expect(appHost).toContain('id="appDialog"');
    expect(appHost).toContain('id="btnAppDialogOk"');
    expect(appHost).toContain('id="appDialogBody"');
    expect(sessionHost).toContain('id="sessionDialog"');
    expect(sessionHost).toContain('id="btnCloseSession"');
    expect(sessionHost).toContain('id="sessionDialogBody"');
    expect(goalHost).toContain('id="goalDialog"');
    expect(goalHost).toContain('id="goalForm"');
    expect(goalHost).toContain('id="goalDescription"');
    expect(configHost).toContain('id="configDialog"');
    expect(configHost).toContain('id="configSidebar"');
    expect(configHost).toContain('id="btnCloseConfigDialog"');
  });

  test("config dialog mounts only the active settings tab body", () => {
    expect(configHost).toContain("<Show when={dialogStore.config.open}>");
    expect(configHost).toContain("renderActivePanel");
    expect(configHost).toContain("switch (dialogStore.config.activeTab)");
    expect(configHost).not.toContain('<PromptCatalog />\n            </div>\n          </div>\n          <div classList');
    expect(configHost).not.toContain('<ProvidersPanel />\n            </div>\n          </div>\n          <div classList');
    expect(configHost).not.toContain('<AgentModelsPanel />\n            </div>\n          </div>');
  });

  test("task route and queue decisions use card choices instead of select UI", () => {
    expect(appHost).toContain('dialogStore.app.kind === "task-queue-decision"');
    expect(appHost).toContain('class="app-dialog-decision__choice"');
    expect(appHost).toContain("isTaskCardDecision()");
    expect(appHost).toContain("chooseTaskDecision(option.value)");
    expect(appHost).toContain("settleAppDialog(true, dialogStore.app.epoch, value)");
    expect(appHost).toContain("isTaskCardDecision() ? undefined");
    expect(appHost).toContain("hidden: dialogStore.app.select !== true || isTaskCardDecision()");
    expect(appHost).toContain("hasTaskDecisionCountdown()");
    expect(appHost).toContain('t("task.queue_decision.countdown"');
    expect(appHost).not.toContain("!isTaskRouteDecision()) return");
  });
});
