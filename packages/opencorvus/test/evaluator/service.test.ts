import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import { BunProc } from "../../src/bun"
import { EvaluatorService } from "../../src/evaluator/service"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("evaluator.service", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("discovers build test and lint scripts from package.json", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "evaluator-test",
        scripts: {
          build: "bun -e \"console.log('build ok')\"",
          test: "bun -e \"console.log('test ok')\"",
          lint: "bun -e \"console.log('lint ok')\"",
        },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate({}, { summary: "delivery ready" })
        expect(result.status).toBe("passed")
        expect(result.verdict).toBe("accepted")
        expect(result.checks.map((item) => item.name)).toEqual(["build", "test", "lint"])
      },
    })
  })

  test("fails when verify_cmd exits non-zero", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            metadata: {
              checks: {
                verify_cmd: [`"${BunProc.which()}" -e "process.exit(1)"`],
              },
            },
          },
          { summary: "delivery ready" },
        )
        expect(result.status).toBe("failed")
        expect(result.verdict).toBe("rejected")
        expect(result.checks[0]?.name).toBe("verify_cmd")
        expect(result.artifacts[0]?.label).toBe("evaluation:verify_cmd")
      },
    })
  })

  test("artifact check in soft mode does not block the flow", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            metadata: {
              checks: {
                artifact: {
                  require_changed_files: true,
                  mode: "soft",
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "artifact")?.status).toBe("skipped")
      },
    })
  })

  test("artifact check in strict mode fails when required files are missing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            metadata: {
              checks: {
                artifact: {
                  require_changed_files: true,
                  mode: "strict",
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "artifact")?.status).toBe("failed")
      },
    })
  })

  test("web visual check passes for matching page content", async () => {
    await using tmp = await tmpdir({ git: true })
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("<html><head><title>Board</title></head><body>Hello dashboard</body></html>", {
          headers: {
            "content-type": "text/html",
          },
        })
      },
    })

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const result = await EvaluatorService.evaluate(
            {
              metadata: {
                checks: {
                  visual: {
                    target: "web",
                    url: server.url.href,
                    require_title: "Board",
                    require_text: ["Hello dashboard"],
                  },
                },
              },
            },
            { summary: "delivery ready", changedFiles: [], diffs: [] },
          )
          expect(result.status).toBe("passed")
          expect(result.checks.find((item) => item.name === "visual")?.status).toBe("passed")
        },
      })
    } finally {
      server.stop(true)
    }
  })

  test("judge check soft-skips when no model is available", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "implement feature",
            metadata: {
              checks: {
                judge: {
                  enabled: true,
                  mode: "soft",
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "judge")?.status).toBe("skipped")
      },
    })
  })
})
