// Regression for iter6 — titlebar brand strip per user feedback
// (2026-05-02 "把 opencorvus 的标题栏文字干掉，然后把绿色状态图标
//  塞到标题栏右侧").
//
// The previous titlebar layout was:
//
//   [logo + "OpenCorvus" text + connection badge] [menus] ...spacer...
//   [right-side status + window controls]
//
// The new contract is:
//
//   [logo (still the brand-guide popover trigger)] [menus] ...spacer...
//   [connection badge + right-side status + window controls]
//
// The brand wordmark is dropped (the logo carries the brand on its
// own) and the connection badge moves to the titlebar's right
// utility cluster so it sits next to the other live status surfaces.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const HTML = readFileSync(path.resolve(import.meta.dir, "..", "src", "index.html"), "utf8")
const BRAND_GUIDE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "components", "titlebar", "TitlebarBrandGuide.tsx"),
  "utf8",
)

describe("titlebar brand wordmark is gone", () => {
  test('no `<span class="brand-name">OpenCorvus</span>` survives in index.html', () => {
    expect(HTML).not.toMatch(/class=["']brand-name["']/)
    // Belt + suspenders: the old plain brand-name node inside the titlebar
    // brand stack should be gone. The brand-guide popover keeps its own
    // OpenCorvus wordmark, so the assertion stays scoped to the retired node.
    const titlebar = HTML.match(/<header class=["']titlebar["'][\s\S]*?<\/header>/)
    expect(titlebar).not.toBeNull()
    expect(titlebar![0]).not.toMatch(/class=["']brand-name["'][^>]*>OpenCorvus</)
  })

  test("brand-guide popover mounts through Solid instead of static titlebar markup", () => {
    expect(HTML).toContain('id="solidTitlebarBrandGuide"')
    expect(HTML).not.toMatch(/class=["']brand-guide["']/)
    expect(HTML).not.toMatch(/class=["']brand-guide-card["']/)
    expect(BRAND_GUIDE).toMatch(/class=["']brand-guide["']/)
    expect(BRAND_GUIDE).toMatch(/class=["']brand-guide-card["']/)
  })

  test("brand-guide logo is resolved through the Vite asset graph", () => {
    expect(BRAND_GUIDE).toContain('import brandLogoUrl from "../../opencorvus-logo-dark.svg"')
    expect(BRAND_GUIDE).toContain("src={brandLogoUrl}")
    expect(BRAND_GUIDE).not.toContain('src="opencorvus-logo-dark.svg"')
  })
})

describe("sidebar version label", () => {
  test("left footer shows OpenCorvus version instead of workspace copy", () => {
    expect(HTML).not.toContain("OpenCorvus Workspace")
    expect(HTML).toContain("OpenCorvus v%OPENCORVUS_OVERLAY_VERSION%")
    expect(HTML).toContain('id="chatVersion"')
  })
})

describe("connection badge anchor moves to titlebar-utility", () => {
  test("#solidConnBadge does not live inside `.brand-heading`/`.titlebar-left`", () => {
    // Find the titlebar-left subtree and assert the badge anchor is
    // not inside it. The badge anchor must therefore live downstream
    // (i.e. inside titlebar-utility), which is what the next test
    // verifies.
    const left = HTML.match(/<div class=["']titlebar-left["'][\s\S]*?<\/div>\s*<div class=["']titlebar-spacer["']/)
    expect(left).not.toBeNull()
    expect(left![0]).not.toContain('id="solidConnBadge"')
  })

  test("#solidConnBadge lives inside `.titlebar-utility`", () => {
    const utility = HTML.match(/<div class=["']titlebar-utility["'][\s\S]*?<\/header>/)
    expect(utility).not.toBeNull()
    expect(utility![0]).toContain('id="solidConnBadge"')
  })
})
