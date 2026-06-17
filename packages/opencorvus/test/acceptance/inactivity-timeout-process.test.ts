import { describe, expect, test } from "bun:test"
import { runProcessWithInactivityTimeout } from "../../src/acceptance/checks/inactivity-timeout-process"

describe("acceptance inactivity timeout process runner", () => {
  test("does not kill a process that keeps emitting output past the timeout window", async () => {
    const result = await runProcessWithInactivityTimeout({
      executable: process.execPath,
      args: [
        "-e",
        [
          "console.log('tick 0');",
          "let count = 0;",
          "const timer = setInterval(() => {",
          "  count += 1;",
          "  console.log(`tick ${count}`);",
          "  if (count === 5) {",
          "    clearInterval(timer);",
          "    process.exit(0);",
          "  }",
          "}, 150);",
        ].join("\n"),
      ],
      cwd: process.cwd(),
      timeoutMs: 500,
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("tick 5")
    expect(result.stderr).not.toContain("timed out")
  })

  test("kills a silent process after one inactive timeout window", async () => {
    const result = await runProcessWithInactivityTimeout({
      executable: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(0), 250);"],
      cwd: process.cwd(),
      timeoutMs: 80,
    })

    expect(result.exitCode).toBeUndefined()
    expect(result.stderr).toContain("Command timed out after 80ms without stdout/stderr activity.")
  })
})
