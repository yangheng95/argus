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
    /<div class="chat-compose-meta">\s*<div class="chat-compose-meta-left">\s*<SelectControl<ComposerModeOption>[\s\S]*?<SelectControl<ExpertSquadOption>[\s\S]*?<\/div>\s*<ComposerAttachmentLoaders/,
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
  expect(css).toMatch(/\.chat-compose-meta\s*\{[\s\S]*?flex-wrap:\s*nowrap;/)
  expect(css).toMatch(
    /\.chat-compose-meta-left\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*calc\(160px \* var\(--ui-scale\)\)\)\s+minmax\(0,\s*1fr\);/,
  )
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

test("right toolbar is hover and focus revealed without leaving pane sizing", () => {
  const activityCss = read("src/styles/surfaces/activity.css")
  const pane = read("src/services/pane.ts")
  const html = read("src/index.html")

  expect(html).toContain('id="solidRightActivityToolbar"')
  expect(pane).toContain('remainingFixedControlIds: ["solidRightActivityToolbar"]')
  expect(activityCss).toContain("#solidRightActivityToolbar .side-activity-toolbar")
  expect(activityCss).toContain("pointer-events: auto;")
  expect(activityCss).toContain("opacity: 0;")
  expect(activityCss).toContain("pointer-events: none;")
  expect(activityCss).toContain("#solidRightActivityToolbar:hover .side-activity-toolbar")
  expect(activityCss).toContain("#solidRightActivityToolbar:focus-within .side-activity-toolbar")
  expect(activityCss).toContain("pointer-events: auto;")
  expect(activityCss).not.toContain("#solidRightActivityToolbar {\n  display: none")
})
