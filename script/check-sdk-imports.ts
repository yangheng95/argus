import path from "path"

const root = path.resolve(import.meta.dir, "..")
const exts = [".ts", ".tsx", ".mts", ".cts"]
const deprecatedSymbols = [
  "OpencodeClient",
  "OpencodeClientConfig",
  "createOpencodeClient",
  "createOpencodeServer",
  "createOpencode",
]
const symbolPattern = new RegExp(`\\b(${deprecatedSymbols.join("|")})\\b`)
const issues: Array<{ file: string; line: number; text: string }> = []

const patterns = exts.flatMap((ext) => [`packages/**/*${ext}`, `script/**/*${ext}`])

for (const pattern of patterns) {
  for await (const item of new Bun.Glob(pattern).scan({ cwd: root, absolute: true })) {
    const file = item.toString()
    const normalized = file.replaceAll("\\", "/")
    if (normalized.endsWith("/script/check-sdk-imports.ts")) continue
    if (normalized.includes("/node_modules/")) continue
    if (normalized.includes("/dist/")) continue
    if (normalized.includes("/test/")) continue

    const lines = (await Bun.file(file).text()).split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      if (!symbolPattern.test(line)) continue
      issues.push({
        file: path.relative(root, file).replaceAll("\\", "/"),
        line: index + 1,
        text: line.trim(),
      })
    }
  }
}

if (issues.length === 0) {
  console.log("sdk import check passed (OpenCorvusClient)")
  process.exit(0)
}

console.error("deprecated SDK symbol found. use OpenCorvusClient/createOpenCorvus*")
for (const issue of issues) {
  console.error(`${issue.file}:${issue.line} ${issue.text}`)
}
process.exit(1)
