import { $, semver } from "bun"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion =
  typeof rootPkg.packageManager === "string" ? rootPkg.packageManager.split("@")[1] : undefined

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(
    `This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`,
  )
}

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_BUMP: process.env["OPENCODE_BUMP"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
  OPENCODE_RELEASE: process.env["OPENCODE_RELEASE"],
}

const channel = await (async () => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_BUMP) return "latest"
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()

const preview = channel !== "latest"

const version = await (async () => {
  if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION
  if (preview) return `0.0.0-${channel}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`

  const latestVersion = await fetch("https://registry.npmjs.org/opencorvus-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data) => {
      if (!data || typeof data !== "object") throw new Error("invalid npm registry response")
      if (!("version" in data)) throw new Error("missing version in npm registry response")
      const next = data.version
      if (typeof next !== "string") throw new Error("invalid version in npm registry response")
      return next
    })

  const [major, minor, patch] = latestVersion.split(".").map((x) => Number(x) || 0)
  const bump = env.OPENCODE_BUMP?.toLowerCase()
  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return channel
  },
  get version() {
    return version
  },
  get preview() {
    return preview
  },
  get release() {
    return !!env.OPENCODE_RELEASE
  },
  get team() {
    return team
  },
}

console.log("opencode script", JSON.stringify(Script, null, 2))
