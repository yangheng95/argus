import { createHash } from "node:crypto"
import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

const repoRoot = path.resolve(import.meta.dir, "../../..")
const sourceRelativePath = "specs/artifacts/五客户端长链路业务与开发需求.md"
const sourcePath = path.join(repoRoot, sourceRelativePath)
const outputRelativeDirectory = "specs/artifacts/expert-squad-evolution-benchmark"
const outputDirectory = path.join(repoRoot, outputRelativeDirectory)
const check = process.argv.includes("--check")

const partitions = {
  development: ["case-03", "case-04", "case-10"],
  holdout: ["case-06", "case-07"],
  certification: Array.from({ length: 10 }, (_, index) => `case-${String(index + 1).padStart(2, "0")}`),
} as const

const visualSurfaces: Record<string, string[]> = {
  "case-01": ["web"],
  "case-02": [],
  "case-03": ["web"],
  "case-04": ["web"],
  "case-05": ["web"],
  "case-06": ["web", "map"],
  "case-07": ["web"],
  "case-08": ["web"],
  "case-09": ["desktop", "web"],
  "case-10": ["web"],
}

function sha256(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function caseSections(source: string) {
  const headings = [...source.matchAll(/^## Case (\d+)：([^\r\n]+)$/gm)]
  if (headings.length !== 10) throw new Error(`Expected exactly 10 benchmark Case headings, found ${headings.length}`)
  return headings.map((heading, index) => {
    const number = Number(heading[1])
    if (number !== index + 1) throw new Error(`Expected Case ${index + 1}, found Case ${number}`)
    const start = heading.index!
    const end = headings[index + 1]?.index ?? source.length
    const text = `${source.slice(start, end).trimEnd()}\n`
    if (!text.includes("### 输入") || !text.includes("### 验收标准"))
      throw new Error(`Case ${number} must contain exact input and acceptance sections`)
    return { number, title: heading[2]!, text }
  })
}

async function expectedFiles() {
  const sourceBytes = await readFile(sourcePath)
  const source = sourceBytes.toString("utf8")
  const sections = caseSections(source)
  const files = new Map<string, string>()
  const cases = sections.map((section) => {
    const id = `case-${String(section.number).padStart(2, "0")}`
    const filename = `${id}.md`
    files.set(filename, section.text)
    return {
      id,
      number: section.number,
      title: section.title,
      resource: {
        path: `${outputRelativeDirectory}/${filename}`,
        media_type: "text/markdown",
        bytes: Buffer.byteLength(section.text),
        sha256: sha256(section.text),
      },
      visual_surfaces: visualSurfaces[id]!,
    }
  })
  const manifest = `${JSON.stringify(
    {
      schema_version: 1,
      source: {
        path: sourceRelativePath,
        bytes: sourceBytes.byteLength,
        sha256: sha256(sourceBytes),
      },
      partitions,
      cases,
    },
    null,
    2,
  )}\n`
  files.set("manifest.json", manifest)
  const developmentCaseIDs = new Set<string>(partitions.development)
  const developmentCases = cases.filter((item) => developmentCaseIDs.has(item.id))
  files.set(
    "development-manifest.json",
    `${JSON.stringify(
      {
        schema_version: 1,
        dataset_partition: "development",
        case_set_sha256: sha256(JSON.stringify(developmentCases)),
        cases: developmentCases,
      },
      null,
      2,
    )}\n`,
  )
  return files
}

const files = await expectedFiles()
if (check) {
  const drift: string[] = []
  for (const [filename, expected] of files) {
    const actual = await readFile(path.join(outputDirectory, filename), "utf8").catch(() => undefined)
    if (actual !== expected) drift.push(filename)
  }
  if (drift.length > 0) throw new Error(`Evolution benchmark generated resources are stale: ${drift.join(", ")}`)
  console.log(`Evolution benchmark resources are fresh (${files.size} files)`)
} else {
  await mkdir(outputDirectory, { recursive: true })
  for (const [filename, content] of files) await writeFile(path.join(outputDirectory, filename), content)
  console.log(`Generated ${files.size} evolution benchmark resource files`)
}
