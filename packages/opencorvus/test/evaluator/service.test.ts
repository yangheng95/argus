import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import { GoalJudge } from "../../src/evaluator/agent"
import { BunProc } from "../../src/bun"
import { CheckRunner } from "../../src/evaluator/service"
import { Identifier } from "../../src/id/id"
import { OrchestratorSpecSnapshotTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { Plugin } from "../../src/plugin"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("evaluator.service", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("keeps discovered build test and lint scripts disabled by default", async () => {
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
        const resolved = await CheckRunner.resolveChecks()
        expect(resolved).toEqual({
          spec_check: {
            enabled: true,
            mode: "strict",
          },
        })
        const result = await CheckRunner.evaluate({}, { summary: "delivery ready" })
        expect(result.status).toBe("passed")
        expect(result.verdict).toBe("accepted")
        expect(result.checks.find((item) => item.name === "build")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "test")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "lint")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("passed")
      },
    })
  })

  test("uses plugin supplied evaluation analysis before calling the evaluator agent", async () => {
    const analyze = spyOn(GoalJudge, "analyze").mockRejectedValue(new Error("should not be called"))
    spyOn(Plugin, "trigger").mockImplementation(async (name, _input, output) => {
      if (name !== "evaluation.analysis") return output
      const next = output as {
        analysis?: {
          verdict: "accepted" | "rejected" | "inconclusive"
          classification: "transient" | "environment" | "input" | "permission" | "evaluation" | "strategy" | "unknown"
          summary: string
          goal_statuses: Array<{
            goal_index: number
            status: "passed" | "failed" | "inconclusive"
            evidence: string
            reasoning: string
          }>
          replan_guidance?: null
        }
      }
      next.analysis = {
        verdict: "accepted",
        classification: "evaluation",
        summary: "Plugin accepted the delivery.",
        goal_statuses: [{
          goal_index: 0,
          status: "passed",
          evidence: "All required checks passed.",
          reasoning: "Benchmark evaluator plugin accepted the delivery.",
        }],
        replan_guidance: null,
      }
      return output
    })

    const result = await CheckRunner.analyzeDelivery({
      task: {
        title: "benchmark",
        request: "benchmark",
      },
      goals: [{
        description: "Ship the change",
        criteria: "Checks pass",
        priority: "blocking",
      }],
      delivery: {
        summary: "done",
        changedFiles: ["src/catalog.ts"],
        diffs: [],
      },
      checkResults: [{
        name: "catalog_test",
        status: "passed",
        evidence: "ok",
      }],
    })

    expect(result.verdict).toBe("accepted")
    expect(result.summary).toBe("Plugin accepted the delivery.")
    expect(analyze).not.toHaveBeenCalled()
  })

  test("fails when verify_cmd exits non-zero", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
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
        const result = await CheckRunner.evaluate(
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
        expect(result.status).toBe("failed")
        expect(result.checks.map((item) => item.name)).toEqual(expect.arrayContaining(["py_compile", "pytest", "typecheck", "spec_check"]))
        expect(result.checks.map((item) => item.label)).toEqual(expect.arrayContaining(["Python Compile", "Pytest", "Type Check", "Spec Check"]))
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("failed")
      },
    })
  })

  test("runs named checks concurrently while preserving result order", async () => {
    await using tmp = await tmpdir({ git: true })
    const wait = `setTimeout(() => process.exit(0), 900)`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const started = Date.now()
        const result = await CheckRunner.evaluate(
          {
            metadata: {
              checks: {
                named: {
                  alpha: {
                    label: "Alpha",
                    family: "lint",
                    commands: [`"${BunProc.which()}" -e "${wait}"`],
                  },
                  beta: {
                    label: "Beta",
                    family: "test",
                    commands: [`"${BunProc.which()}" -e "${wait}"`],
                  },
                },
              },
            },
          },
          { summary: "delivery ready" },
        )
        const elapsed = Date.now() - started
        expect(result.status).toBe("failed")
        expect(result.checks.map((item) => item.name)).toEqual(["spec_check", "alpha", "beta"])
        expect(elapsed).toBeLessThan(3000)
      },
    })
  })

  test("runs explicit multi-command lint checks concurrently", async () => {
    await using tmp = await tmpdir({ git: true })
    const wait = `setTimeout(() => process.exit(0), 900)`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const started = Date.now()
        const result = await CheckRunner.evaluate(
          {
            metadata: {
              checks: {
                lint: [
                  `"${BunProc.which()}" -e "${wait}"`,
                  `"${BunProc.which()}" -e "${wait}"`,
                ],
              },
            },
          },
          { summary: "delivery ready" },
        )
        const elapsed = Date.now() - started
        expect(result.status).toBe("failed")
        expect(result.checks.map((item) => item.name)).toEqual(["lint#1", "lint#2", "spec_check"])
        expect(elapsed).toBeLessThan(3000)
      },
    })
  })

  test("keeps discovered named checks disabled by default", async () => {
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
        const resolved = await CheckRunner.resolveChecks()
        expect(resolved).toEqual({
          spec_check: {
            enabled: true,
            mode: "strict",
          },
        })

        const result = await CheckRunner.evaluate({}, { summary: "delivery ready" })
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "typecheck")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("passed")
      },
    })
  })

  test("preserves explicitly disabled core checks", async () => {
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
        const resolved = await CheckRunner.resolveChecks({
          checks: {
            build: false,
            test: false,
            lint: false,
            verify_cmd: false,
          },
        })
        expect(resolved.build).toBe(false)
        expect(resolved.test).toBe(false)
        expect(resolved.lint).toBe(false)
        expect(resolved.verify_cmd).toBe(false)

        const result = await CheckRunner.evaluate(
          {
            metadata: {
              checks: {
                build: false,
                test: false,
                lint: false,
                verify_cmd: false,
              },
            },
          },
          { summary: "delivery ready" },
        )
        expect(result.checks.find((item) => item.name === "build")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "test")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "lint")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "verify_cmd")).toBeUndefined()
      },
    })
  })

  test("respects an explicitly disabled spec_check even when a spec version exists", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const resolved = await CheckRunner.resolveChecks({
          checks: {
            verify_cmd: [`"${BunProc.which()}" -e "process.exit(0)"`],
            spec_check: {
              enabled: false,
              mode: "strict",
            },
          },
        })
        expect(resolved.spec_check).toEqual({
          enabled: false,
          mode: "strict",
        })

        const result = await CheckRunner.evaluate(
          {
            activeSpecVersionID: Identifier.ascending("spec"),
            metadata: {
              checks: {
                verify_cmd: [`"${BunProc.which()}" -e "process.exit(0)"`],
                spec_check: {
                  enabled: false,
                  mode: "strict",
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: ["src/types.ts"], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.verdict).toBe("accepted")
        expect(result.checks.find((item) => item.name === "verify_cmd")?.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "spec_check")).toBeUndefined()
      },
    })
  })

  test("artifact check in soft mode does not block the flow", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
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
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "artifact")?.status).toBe("skipped")
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("failed")
      },
    })
  })

  test("artifact check in strict mode fails when required files are missing", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
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
          const result = await CheckRunner.evaluate(
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
          expect(result.status).toBe("failed")
          expect(result.checks.find((item) => item.name === "visual")?.status).toBe("passed")
          expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("failed")
        },
      })
    } finally {
      server.stop(true)
    }
  })

  test("spec check fails when no model is available", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))
    const taskID = Identifier.ascending("task")
    const specID = Identifier.ascending("spec")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "implement feature",
              request: "implement feature",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "Compiled spec",
              content: "# Scope\n\nImplement feature",
              scope: "Implement feature",
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        const result = await CheckRunner.evaluate(
          {
            request: "implement feature",
            activeSpecVersionID: specID,
            metadata: {
              checks: {
                spec_check: {
                  enabled: true,
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("failed")
      },
    })
  })

  test("does not fail spec check early for large diffs that exceed the old total review limit", async () => {
    await using tmp = await tmpdir({ git: true })
    const defaultModel = spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))
    const taskID = Identifier.ascending("task")
    const specID = Identifier.ascending("spec")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "implement feature",
              request: "implement feature",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "Compiled spec",
              content: "# Scope\n\nImplement feature",
              scope: "Implement feature",
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        const result = await CheckRunner.evaluate(
          {
            request: "implement feature",
            activeSpecVersionID: specID,
            metadata: {
              checks: {
                spec_check: {
                  enabled: true,
                },
              },
            },
          },
          {
            summary: "delivery ready",
            changedFiles: ["big-a.ts", "big-b.ts"],
            diffs: [
              {
                file: "big-a.ts",
                before: "",
                after: "a".repeat(50_000),
                additions: 50_000,
                deletions: 0,
                status: "added",
              },
              {
                file: "big-b.ts",
                before: "",
                after: "b".repeat(40_000),
                additions: 40_000,
                deletions: 0,
                status: "added",
              },
            ],
          },
        )

        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "spec_check")).toMatchObject({
          status: "failed",
        })
        expect(result.checks.find((item) => item.name === "spec_check")?.evidence).toContain("No evaluator model available")
        expect(defaultModel).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("fails spec check when no active spec exists", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
          {
            request: "validate delivery",
            metadata: {
              checks: {
                verify_cmd: [`"${BunProc.which()}" -e "process.exit(0)"`],
                spec_check: {
                  enabled: true,
                  mode: "strict",
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )
        expect(result.status).toBe("failed")
        expect(result.verdict).toBe("rejected")
        expect(result.checks.find((item) => item.name === "spec_check")).toMatchObject({
          status: "failed",
          label: "Spec Check",
          family: "acceptance",
        })
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
        const result = await CheckRunner.evaluate(
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
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "startup")?.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("failed")
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
        const result = await CheckRunner.evaluate(
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
          const result = await CheckRunner.evaluate(
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
          expect(result.status).toBe("failed")
          const status = result.checks.find((item) => item.name === "puppeteer")?.status
          expect(status === "skipped" || status === "passed").toBe(true)
          expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("failed")
        },
      })
    } finally {
      server.stop(true)
    }
  })

  test("ui review skips when no review model is available in soft mode", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
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
        expect(result.checks.find((item) => item.name === "ui_review")?.status).toBe("skipped")
      },
    })
  })

  test("code quality review skips when no review model is available in soft mode", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
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
        expect(result.checks.find((item) => item.name === "code_quality")?.status).toBe("skipped")
      },
    })
  })

  test("code review skips when no review model is available in soft mode", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
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
        expect(result.checks.find((item) => item.name === "code_review")?.status).toBe("skipped")
      },
    })
  })

  test("dead code review skips when no review model is available in soft mode", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
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
        expect(result.checks.find((item) => item.name === "dead_code_review")?.status).toBe("skipped")
      },
    })
  })

  test("reuses review model lookup across multiple review checks", async () => {
    await using tmp = await tmpdir({ git: true })
    const defaultModel = spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
          {
            request: "Review the implementation quality.",
            metadata: {
              checks: {
                code_quality: {
                  enabled: true,
                  mode: "soft",
                },
                code_review: {
                  enabled: true,
                  mode: "soft",
                },
                dead_code_review: {
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
        expect(defaultModel).toHaveBeenCalledTimes(1)
        expect(
          result.checks
            .filter((item) => item.name === "code_quality" || item.name === "code_review" || item.name === "dead_code_review")
            .map((item) => item.name),
        ).toEqual([
          "code_quality",
          "code_review",
          "dead_code_review",
        ])
        expect(
          result.checks
            .filter((item) => item.name === "code_quality" || item.name === "code_review" || item.name === "dead_code_review")
            .every((item) => item.status === "skipped"),
        ).toBe(true)
      },
    })
  })

  test("startup check passes when a one-shot process prints ready text then exits zero", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(path.join(tmp.path, "ready-once.ts"), `console.log("ready once")\n`)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
          {
            request: "run the startup command once",
            metadata: {
              checks: {
                startup: {
                  command: `"${BunProc.which()}" ready-once.ts`,
                  ready_text: "ready once",
                  timeout_ms: 5_000,
                  mode: "strict",
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )
        expect(result.checks.find((item) => item.name === "startup")?.status).toBe("passed")
      },
    })
  })

  test("skips review checks after a strict local failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const defaultModel = spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
          {
            request: "Review the delivery.",
            metadata: {
              checks: {
                artifact: {
                  require_changed_files: true,
                  mode: "strict",
                },
                code_review: {
                  enabled: true,
                  mode: "soft",
                },
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
        expect(result.checks.find((item) => item.name === "artifact")?.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "code_review")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "judge")).toBeUndefined()
        expect(defaultModel).not.toHaveBeenCalled()
      },
    })
  })

  test("passes strict plugin checks when the plugin reports success", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Plugin, "trigger").mockImplementation(async (name, _input, output) => {
      if (name !== "evaluation.checks") return output
      const next = output as {
        checks: Array<{
          name: string
          mode: "soft" | "strict"
          run: () => Promise<{
            status: "passed" | "failed" | "skipped"
            evidence: string
            artifacts?: Array<{ kind: string; label: string; payload: Record<string, unknown> }>
          }>
        }>
      }
      next.checks.push({
        name: "plugin_gate",
        mode: "strict",
        run: async () => ({
          status: "passed",
          evidence: "Plugin validated delivery.",
        }),
      })
      return output
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate({}, { summary: "delivery ready", changedFiles: [], diffs: [] })
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "plugin_gate")?.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("failed")
      },
    })
  })

  test("keeps soft plugin failures skipped without turning them into hard plugin failures", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Plugin, "trigger").mockImplementation(async (name, _input, output) => {
      if (name !== "evaluation.checks") return output
      const next = output as {
        checks: Array<{
          name: string
          mode: "soft" | "strict"
          run: () => Promise<{
            status: "passed" | "failed" | "skipped"
            evidence: string
            artifacts?: Array<{ kind: string; label: string; payload: Record<string, unknown> }>
          }>
        }>
      }
      next.checks.push({
        name: "plugin_gate",
        mode: "soft",
        run: async () => ({
          status: "failed",
          evidence: "Plugin could not verify the delivery.",
        }),
      })
      return output
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate({}, { summary: "delivery ready", changedFiles: [], diffs: [] })
        expect(result.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("failed")
        expect(result.checks.find((item) => item.name === "plugin_gate")?.status).toBe("skipped")
      },
    })
  })

  test("annotates builtin optional checks with stable labels and families", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(Provider, "defaultModel").mockRejectedValue(new Error("no model"))
    const taskID = Identifier.ascending("task")
    const specID = Identifier.ascending("spec")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "review the delivery",
              request: "review the delivery",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "Compiled spec",
              content: "# Scope\n\nReview the delivery",
              scope: "Review the delivery",
              time_created: now,
              time_updated: now,
            })
            .run()
        })
        const result = await CheckRunner.evaluate(
          {
            request: "review the delivery",
            activeSpecVersionID: specID,
            metadata: {
              checks: {
                artifact: {
                  require_changed_files: true,
                  mode: "soft",
                },
                spec_check: {
                  enabled: true,
                },
              },
            },
          },
          { summary: "delivery ready", changedFiles: [], diffs: [] },
        )

        expect(result.checks.find((item) => item.name === "artifact")).toMatchObject({
          label: "Artifacts",
          family: "artifact",
          status: "skipped",
        })
        expect(result.checks.find((item) => item.name === "spec_check")).toMatchObject({
          label: "Spec Check",
          family: "acceptance",
          status: "failed",
        })
      },
    })
  })

  test("keeps changed puppeteer-core bun specs disabled by default", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "package.json"),
      JSON.stringify({
        name: "evaluator-puppeteer-test",
        scripts: {
          test: "bun -e \"process.exit(1)\"",
        },
      }),
    )
    await Bun.write(
      path.join(tmp.path, "sample.spec.ts"),
      `
        import { describe, expect, test } from "bun:test"
        import puppeteer from "puppeteer-core"
        describe("sample", () => {
          test("loads puppeteer-core", () => {
            expect(typeof puppeteer.launch).toBe("function")
          })
        })
      `,
    )
    await Bun.spawn(["bun", "add", "-d", "puppeteer-core@24.38.0"], {
      cwd: tmp.path,
      stdout: "ignore",
      stderr: "ignore",
    }).exited

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
          {
            request: "run browser test",
            metadata: {
              delivery_changed_files: ["sample.spec.ts"],
            },
          },
          { summary: "delivery ready", changedFiles: ["sample.spec.ts"], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "test")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("passed")
      },
    })
  }, 30000)

  test("keeps mixed changed bun specs disabled by default", async () => {
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
        import { describe, expect, test } from "bun:test"
        import puppeteer from "puppeteer-core"
        describe("sample", () => {
          test("loads puppeteer-core", () => {
            expect(typeof puppeteer.connect).toBe("function")
          })
        })
      `,
    )
    await Bun.write(
      path.join(tmp.path, "unit.test.ts"),
      `
        import { describe, expect, test } from "bun:test"
        const embedded = 'from "puppeteer-core"'
        describe("unit", () => {
          test("works", () => {
            expect(embedded.includes("puppeteer-core")).toBe(true)
            expect(1 + 1).toBe(2)
          })
        })
      `,
    )
    await Bun.spawn(["bun", "add", "-d", "puppeteer-core@24.38.0"], {
      cwd: tmp.path,
      stdout: "ignore",
      stderr: "ignore",
    }).exited

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await CheckRunner.evaluate(
          {
            request: "run browser test",
            metadata: {
              delivery_changed_files: ["sample.spec.ts", "unit.test.ts"],
            },
          },
          { summary: "delivery ready", changedFiles: ["sample.spec.ts", "unit.test.ts"], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "test")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("passed")
      },
    })
  }, 30000)

  test("keeps changed bun tests disabled by default", async () => {
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
        const result = await CheckRunner.evaluate(
          {
            request: "run unit test",
            metadata: {
              delivery_changed_files: ["unit.test.ts"],
            },
          },
          { summary: "delivery ready", changedFiles: ["unit.test.ts"], diffs: [] },
        )
        expect(result.status).toBe("passed")
        expect(result.checks.find((item) => item.name === "test")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("passed")
      },
    })
  })

  test("keeps nearest subproject package scripts disabled by default", async () => {
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
        const result = await CheckRunner.evaluate(
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
        expect(result.checks.find((item) => item.name === "build")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "test")).toBeUndefined()
        expect(result.checks.find((item) => item.name === "lint")).toBeUndefined()
        const commands = result.artifacts
          .filter((item) => item.kind === "log")
          .map((item) => String(item.payload.command ?? ""))
        expect(commands).toHaveLength(0)
        expect(result.checks.find((item) => item.name === "spec_check")?.status).toBe("passed")
      },
    })
  })
})
