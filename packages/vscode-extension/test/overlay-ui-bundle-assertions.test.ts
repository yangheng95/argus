import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assertOverlayUiBundleDir } from "../script/overlay-ui-bundle-assertions.mjs"

describe("overlay-ui-bundle-assertions", () => {
  let mediaUi: string

  beforeEach(() => {
    mediaUi = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-media-ui-"))
    fs.mkdirSync(path.join(mediaUi, "assets"), { recursive: true })
    fs.writeFileSync(
      path.join(mediaUi, "index.html"),
      '<div class=prompt-profile-select-wrap><button class="prompt-profile-select-trigger"></button></div><script type="module" src="/assets/app.js"></script>',
    )
    fs.writeFileSync(
      path.join(mediaUi, "assets", "app.js"),
      'const assetBase = window.__OPENCORVUS_ASSET_BASE__; console.log(assetBase);',
    )
    fs.writeFileSync(path.join(mediaUi, "assets", "style.css"), ".prompt-profile-select-trigger{display:flex}")
  })

  afterEach(() => {
    try {
      fs.rmSync(mediaUi, { recursive: true, force: true })
    } catch {}
  })

  test("accepts the current Kobalte prompt-profile selector bundle shape", () => {
    expect(() => assertOverlayUiBundleDir(mediaUi)).not.toThrow()
  })

  test.each([
    ["hidden chrome class", "assets/style.css", ".prompt-profile-select-chrome{display:block}"],
    ["native select class attribute", "index.html", "<select class=prompt-profile-select></select>"],
    ["retired exact native selector", "assets/style.css", ".prompt-profile-select{opacity:0;color:transparent}"],
  ])("rejects retired prompt-profile native select marker: %s", (_label, relativePath, marker) => {
    fs.writeFileSync(path.join(mediaUi, relativePath), marker)
    expect(() => assertOverlayUiBundleDir(mediaUi)).toThrow(/retired prompt-profile native select implementation/)
  })

  test("rejects bundles that do not consume the webview asset base", () => {
    fs.writeFileSync(path.join(mediaUi, "assets", "app.js"), "console.log('missing asset base')")
    expect(() => assertOverlayUiBundleDir(mediaUi)).toThrow(/__OPENCORVUS_ASSET_BASE__/)
  })
})
