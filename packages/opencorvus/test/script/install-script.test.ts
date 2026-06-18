import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js"

const repo = path.resolve(import.meta.dir, "../../../..")

function toBashPath(filePath: string): string {
  if (process.platform !== "win32") return filePath
  const normalized = filePath.replaceAll("\\", "/")
  return normalized.replace(/^([A-Za-z]):\//, (_match, drive: string) => `/${drive.toLowerCase()}/`)
}

function resolveBash(): string | undefined {
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files"
    const candidates = [
      path.join(programFiles, "Git", "bin", "bash.exe"),
      path.join(programFiles, "Git", "usr", "bin", "bash.exe"),
    ]
    const found = candidates.find((candidate) => fs.existsSync(candidate))
    if (found) return found
  }
  return Bun.which("bash") ?? undefined
}

function gitUsrBin(): string | undefined {
  if (process.platform !== "win32") return undefined
  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files"
  const candidate = path.join(programFiles, "Git", "usr", "bin")
  return fs.existsSync(candidate) ? candidate : undefined
}

async function writeExecutable(filePath: string, content: string) {
  await fsp.writeFile(filePath, content.replaceAll("\r\n", "\n"))
  await fsp.chmod(filePath, 0o755)
}

async function writeZipArchive(filePath: string, entries: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  for (const [name, content] of Object.entries(entries)) {
    await writer.add(name, new TextReader(content))
  }
  const blob = await writer.close()
  await fsp.writeFile(filePath, Buffer.from(await blob.arrayBuffer()))
}

describe("install script", () => {
  test("installs a Windows archive whose root binary is opencorvus.exe", async () => {
    const bash = resolveBash()
    expect(bash).toBeTruthy()
    if (!bash) throw new Error("bash is required for install script regression")

    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "opencorvus-install-script-"))
    try {
      const fakeBin = path.join(root, "fake-bin")
      const home = path.join(root, "home")
      const tmp = path.join(root, "tmp")
      await fsp.mkdir(fakeBin, { recursive: true })
      await fsp.mkdir(home, { recursive: true })
      await fsp.mkdir(tmp, { recursive: true })

      const archive = path.join(root, "opencorvus-windows-x64.zip")
      await writeZipArchive(archive, {
        "opencorvus.exe": "#!/usr/bin/env sh\necho installed-opencorvus\n",
      })

      await writeExecutable(
        path.join(fakeBin, "uname"),
        `#!/usr/bin/env bash
case "\${1:-}" in
  -s) echo "MINGW64_NT-10.0" ;;
  -m) echo "x86_64" ;;
  *) echo "MINGW64_NT-10.0" ;;
esac
`,
      )
      await writeExecutable(
        path.join(fakeBin, "curl"),
        `#!/usr/bin/env bash
set -euo pipefail
out=""
for ((i=1; i<=$#; i++)); do
  arg="\${!i}"
  if [ "$arg" = "-w" ]; then
    next=$((i + 1))
    if [ "\${!next}" = "%{http_code}" ]; then
      printf "200"
      exit 0
    fi
  fi
  if [ "$arg" = "-o" ]; then
    next=$((i + 1))
    out="\${!next}"
  fi
done
if [ -n "$out" ]; then
  cp "$OPENCORVUS_TEST_ARCHIVE" "$out"
  exit 0
fi
echo "unexpected curl invocation: $*" >&2
exit 64
`,
      )
      await writeExecutable(
        path.join(fakeBin, "powershell.exe"),
        `#!/usr/bin/env bash
echo True
`,
      )

      const extraPath = [fakeBin, gitUsrBin(), process.env["PATH"]].filter(Boolean).join(path.delimiter)
      const proc = Bun.spawn([bash, toBashPath(path.join(repo, "install")), "--version", "9.9.9", "--no-modify-path"], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          HOME: toBashPath(home),
          TMPDIR: toBashPath(tmp),
          SHELL: "/usr/bin/bash",
          PATH: extraPath,
          OPENCORVUS_TEST_ARCHIVE: toBashPath(archive),
        },
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      expect(`${stdout}\n${stderr}`).toContain("Installing")
      expect(exitCode).toBe(0)
      expect(await fsp.readFile(path.join(home, ".opencorvus", "bin", "opencorvus.exe"), "utf8")).toBe(
        "#!/usr/bin/env sh\necho installed-opencorvus\n",
      )
      expect(fs.existsSync(path.join(home, ".opencorvus", "bin", "opencorvus"))).toBe(false)

      const installedBin = toBashPath(path.join(home, ".opencorvus", "bin"))
      const runInstalled = Bun.spawn([bash, "-lc", `PATH="${installedBin}:$PATH" opencorvus`], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
        },
      })
      const [runStdout, runStderr, runExitCode] = await Promise.all([
        new Response(runInstalled.stdout).text(),
        new Response(runInstalled.stderr).text(),
        runInstalled.exited,
      ])
      expect(runStderr).toBe("")
      expect(runExitCode).toBe(0)
      expect(runStdout.trim()).toBe("installed-opencorvus")
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })
})
