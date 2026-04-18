#!/usr/bin/env bun
import path from "node:path"
import { extractPage } from "../../src/mirror/url/extract"
import { extractTextFromTree, compareText } from "../../src/mirror/shared/content-compare"
import { Server } from "../../src/server/server"

const indexPath = process.argv[2] ?? "D:/myhexin-local/argus-opencode/tmp-benchmark-baidu/run-3/index.html"

function pathToFileUrl(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/")
  return abs.startsWith("/") ? `file://${abs}` : `file:///${abs}`
}

Server.listen({ port: 0, hostname: "127.0.0.1" })

const fileUrl = pathToFileUrl(indexPath)
console.log("Testing file URL:", fileUrl)

const result = await extractPage({
  url: fileUrl,
  viewport: { width: 1440, height: 900 },
  waitMs: 2000,
  noScreenshots: true,
})

console.log("tree length:", result.tree.length)
console.log("totalElements:", result.stats.totalElements)
console.log("extractedElements:", result.stats.extractedElements)
const text = extractTextFromTree(result.tree as unknown as Parameters<typeof extractTextFromTree>[0])
console.log("text length:", text.length)
console.log("text sample:", text.slice(0, 500))
console.log("\n--- first tree element ---")
console.log(JSON.stringify(result.tree[0], null, 2).slice(0, 1500))

process.exit(0)
