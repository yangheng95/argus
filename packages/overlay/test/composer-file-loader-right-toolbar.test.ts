import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "bun:test"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(relativePath: string): string {
  return readFileSync(join(OVERLAY_ROOT, relativePath), "utf8")
}

test("composer right-side attachment loaders use the existing attachment pipeline", () => {
  const composer = read("src/components/ChatComposer.tsx")
  const css = read("src/styles/surfaces/composer.css")
  const en = read("src/i18n/en-US.json")
  const zh = read("src/i18n/zh-CN.json")

  expect(composer).toContain("function ComposerAttachmentLoaders")
  expect(composer).toContain("const SUPPORTED_COMPOSER_FILE_ACCEPT")
  expect(composer).toContain('type="file"')
  expect(composer).toContain("multiple")
  expect(composer).toContain("accept={SUPPORTED_COMPOSER_FILE_ACCEPT}")
  expect(composer).toContain('data-ui="composer-attachment-loaders"')
  expect(composer).toContain('data-ui="composer-file-loader-trigger"')
  expect(composer).toContain('data-ui="composer-folder-loader-trigger"')
  expect(composer).toContain('data-ui="composer-file-input"')
  expect(composer).toContain('data-ui="composer-folder-input"')
  expect(composer).toContain("function bindFolderInput")
  expect(composer).toContain('input.setAttribute("webkitdirectory", "")')
  expect(composer).toContain("input.value = \"\"")
  expect(composer).toContain("for (const file of files) await addAttachment(file)")
  expect(composer).toContain("for (const file of files) {")
  expect(composer).toContain("folderAttachmentFilename(file, mime)")
  expect(composer).toContain('segments.join(" - ")')
  expect(composer).toContain("onFiles={addFiles}")
  expect(composer).toContain("onFolderFiles={addFolderFiles}")
  expect(composer).toMatch(
    /<div class="chat-compose-meta">\s*<div class="chat-compose-meta-left">\s*<SelectControl<ComposerModeOption>[\s\S]*?<SelectControl<ExpertSquadOption>[\s\S]*?<\/div>\s*<div class="chat-compose-meta-right">\s*<ComposerAttachmentLoaders[\s\S]*?data-mode=\{props\.busy \? "stop" : "send"\}/,
  )
  expect(composer).not.toContain("uploadComposerFile")

  for (const fragment of [
    "image/*",
    "application/pdf",
    "text/markdown",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jsonc",
    ".tsx",
    ".zip",
  ]) {
    expect(composer).toContain(fragment)
  }

  expect(css).toContain(".composer-attachment-loaders")
  expect(css).toContain("justify-content: flex-end;")
  expect(css).toContain(".composer-attachment-input")
  expect(css).toContain(".composer-attachment-loader-trigger.oc-button")
  expect(css).toContain(".composer-attachment-loader-count")
  expect(css).toContain(".chat-compose-meta-right")
  expect(css).toMatch(/\.chat-compose-meta\s*\{[\s\S]*?flex-wrap:\s*nowrap;/)
  expect(css).toMatch(/\.chat-compose-meta-left\s*\{[\s\S]*?display:\s*flex;/)
  expect(css).toMatch(/\.chat-compose-meta-left\s*\{[\s\S]*?flex:\s*0 1 auto;/)
  expect(css).not.toMatch(/@container \(max-width: 520px\)\s*\{[\s\S]*?\.chat-compose-meta-left\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/)

  for (const key of [
    "chat.attachment_loader.file_title",
    "chat.attachment_loader.folder_title",
    "chat.attachment_loader.count",
    "chat.attach_folder_path_missing",
  ]) {
    expect(en).toContain(`"${key}"`)
    expect(zh).toContain(`"${key}"`)
  }
})

test("right toolbar opens only from explicit chat-header state", () => {
  const activityCss = read("src/styles/surfaces/activity.css")
  const pane = read("src/services/pane.ts")
  const html = read("src/index.html")
  const main = read("src/main.tsx")
  const app = read("src/components/App.tsx")
  const store = read("src/store/right-toolbar.ts")
  const toggle = read("src/components/ChatHeaderRightToolbarToggle.tsx")

  expect(html).toContain('id="solidRightActivityToolbar"')
  expect(html).toContain('id="solidChatHeaderRightToolbarToggle"')
  expect(html).not.toContain('id="solidTitlebarRightToolbarToggle"')
  expect(app).toContain("<ChatHeaderRightToolbarToggle />")
  expect(toggle).toContain('data-ui="chat-header-right-toolbar-toggle"')
  expect(toggle).toContain('data-chrome="chat-header-toolbar-toggle"')
  expect(toggle).toContain("toggleRightToolbarVisible")
  expect(store).toContain("const [rightToolbarOpen, setRightToolbarOpen] = createSignal(false)")
  expect(main).toContain("rightActivityToolbarEl.dataset.open = rightToolbarOpen() ? \"true\" : \"false\"")
  expect(main).toContain("setRightToolbarVisible(true)")
  expect(pane).toContain("remainingFixedControlIds: []")
  expect(pane).not.toContain('remainingFixedControlIds: ["solidRightActivityToolbar"]')
  expect(activityCss).toMatch(/#solidRightActivityToolbar\s*\{[\s\S]*?flex:\s*0 0 0;/)
  expect(activityCss).toMatch(/#solidRightActivityToolbar\s*\{[\s\S]*?width:\s*0;/)
  expect(activityCss).toMatch(/#solidRightActivityToolbar\s*\{[\s\S]*?min-width:\s*0;/)
  expect(activityCss).toMatch(/#solidRightActivityToolbar\s*\{[\s\S]*?pointer-events:\s*none;/)
  expect(activityCss).not.toContain("--right-toolbar-hover-target-width")
  expect(activityCss).toContain("#solidRightActivityToolbar .side-activity-toolbar")
  expect(activityCss).toContain("opacity: 0;")
  expect(activityCss).toContain("visibility: hidden;")
  expect(activityCss).not.toContain("#solidRightActivityToolbar:hover")
  expect(activityCss).not.toContain("#solidRightActivityToolbar:focus-within")
  expect(activityCss).toMatch(/#solidRightActivityToolbar\[data-open="true"\]\s*\{[\s\S]*?flex-basis:\s*var\(--ui-collapsed-pane-width\);/)
  expect(activityCss).toMatch(/#solidRightActivityToolbar\[data-open="true"\]\s*\{[\s\S]*?width:\s*var\(--ui-collapsed-pane-width\);/)
  expect(activityCss).toMatch(/#solidRightActivityToolbar\[data-open="true"\]\s*\{[\s\S]*?pointer-events:\s*auto;/)
  expect(activityCss).toContain('#solidRightActivityToolbar[data-open="true"] .side-activity-toolbar')
  expect(activityCss).toMatch(/#solidRightActivityToolbar\[data-open="true"\] \.side-activity-toolbar\s*\{[\s\S]*?visibility:\s*visible;/)
  expect(activityCss).toMatch(
    /\.side-activity-toolbar \[data-ui="side-activity-button"\]\s*\{[\s\S]*?width:\s*var\(--ui-collapsed-pane-width\);[\s\S]*?height:\s*var\(--ui-collapsed-pane-width\);/,
  )
  expect(activityCss).toMatch(
    /\.project-runtime-toolbar-actions \.oc-button\[data-toolbar-compact="true"\]\s*\{[\s\S]*?width:\s*var\(--ui-collapsed-pane-width\);[\s\S]*?height:\s*var\(--ui-collapsed-pane-width\);/,
  )
  expect(activityCss).toMatch(
    /\.project-runtime-toolbar-actions \.oc-button\[data-toolbar-compact="true"\]\s*\{[\s\S]*?--oc-button-height:\s*var\(--ui-collapsed-pane-width\);/,
  )
  expect(activityCss).not.toContain("#solidRightActivityToolbar {\n  display: none")
})

test("message panel titlebar restores the IDE project launcher and keeps chat status centered", () => {
  const html = read("src/index.html")
  const app = read("src/components/App.tsx")
  const editor = read("src/components/WorkspaceEditorLaunchers.tsx")
  const titlebarCss = read("src/styles/surfaces/titlebar.css")
  const headerCss = read("src/styles/surfaces/header.css")
  const conversationCss = read("src/styles/surfaces/conversation.css")
  const en = read("src/i18n/en-US.json")
  const zh = read("src/i18n/zh-CN.json")

  expect(html).toContain('class="chat-header-actions"')
  expect(html).toContain('id="solidChatHeaderEditorLaunchers"')
  expect(html).toContain('id="solidChatHeaderRightToolbarToggle"')
  expect(html).not.toContain('id="solidTitlebarEditorLaunchers"')
  expect(html).not.toContain('id="solidTitlebarRightToolbarToggle"')
  expect(app).toContain("<WorkspaceEditorLaunchers />")
  expect(editor).toContain("openDirectoryInEditor")
  expect(editor).toContain('primaryDataUI="workspace-editor-open-default"')
  expect(editor).toContain('class="workspace-editor-primary-label"')
  expect(en).toContain('"workspace.editor_open"')
  expect(zh).toContain('"workspace.editor_open"')
  expect(titlebarCss).not.toContain("#solidTitlebarEditorLaunchers")
  expect(titlebarCss).not.toContain("#solidTitlebarRightToolbarToggle")
  expect(titlebarCss).not.toContain('.titlebar-utility .workspace-editor-launchers')
  expect(titlebarCss).not.toContain('.titlebar-utility .oc-button[data-chrome="titlebar-toolbar-toggle"]')
  expect(conversationCss).toContain(".chat-header-actions")
  expect(conversationCss).toContain("#solidChatHeaderEditorLaunchers")
  expect(conversationCss).toContain('.chat-header-meta .workspace-editor-launchers')
  expect(conversationCss).toContain('.chat-header-meta .oc-button[data-chrome="chat-header-toolbar-toggle"]')
  expect(headerCss).toContain("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);")
  expect(conversationCss).toMatch(/\.chat-header-status\s*\{[\s\S]*?grid-column:\s*2;/)
  expect(conversationCss).not.toContain(".chat-header-status {\n    display: none;")
})
