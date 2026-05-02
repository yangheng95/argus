import { expect, test } from "bun:test";
import path from "node:path";

const overlayRoot = path.resolve(import.meta.dir, "..");

async function readSrc(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text();
}

test("panel body declares sidebar, chat, and sections as the content columns", async () => {
  const css = await readSrc("src/styles.css");
  const panelBody = css.match(/\.panel-body\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  expect(panelBody).toContain("display: grid");
  expect(panelBody).toContain('grid-template-areas: "sidebar left-resizer chat right-resizer sections"');
  expect(css).toContain("grid-area: sidebar");
  expect(css).toContain("grid-area: chat");
  expect(css).toContain("grid-area: sections");
});

test("workspace is mounted in Changes, not inside Chat", async () => {
  const html = await readSrc("src/index.html");
  const chatStart = html.indexOf('id="chatSection"');
  const chatEnd = html.indexOf('id="solidChatComposer"', chatStart);
  const workspaceAt = html.indexOf('id="solidWorkspaceMount"');
  const changesAt = html.indexOf('id="rightPanelChanges"');

  expect(chatStart).toBeGreaterThan(-1);
  expect(chatEnd).toBeGreaterThan(chatStart);
  expect(workspaceAt).toBeGreaterThan(changesAt);
  expect(workspaceAt).toBeGreaterThan(chatEnd);
  expect(html).not.toContain('id="solidWorkspaceMount" class="workspace-mount" hidden');
  expect(cssNoWorkspaceHidden(await readSrc("src/styles.css"))).toBe(true);
});

test("chat shell no longer exposes the old workspace toggle or row resizer", async () => {
  const html = await readSrc("src/index.html");
  const main = await readSrc("src/main.tsx");
  const css = await readSrc("src/styles.css");

  expect(html).not.toContain("btnWorkspaceToggle");
  expect(html).not.toContain("workspaceResizer");
  expect(main).not.toContain("btnWorkspaceToggle");
  expect(main).not.toContain("workspaceResizer");
  expect(main).not.toContain("workspaceOpen");
  expect(css).not.toContain("workspace-toggle");
  expect(css).not.toContain("pane-resizer-workspace");
});

test("right panel tabs use the Phase B IA names", async () => {
  const html = await readSrc("src/index.html");
  const main = await readSrc("src/main.tsx");
  const preview = await readSrc("src/services/frontend-preview.ts");

  expect(preview).toContain('export type RightPanelTab = "plan" | "evaluation" | "changes" | "preview"');
  for (const id of ["rightPanelPlan", "rightPanelEvaluation", "rightPanelChanges", "rightPanelPreview"]) {
    expect(html).toContain(`id="${id}"`);
  }
  expect(main).toContain('selectRightPanelTab("plan")');
  expect(main).toContain('selectRightPanelTab("evaluation")');
  expect(main).toContain('selectRightPanelTab("changes")');
  expect(main).toContain('selectRightPanelTab("preview")');
  expect(main).not.toContain('selectRightPanelTab("inspector")');
  expect(main).not.toContain('selectRightPanelTab("workflow")');
});

test("right pane resizing is anchored to the three-column panel body", async () => {
  const pane = await readSrc("src/services/pane.ts");

  expect(pane).toContain('document.getElementById("panelBody")');
  expect(pane).not.toContain('document.getElementById("workspaceMain")');
  expect(pane).toContain("rect.width - sidebar - leftHandle - rightHandle - chatMin");
});

test("TaskStatusHeader is mounted once in the titlebar utility", async () => {
  const html = await readSrc("src/index.html");
  const main = await readSrc("src/main.tsx");
  const component = await readSrc("src/components/TaskStatusHeader.tsx");

  const chatHeader = html.match(/<header class="chat-header">[\s\S]*?<\/header>/)?.[0] ?? "";
  const titlebarUtility = html.match(/<div class="titlebar-utility">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
  const mounts = [...main.matchAll(/render\(\(\) => <TaskStatusHeader \/>/g)];

  expect(chatHeader).not.toContain("solidTaskStatusMount");
  expect(titlebarUtility).toContain('id="solidTaskStatusMount"');
  expect(mounts).toHaveLength(1);
  expect(component).toContain('class="task-status titlebar-task-status"');
  expect(component).not.toContain("chat-task-status");
});

function cssNoWorkspaceHidden(css: string): boolean {
  return !/\.workspace-mount\[hidden\]/.test(css);
}
