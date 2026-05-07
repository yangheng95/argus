import path from "path"

const root = path.resolve(import.meta.dir, "..")
const exts = [".ts", ".tsx", ".mts", ".cts"]
const bad = "@opencorvus-ai/sdk"
const good = "@opencorvus-ai/sdk"
const issues = []

for (const pattern of exts.map((x) => `packages/**/*${x}`)) {
  for await (const item of new Bun.Glob(pattern).scan({ cwd: root, absolute: true })) {
    const file = item.toString()
    const normalized = file.replaceAll("\\", "/")
    if (normalized.includes("/node_modules/")) continue
    if (normalized.includes("/dist/")) continue
    if (normalized.includes("/test/")) continue

    const lines = (await Bun.file(file).text()).split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (!line.includes(bad)) continue
      if (line.includes(good)) continue
      issues.push({
        file: path.relative(root, file).replaceAll("\\", "/"),
        line: index + 1,
        text: line.trim(),
      })
    }
  }
}

if (issues.length === 0) {
  console.log(`sdk import check passed (${good})`)
  process.exit(0)
}

console.error(`deprecated SDK import found. use ${good}`)
for (const issue of issues) {
  console.error(`${issue.file}:${issue.line} ${issue.text}`)
}
process.exit(1)
