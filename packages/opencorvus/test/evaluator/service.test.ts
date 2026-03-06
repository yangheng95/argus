import { afterEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { BunProc } from "../../src/bun"
import { EvaluatorService } from "../../src/evaluator/service"
import { Instance } from "../../src/project/instance"
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
})
