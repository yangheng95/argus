import { randomUUID } from "crypto"
import { mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { fileURLToPath } from "url"
import z from "zod"
import { Log } from "../../util/log"

const log = Log.create({ service: "cv-candidate" })

const Candidate = z.object({
  id: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  bbox: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  }),
  score: z.number(),
})

const Result = z.object({
  width: z.number().int(),
  height: z.number().int(),
  candidates: z.array(Candidate),
  source: z.string().optional(),
  error: z.string().optional(),
})

export type CVCandidateItem = z.infer<typeof Candidate>

const scriptPath = fileURLToPath(new URL("./cv-candidate.py", import.meta.url))

function python() {
  return Bun.which("python") ?? Bun.which("python3")
}

async function cleanup(file: string) {
  await rm(file, { force: true }).catch(() => undefined)
}

function sort(list: CVCandidateItem[]) {
  return [...list].sort((a, b) => b.score - a.score)
}

export const CVCandidate = {
  async detect(image: Buffer, input?: { max?: number }) {
    const runtime = python()
    if (!runtime) return [] as CVCandidateItem[]

    const max = Math.max(1, Math.min(200, Math.round(input?.max ?? 80)))
    const dir = path.join(tmpdir(), "opencorvus-cv")
    await mkdir(dir, { recursive: true })
    const runID = randomUUID()
    const imagePath = path.join(dir, `capture-${runID}.png`)
    const outputPath = path.join(dir, `result-${runID}.json`)
    await Bun.write(imagePath, image)

    const proc = Bun.spawn([runtime, scriptPath, "--input", imagePath, "--output", outputPath, "--max", String(max)], {
      stdout: "ignore",
      stderr: "pipe",
    })
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    const parsed = await Bun.file(outputPath)
      .json()
      .then((raw) => Result.safeParse(raw))
      .catch(() => null)

    await Promise.all([cleanup(imagePath), cleanup(outputPath)])

    if (code !== 0) {
      log.warn("opencv-candidate subprocess failed", {
        code,
        stderr: stderr.slice(0, 240),
      })
      return [] as CVCandidateItem[]
    }
    if (!parsed || !parsed.success) {
      log.warn("opencv-candidate output parse failed", {
        outputPath: path.basename(outputPath),
      })
      return [] as CVCandidateItem[]
    }
    return sort(parsed.data.candidates)
  },
}
