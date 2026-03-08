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

  test("executes named checks with their own ids and labels", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            metadata: {
              checks: {
                named: {
                  py_compile: {
                    label: "Python Compile",
                    family: "build",
                    commands: [`"${BunProc.which()}" -e "process.exit(0)"`],
                  },
                  pytest: {
                    label: "Pytest",
                    family: "test",
                    commands: [`"${BunProc.which()}" -e "process.exit(0)"`],
                  },
                  typecheck: {
                    label: "Type Check",
                    family: "lint",
                    commands: [`"${BunProc.which()}" -e "process.exit(0)"`],
                  },
                },
              },
            },
          },
          { summary: "delivery ready" },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.map((item) => item.name)).toEqual(["py_compile", "pytest", "typecheck"])
        expect(result.checks.map((item) => item.label)).toEqual(["Python Compile", "Pytest", "Type Check"])
      },
    })
  })

  test("discovers typecheck script as a named lint check", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "evaluator-typecheck",
        scripts: {
          typecheck: "bun -e \"console.log('typecheck ok')\"",
        },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await EvaluatorService.resolveChecks()
        expect(resolved.named?.typecheck?.label).toBe("Type Check")
        expect(resolved.named?.typecheck?.family).toBe("lint")
        expect(resolved.named?.typecheck?.commands).toEqual(["bun run typecheck"])

        const result = await EvaluatorService.evaluate({}, { summary: "delivery ready" })
        expect(result.status).toBe("passed")
        expect(result.checks.map((item) => item.name)).toEqual(["typecheck"])
        expect(result.checks[0]?.family).toBe("lint")
      },
    })
  })

  test("honors build, test, and lint being explicitly disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "evaluator-disabled-checks",
        scripts: {
          build: "bun -e \"process.exit(1)\"",
          test: "bun -e \"process.exit(1)\"",
          lint: "bun -e \"process.exit(1)\"",
        },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            metadata: {
              checks: {
                build: false,
                test: false,
                lint: false,
              },
            },
          },
          { summary: "delivery ready" },
        )
        expect(result.status).toBe("inconclusive")
        expect(result.checks.find((item) => item.name === "build")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "test")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "lint")).toBeUndefined()
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

  test("judge check fails when no model is available", async () => {
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
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "judge")?.status).toBe("failed")
      },
    })
  })

  test("startup check passes when a service becomes ready", async () => {
    await using tmp = await tmpdir({ git: true })
    const port = 39000 + Math.floor(Math.random() * 1000)
    await Bun.write(
      path.join(tmp.path, "server.ts"),
      `
        const port = ${port}
        Bun.serve({
          port,
          fetch() {
            return new Response("ready ok")
          },
        })
        await new Promise(() => {})
      `,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "start the service",
            metadata: {
              checks: {
                startup: {
                  command: `"${BunProc.which()}" server.ts`,
                  ready_url: `http://127.0.0.1:${port}`,
                  ready_text: "ready ok",
                  timeout_ms: 10_000,
                  mode: "strict",
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "startup")?.status).toBe("passed")
      },
    })
  })

  test("startup check fails in strict mode when readiness never appears", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "hang.ts"),
      `
        setTimeout(() => {}, 10000)
      `,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "start the service",
            metadata: {
              checks: {
                startup: {
                  command: `"${BunProc.which()}" hang.ts`,
                  ready_url: "http://127.0.0.1:39999",
                  timeout_ms: 1_500,
                  mode: "strict",
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "startup")?.status).toBe("failed")
      },
    })
  }, 30000)

  test("puppeteer check stays non-blocking when browser executable is missing", async () => {
    await using tmp = await tmpdir({ git: true })
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("<html><head><title>Tank</title></head><body><canvas id='game'></canvas></body></html>", {
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
              request: "verify browser render",
              metadata: {
                checks: {
                  puppeteer: {
                    target: "web",
                    url: server.url.href,
                    executable_path: path.join(tmp.path, "missing-browser.exe"),
                    mode: "soft",
                    wait_for_selector: "#game",
                  },
                },
              },
            },
            { summary: "delivery ready", changedFiles: ["index.html"], diffs: [] },
          )
          expect(result.status).toBe("passed")
          const status = result.checks.find((item) => item.name === "puppeteer")?.status
          expect(status === "skipped" || status === "passed").toBe(true)
        },
      })
    } finally {
      server.stop(true)
    }
  })

  test("ui review fails when no review model is available", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "Review the UI hierarchy.",
            metadata: {
              checks: {
                ui_review: {
                  target: "web",
                  mode: "soft",
                },
              },
            },
          },
          { summary: "Updated the dashboard layout.", changedFiles: ["ui.tsx"], diffs: [] },
        )
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "ui_review")?.status).toBe("failed")
      },
    })
  })

  test("code quality review fails when no review model is available", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "Check code quality.",
            metadata: {
              checks: {
                code_quality: {
                  enabled: true,
                  mode: "soft",
                },
              },
            },
          },
          {
            summary: "Updated the service implementation.",
            changedFiles: ["service.ts"],
            diffs: [
              {
                file: "service.ts",
                before: "export const value = 1\n",
                after: "export const value = 2\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          },
        )
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "code_quality")?.status).toBe("failed")
      },
    })
  })

  test("code review fails when no review model is available", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "Do a code review.",
            metadata: {
              checks: {
                code_review: {
                  enabled: true,
                  mode: "soft",
                },
              },
            },
          },
          {
            summary: "Updated the controller.",
            changedFiles: ["controller.ts"],
            diffs: [
              {
                file: "controller.ts",
                before: "export const value = 1\n",
                after: "export const value = 2\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          },
        )
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "code_review")?.status).toBe("failed")
      },
    })
  })

  test("dead code review fails when no review model is available", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "Review dead code cleanup.",
            metadata: {
              checks: {
                dead_code_review: {
                  enabled: true,
                  mode: "soft",
                },
              },
            },
          },
          {
            summary: "Removed old helpers.",
            changedFiles: ["legacy.ts"],
            diffs: [
              {
                file: "legacy.ts",
                before: "export const old = 1\n",
                after: "",
                additions: 0,
                deletions: 1,
                status: "deleted",
              },
            ],
          },
        )
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "dead_code_review")?.status).toBe("failed")
      },
    })
  })

  test("prefers changed playwright spec files over root test script discovery", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "evaluator-playwright-test",
        scripts: {
          test: "bun -e \"process.exit(1)\"",
        },
      }),
    )
    await Bun.write(
      path.join(tmp.path, "sample.spec.ts"),
      `
        import { test, expect } from "@playwright/test"
        test("sample", async ({ page }) => {
          await page.setContent("<h1>ok</h1>")
          await expect(page.getByText("ok")).toBeVisible()
        })
      `,
    )
    await Bun.spawn(["bun", "add", "-d", "@playwright/test@1.51.0"], {
      cwd: tmp.path,
      stdout: "ignore",
      stderr: "ignore",
    }).exited

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "run playwright test",
            metadata: {
              delivery_changed_files: ["sample.spec.ts"],
            },
          },
          { summary: "delivery ready", changedFiles: ["sample.spec.ts"], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "test")?.status).toBe("passed")
      },
    })
  })

  test("ignores bun:test files when selecting changed playwright specs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "evaluator-mixed-test",
        scripts: {
          test: "bun -e \"process.exit(1)\"",
        },
      }),
    )
    await Bun.write(
      path.join(tmp.path, "sample.spec.ts"),
      `
        import { test, expect } from "@playwright/test"
        test("sample", async ({ page }) => {
          await page.setContent("<h1>ok</h1>")
          await expect(page.getByText("ok")).toBeVisible()
        })
      `,
    )
    await Bun.write(
      path.join(tmp.path, "unit.test.ts"),
      `
        import { describe, expect, test } from "bun:test"
        const embedded = 'from "@playwright/test"'
        describe("unit", () => {
          test("works", () => {
            expect(embedded.includes("@playwright/test")).toBe(true)
            expect(1 + 1).toBe(2)
          })
        })
      `,
    )
    await Bun.spawn(["bun", "add", "-d", "@playwright/test@1.51.0"], {
      cwd: tmp.path,
      stdout: "ignore",
      stderr: "ignore",
    }).exited

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "run playwright test",
            metadata: {
              delivery_changed_files: ["sample.spec.ts", "unit.test.ts"],
            },
          },
          { summary: "delivery ready", changedFiles: ["sample.spec.ts", "unit.test.ts"], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "test")?.status).toBe("passed")
      },
    })
  })

  test("runs changed bun tests before falling back to root scripts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "evaluator-bun-test",
        scripts: {
          test: "bun -e \"process.exit(1)\"",
        },
      }),
    )
    await Bun.write(
      path.join(tmp.path, "unit.test.ts"),
      `
        import { describe, expect, test } from "bun:test"
        describe("unit", () => {
          test("works", () => {
            expect(1 + 1).toBe(2)
          })
        })
      `,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "run unit test",
            metadata: {
              delivery_changed_files: ["unit.test.ts"],
            },
          },
          { summary: "delivery ready", changedFiles: ["unit.test.ts"], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "test")?.status).toBe("passed")
      },
    })
  })

  test("prefers nearest subproject package scripts over repo root scripts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "root-project",
        scripts: {
          build: "bun -e \"process.exit(1)\"",
          test: "bun -e \"process.exit(1)\"",
          lint: "bun -e \"process.exit(1)\"",
        },
      }),
    )
    const app = path.join(tmp.path, "tank-battle-game")
    await Bun.write(
      path.join(app, "package.json"),
      JSON.stringify({
        name: "tank-battle-game",
        scripts: {
          build: "bun -e \"console.log('build ok')\"",
          test: "bun -e \"console.log('test ok')\"",
          lint: "bun -e \"console.log('lint ok')\"",
        },
      }),
    )
    await Bun.write(path.join(app, "index.html"), "<!doctype html><title>tank</title>\n")
    await Bun.write(path.join(app, "game.js"), "console.log('tank')\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await EvaluatorService.evaluate(
          {
            request: "create a tank battle game",
            metadata: {
              delivery_changed_files: ["tank-battle-game/package.json", "tank-battle-game/index.html", "tank-battle-game/game.js"],
            },
          },
          {
            summary: "Created a tank battle game project.",
            changedFiles: ["tank-battle-game/package.json", "tank-battle-game/index.html", "tank-battle-game/game.js"],
            diffs: [],
          },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.map((item) => item.name)).toEqual(["build", "test", "lint"])
        const commands = result.artifacts
          .filter((item) => item.kind === "log")
          .map((item) => String(item.payload.command ?? ""))
        expect(commands.every((item) => item.includes("bun run"))).toBe(true)
      },
    })
  })
})
