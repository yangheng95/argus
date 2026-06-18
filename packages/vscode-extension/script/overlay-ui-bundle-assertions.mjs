import * as fs from "node:fs"
import * as path from "node:path"

const TEXT_ASSET_RE = /\.(?:html|css|js)$/i
const SCRIPT_ASSET_RE = /\.js$/i
const RETIRED_PROMPT_PROFILE_NATIVE_SELECT_PATTERNS = [
  {
    description: "prompt-profile hidden chrome",
    pattern: /prompt-profile-select-chrome/,
  },
  {
    description: "prompt-profile native select element",
    pattern: /<select\b[^>]*\bclass=(?:"[^"]*\bprompt-profile-select\b[^"]*"|'[^']*\bprompt-profile-select\b[^']*'|prompt-profile-select(?:[\s>]))/i,
  },
  {
    description: "prompt-profile exact native select stylesheet selector",
    pattern: /(^|[^\w-])\.prompt-profile-select(?![\w-])/,
  },
]

export function assertOverlayUiBundleDir(target) {
  const files = listFiles(target)
  const scripts = files.filter((file) => SCRIPT_ASSET_RE.test(file))
  const textAssets = files.filter((file) => TEXT_ASSET_RE.test(file))
  const combinedScripts = scripts.map((file) => fs.readFileSync(file, "utf8")).join("\n")
  const combinedTextAssets = textAssets.map((file) => fs.readFileSync(file, "utf8")).join("\n")

  if (!combinedScripts.includes("__OPENCORVUS_ASSET_BASE__")) {
    throw new Error("[build] overlay UI bundle does not consume __OPENCORVUS_ASSET_BASE__")
  }
  if (/\.catch\(\s*\(\s*\)\s*=>\s*\(\s*\{\s*\}\s*\)\s*\)/.test(combinedScripts)) {
    throw new Error("[build] overlay UI bundle still contains silent empty-object catch handlers")
  }
  if (/fetch\(\s*`i18n\/\$\{/.test(combinedScripts)) {
    throw new Error("[build] overlay UI bundle still contains bare i18n fetch URLs")
  }

  for (const { description, pattern } of RETIRED_PROMPT_PROFILE_NATIVE_SELECT_PATTERNS) {
    if (pattern.test(combinedTextAssets)) {
      throw new Error(`[build] overlay UI bundle contains retired prompt-profile native select implementation: ${description}`)
    }
  }
}

export function listFiles(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) result.push(...listFiles(full))
    else result.push(full)
  }
  return result
}
