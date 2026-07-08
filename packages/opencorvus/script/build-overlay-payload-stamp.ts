import { createHash } from "crypto"
import fs from "fs"
import path from "path"

export const OVERLAY_PAYLOAD_STAMP_FILE = ".opencorvus-overlay-payload.stamp"

async function collectOverlayPayloadFiles(root: string): Promise<string[]> {
  const files: string[] = []

  async function visit(current: string) {
    const entries = await fs.promises.readdir(current, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      const relative = path.relative(root, absolute).replaceAll(path.sep, "/")
      if (relative === OVERLAY_PAYLOAD_STAMP_FILE) continue
      if (entry.isDirectory()) {
        await visit(absolute)
      } else if (entry.isFile()) {
        files.push(relative)
      }
    }
  }

  await visit(root)
  return files
}

export async function writeOverlayPayloadStamp(outdir: string) {
  const files = await collectOverlayPayloadFiles(outdir)
  const hash = createHash("sha256")
  let bytes = 0

  for (const file of files) {
    const absolute = path.join(outdir, ...file.split("/"))
    const payload = await fs.promises.readFile(absolute)
    bytes += payload.byteLength
    hash.update(file)
    hash.update("\0")
    hash.update(String(payload.byteLength))
    hash.update("\0")
    hash.update(payload)
    hash.update("\0")
  }

  await fs.promises.writeFile(
    path.join(outdir, OVERLAY_PAYLOAD_STAMP_FILE),
    `${JSON.stringify(
      {
        version: 1,
        files: files.length,
        bytes,
        sha256: hash.digest("hex"),
      },
      null,
      2,
    )}\n`,
  )
}
