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
    expect(main).not.toContain("btnCloseSession");
    expect(main).not.toContain("installAppDialogBridge");
  });

  test("index html no longer contains static app/session dialog shells", () => {
    expect(indexHtml).not.toContain('id="appDialog"');
    expect(indexHtml).not.toContain('id="btnAppDialogOk"');
    expect(indexHtml).not.toContain('id="sessionDialog"');
    expect(indexHtml).not.toContain('id="btnCloseSession"');
  });

  test("host components own the canonical app/session dialog ids", () => {
    expect(appHost).toContain('id="appDialog"');
    expect(appHost).toContain('id="btnAppDialogOk"');
    expect(appHost).toContain('id="appDialogBody"');
    expect(sessionHost).toContain('id="sessionDialog"');
    expect(sessionHost).toContain('id="btnCloseSession"');
    expect(sessionHost).toContain('id="sessionDialogBody"');
  });
});
