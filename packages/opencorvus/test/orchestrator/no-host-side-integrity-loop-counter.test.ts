import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("orchestrator and engine do not add a host-side integrity max-round gate", async () => {
  const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url))
  const proc = Bun.spawn(
    [
      "rg",
      "-n",
      "consecutiveIntegrity|integrityAttemptCount|integrity.*max",
      "packages/opencorvus/src/orchestrator",
      "packages/opencorvus/src/engine",
    ],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 1, stdout: "" })
})
