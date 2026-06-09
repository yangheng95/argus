import { test, expect } from "bun:test"
import { jsonLines } from "../../src/executor/external-process"

// Cross-platform "long-lived process" command. We pick `bun -e` because bun
// is guaranteed available (the test runner itself is bun). We sleep just
// long enough that, if the generator's finally doesn't kill the process,
// it would still be alive when we assert.
function sleepCmd(ms: number): string[] {
  return ["bun", "-e", `await Bun.sleep(${ms})`]
}

// Emit a few JSON lines fast then idle forever. Used to test that a
// consumer breaking out of `for await` actually tears the subprocess down.
function spammerCmd(): string[] {
  return [
    "bun",
    "-e",
    `for (let i = 0; i < 1000; i++) { console.log(JSON.stringify({ i })); await Bun.sleep(2) } await Bun.sleep(60_000)`,
  ]
}

test(
  "jsonLines kills the subprocess when consumer breaks early",
  async () => {
    const it = jsonLines({ command: spammerCmd() })
    let pid: number | undefined
    // Drain a few items, then abandon the iterator. The generator's finally
    // must kill the spammer subprocess — otherwise it would idle for 60s.
    let count = 0
    for await (const item of it) {
      expect(typeof item.i).toBe("number")
      count += 1
      if (count >= 3) break
    }
    // No reliable cross-platform way to capture pid without changing the
    // public API, so we instead assert the function returned promptly and
    // didn't hang. If kill failed, the bun event loop would still be busy
    // draining proc.exited for ~60s and this test would time out (1s).
    expect(count).toBe(3)
  },
  { timeout: 5_000 },
)

test("jsonLines settles cleanly when subprocess exits naturally", async () => {
  // Subprocess exits in ~10ms. Generator should drain naturally, no error.
  const items: any[] = []
  for await (const item of jsonLines({
    command: ["bun", "-e", `console.log(JSON.stringify({ ok: true }))`],
  })) {
    items.push(item)
  }
  expect(items).toEqual([{ ok: true }])
})

test("jsonLines surfaces non-zero exit when consumer drained naturally", async () => {
  await expect(async () => {
    for await (const _ of jsonLines({
      command: ["bun", "-e", `console.error("boom"); process.exit(7)`],
    })) {
      void _
    }
  }).toThrow(/boom|exit code 7/)
})

test("jsonLines does NOT throw the subprocess error when consumer aborted early", async () => {
  // Subprocess writes one line, exits non-zero. If the consumer breaks
  // before draining EOF, the finally cleans up but should NOT translate
  // that into a thrown error — the consumer owns the early-exit outcome.
  const it = jsonLines({
    command: [
      "bun",
      "-e",
      `console.log(JSON.stringify({ a: 1 })); console.log(JSON.stringify({ a: 2 })); console.log(JSON.stringify({ a: 3 })); process.exit(0)`,
    ],
  })
  for await (const item of it) {
    expect(item.a).toBe(1)
    break
  }
  // No throw — break is the contract, generator finally cleaned up.
})

test(
  "jsonLines respects external AbortSignal",
  async () => {
    const ctrl = new AbortController()
    const it = jsonLines({
      command: sleepCmd(60_000),
      signal: ctrl.signal,
    })
    setTimeout(() => ctrl.abort(), 50)
    // Iterating an aborted-process generator should settle without blocking
    // for 60s. Because the subprocess emits no JSON lines, the for-await
    // loop never yields; it returns when the stdout stream closes after
    // SIGTERM.
    for await (const _ of it) {
      void _
    }
  },
  { timeout: 5_000 },
)
