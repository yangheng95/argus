import { describe, expect, test } from "bun:test"
import { PromptProfile } from "../../src/agent/prompt-profile"
import { EngineConfig } from "../../src/engine/config"
import { WorkflowRegistry } from "../../src/engine/workflow"
import { builtInPackageSources } from "../../src/expert-squad/builtin"
import { ExpertSquadRegistry } from "../../src/expert-squad/registry"
import { repositoryExpertSquadRoot } from "../fixture/expert-squad"
import { tmpdir } from "../fixture/fixture"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"

async function writeFile(root: string, relativePath: string, content: string) {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

async function writeEmbeddedPackage(root: string, source: (typeof builtInPackageSources)[number]) {
  for (const [relativePath, content] of Object.entries(source.files)) await writeFile(root, relativePath, content)
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    id: "frontend-replica",
    label: "Frontend Replica",
    description: "Replica squad",
    version: "2026.07.03",
    readme: "README.md",
    selector: {
      summary: "Use for replica tasks.",
      selection_guidance: "Call select_expert_squad with profile_id frontend-replica.",
      instructions: "selector.md",
    },
    capability_projection: {
      scheduler: {
        role_base: true,
        built_in_tool_ids: ["select_expert_squad", "skill", "build"],
        default_skill_refs: ["default/skill/workspace-guidance"],
        default_tool_refs: ["default/tool/project-index"],
        package_tool_refs: ["frontend-replica/orchestrator/source-evidence"],
        package_skill_refs: ["frontend-replica/orchestrator/scheduler"],
        package_mcp_server_refs: ["frontend-replica/orchestrator/browser"],
      },
      agents: {
        build: {
          role_base: true,
          package_skill_refs: ["frontend-replica/build/implementation"],
          package_tool_refs: ["frontend-replica/build/build-evidence"],
        },
      },
    },
    agents: {
      general: {
        prompt: "agents/general/system.md",
      },
      orchestrator: {
        prompt: "agents/orchestrator/system.md",
        skill_refs: ["frontend-replica/orchestrator/scheduler"],
        tool_refs: ["frontend-replica/orchestrator/source-evidence"],
        mcp_server_refs: ["frontend-replica/orchestrator/browser"],
      },
      build: {
        prompt: "agents/build/system.md",
        skill_refs: ["frontend-replica/build/implementation"],
        tool_refs: ["frontend-replica/build/build-evidence"],
      },
    },
    ...overrides,
  }
}

async function writeValidPackage(root: string, overrides: Record<string, unknown> = {}, folder = "frontend-replica") {
  const packageRoot = path.join(root, ".opencorvus", "expert-squads", folder)
  await writeFile(packageRoot, "README.md", "# Frontend Replica\n")
  await writeFile(packageRoot, "selector.md", "# Frontend Replica Selector\n")
  await writeFile(packageRoot, "agents/general/system.md", "general overlay")
  await writeFile(packageRoot, "agents/orchestrator/system.md", "orchestrator overlay")
  await writeFile(packageRoot, "agents/build/system.md", "build overlay")
  await writeFile(packageRoot, "agents/orchestrator/skills/scheduler/SKILL.md", "---\nname: scheduler\n---\n")
  await writeFile(packageRoot, "agents/build/skills/implementation/SKILL.md", "---\nname: implementation\n---\n")
  await writeFile(packageRoot, "agents/orchestrator/tools/source-evidence.ts", "export default {}")
  await writeFile(packageRoot, "agents/build/tools/build-evidence.ts", "export default {}")
  await writeFile(
    packageRoot,
    "agents/orchestrator/mcp/browser.jsonc",
    JSON.stringify({
      type: "local",
      command: ["node", "browser.js"],
      capabilities: {
        tools: ["snapshot"],
        prompts: ["inspect"],
        resources: ["dom"],
      },
    }),
  )
  await writeFile(packageRoot, ExpertSquadRegistry.MANIFEST, JSON.stringify(manifest(overrides), null, 2))
  return packageRoot
}

describe("ExpertSquadRegistry", () => {
  test("loads a valid package and generates selector metadata", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)

    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)

    expect(loaded.id).toBe("frontend-replica")
    expect(loaded.selector).toEqual({
      ref: "selector/frontend-replica",
      id: "frontend-replica",
      label: "Frontend Replica",
      description: "Replica squad",
      summary: "Use for replica tasks.",
      selection_guidance: "Call select_expert_squad with profile_id frontend-replica.",
    })
    expect(loaded.packageSkillRefs.has("frontend-replica/build/implementation")).toBe(true)
    expect(loaded.packageToolRefs.has("frontend-replica/build/build-evidence")).toBe(true)
    expect(loaded.packageMcpToolRefs.has("frontend-replica/orchestrator/browser/tool/snapshot")).toBe(true)
    expect(loaded.packageMcpPromptRefs.has("frontend-replica/orchestrator/browser/prompt/inspect")).toBe(true)
    expect(loaded.packageMcpResourceRefs.has("frontend-replica/orchestrator/browser/resource/dom")).toBe(true)
    expect(loaded.manifest.capability_projection.scheduler.package_mcp_prompt_refs).toEqual([])
    expect(loaded.manifest.capability_projection.scheduler.package_mcp_resource_refs).toEqual([])
    expect(loaded.explicitSchedulerWorkflowTools).toEqual(["build"])
    expect(loaded.readmeContent).toBe("# Frontend Replica")
  })

  test("reads display prefix from README front matter without adding it to prompt content", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(
      packageRoot,
      "README.md",
      "---\nexpert_squad_display_prefix: Partner\n---\n\n# Frontend Replica\n",
    )

    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)
    const [catalogEntry] = await ExpertSquadRegistry.discover(tmp.path)

    expect(loaded.displayPrefix).toBe("Partner")
    expect(loaded.readmeContent).toBe("# Frontend Replica")
    expect(catalogEntry?.displayPrefix).toBe("Partner")
  })

  test("rejects malformed README display prefix metadata", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(
      packageRoot,
      "README.md",
      "---\nexpert_squad_display_prefix: \"Bad/Prefix\"\n---\n\n# Frontend Replica\n",
    )

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/invalid README front matter/)
  })

  test("discovers packages under .opencorvus expert-squads", async () => {
    await using tmp = await tmpdir()
    await writeValidPackage(tmp.path, {
      selector: {
        summary: "Use for replica tasks.",
        selection_guidance: "Call select_expert_squad with profile_id frontend-replica.",
        instructions: "selector.md",
      },
    })
    await writeFile(
      path.join(tmp.path, ".opencorvus", "expert-squads", "frontend-replica"),
      "selector.md",
      "# Selector Instructions\n\nUse the detailed source-backed replica selector.",
    )

    const loaded = await ExpertSquadRegistry.discover(tmp.path)

    expect(loaded.map((item) => item.id)).toEqual(["frontend-replica"])
    expect(loaded[0]?.selectorInstructions).toContain("detailed source-backed replica selector")
  })

  test("rejects catalog selector instructions that point into production package files", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      selector: {
        summary: "Use for replica tasks.",
        selection_guidance: "Call select_expert_squad with profile_id frontend-replica.",
        instructions: "agents/orchestrator/system.md",
      },
    })

    await expect(ExpertSquadRegistry.discover(tmp.path)).rejects.toThrow(
      "selector instructions must be top-level selector.md",
    )
    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(
      "selector instructions must be top-level selector.md",
    )
    await expect(ExpertSquadRegistry.loadSourcePackage(packageRoot)).rejects.toThrow(
      "selector instructions must be top-level selector.md",
    )
  })

  test("loads every built-in expert squad package through the registry parser", async () => {
    await using tmp = await tmpdir()

    for (const source of builtInPackageSources) {
      const packageRoot = path.join(tmp.path, ".opencorvus", "expert-squads", source.id)
      await writeEmbeddedPackage(packageRoot, source)

      const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)
      const embedded = ExpertSquadRegistry.loadEmbeddedPackage(source)

      expect(loaded.id).toBe(source.id)
      expect(loaded.manifest).toEqual(embedded.manifest)
      expect(PromptProfile.builtIns[loaded.id]).toEqual(embedded.promptProfile)
      expect(loaded.readmePath.endsWith(path.join(source.id, "README.md"))).toBe(true)
      expect(loaded.readmeContent).toBe(embedded.readmeContent)
      expect(loaded.displayPrefix).toBe(embedded.displayPrefix)
    }
  })

  test("loads the repository software-testing package with workflow and package tool refs", async () => {
    const loaded = await ExpertSquadRegistry.loadPackage(repositoryExpertSquadRoot("software-testing"))

    expect(loaded.id).toBe("software-testing")
    expect(loaded.selector?.ref).toBe("selector/software-testing")
    expect(loaded.packageSkillRefs.has("software-testing/orchestrator/workflow")).toBe(true)
    expect(loaded.packageSkillRefs.has("software-testing/build/test-implementation")).toBe(true)
    expect(loaded.packageSkillRefs.has("software-testing/integrity/test-review")).toBe(true)
    expect(loaded.packageToolRefs.has("software-testing/shared/test-artifact-inventory")).toBe(true)
    expect(loaded.packageToolRefs.has("software-testing/shared/opentest-protocol-engine")).toBe(true)
    expect(loaded.manifest.capability_projection.scheduler.package_tool_refs).toEqual([
      "software-testing/shared/test-artifact-inventory",
      "software-testing/shared/opentest-protocol-engine",
    ])
    expect(loaded.explicitSchedulerWorkflowTools).toEqual(["build", "integrity"])
    expect(Object.keys(loaded.manifest.capability_projection.agents).sort()).toEqual(["build", "integrity"])
    expect(Object.keys(loaded.manifest.agents)).toEqual(["orchestrator"])
    expect(loaded.promptProfile.virtualAgents.build?.id).toBe("opentest-implementer")
    expect(loaded.promptProfile.virtualAgents.integrity?.id).toBe("opentest-reviewer")
    expect(loaded.promptProfile.virtualAgents.build?.promptContent).toContain("protocol-engine/opentest-contract.json")
  })

  test("software-testing OpenTest protocol engine parses the external contract and validates artifacts", async () => {
    await using tmp = await tmpdir()
    const packageRoot = repositoryExpertSquadRoot("software-testing")
    const engine = await import(pathToFileURL(path.join(packageRoot, "protocol-engine", "opentest-protocol-engine.ts")).href)
    const contractText = await fs.readFile(path.join(packageRoot, "protocol-engine", "opentest-contract.json"), "utf8")
    const contract = engine.parseProtocolContract(contractText)

    expect(contract.script.required_export).toBe("steps")
    expect(contract.script.mark_point_callee).toBe("ctx.mark_point")

    async function writeCase(
      directory: string,
      input: {
        testMarkdown?: string
        script?: string
        context?: string
        acceptance?: string
        result?: string
      } = {},
    ) {
      await writeFile(
        tmp.path,
        path.posix.join(directory, "TEST.md"),
        input.testMarkdown ??
          [
            "---",
            "testName: Login regression",
            "status: active",
            "testPoints:",
            "  - name: login accepts valid user",
            "  - name: renders home",
            "---",
            "# Login regression",
            "",
          ].join("\n"),
      )
      if (input.script !== undefined) {
        await writeFile(tmp.path, path.posix.join(directory, "script.ts"), input.script)
      }
      if (input.context !== undefined) {
        await writeFile(tmp.path, path.posix.join(directory, ".opentest/ctx.d.ts"), input.context)
      }
      if (input.acceptance !== undefined) {
        await writeFile(tmp.path, path.posix.join(directory, ".opentest/acceptance.json"), input.acceptance)
      }
      if (input.result !== undefined) {
        await writeFile(tmp.path, path.posix.join(directory, ".opentest/runs/nested/result.json"), input.result)
      }
    }

    const validScript = [
      "export const steps = [",
      "  async (ctx: { mark_point(name: string): Promise<void> }) => {",
      '    await ctx.mark_point("login accepts valid user")',
      '    await ctx.mark_point("renders home")',
      "  },",
      "]",
      "",
    ].join("\n")
    const contextContract = "export interface TestContext { mark_point(name: string): Promise<void> }\n"
    await writeCase("valid", {
      script: validScript,
      context: contextContract,
      acceptance: '{"status":"accepted"}\n',
      result: '{"status":"passed"}\n',
    })

    const valid = await engine.validateOpenTestCase({
      contract,
      projectDirectory: tmp.path,
      testDirectory: "valid",
    })
    expect(valid.valid).toBe(true)
    expect(valid.test_points).toEqual(["login accepts valid user", "renders home"])
    expect(valid.mark_points).toEqual(["login accepts valid user", "renders home"])
    expect(valid.artifacts.context_contract).toBe("valid/.opentest/ctx.d.ts")
    expect(valid.artifacts.acceptance).toBe("valid/.opentest/acceptance.json")
    expect(valid.artifacts.run_results).toEqual(["valid/.opentest/runs/nested/result.json"])

    await writeCase("missing-frontmatter", {
      testMarkdown: "# Missing frontmatter\n",
      script: validScript,
      context: contextContract,
      acceptance: '{"status":"accepted"}\n',
      result: '{"status":"passed"}\n',
    })
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "missing-frontmatter" }),
    ).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining(["TEST.md missing YAML frontmatter"]) })

    await writeCase("missing-script", {
      context: contextContract,
    })
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "missing-script" }),
    ).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining(["missing script.ts"]) })

    await writeCase("missing-steps-export", {
      script: "export async function run() { return true }\n",
      context: contextContract,
      acceptance: '{"status":"accepted"}\n',
      result: '{"status":"passed"}\n',
    })
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "missing-steps-export" }),
    ).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining(["script.ts missing exported steps"]) })

    await writeCase("unmarked-test-point", {
      script: [
        "export const steps = [",
        "  async (ctx: { mark_point(name: string): Promise<void> }) => {",
        '    await ctx.mark_point("login accepts valid user")',
        "  },",
        "]",
        "",
      ].join("\n"),
      context: contextContract,
      acceptance: '{"status":"accepted"}\n',
      result: '{"status":"passed"}\n',
    })
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "unmarked-test-point" }),
    ).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['testPoints "renders home" has no matching ctx.mark_point']),
    })

    await writeCase("extra-duplicate-mark", {
      script: [
        "export const steps = [",
        "  async (ctx: { mark_point(name: string): Promise<void> }) => {",
        '    await ctx.mark_point("login accepts valid user")',
        '    await ctx.mark_point("login accepts valid user")',
        '    await ctx.mark_point("not declared")',
        "  },",
        "]",
        "",
      ].join("\n"),
      context: contextContract,
      acceptance: '{"status":"accepted"}\n',
      result: '{"status":"passed"}\n',
    })
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "extra-duplicate-mark" }),
    ).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        'script.ts duplicate ctx.mark_point "login accepts valid user"',
        'ctx.mark_point "not declared" is not declared in testPoints',
      ]),
    })

    await writeCase("missing-context", {
      script: validScript,
      acceptance: '{"status":"accepted"}\n',
      result: '{"status":"passed"}\n',
    })
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "missing-context" }),
    ).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining(["missing .opentest/ctx.d.ts"]) })

    await writeCase("missing-acceptance", {
      script: validScript,
      context: contextContract,
      result: '{"status":"passed"}\n',
    })
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "missing-acceptance" }),
    ).resolves.toMatchObject({ valid: false, errors: expect.arrayContaining(["missing .opentest/acceptance.json"]) })

    await writeCase("missing-run-result", {
      script: validScript,
      context: contextContract,
      acceptance: '{"status":"accepted"}\n',
    })
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "missing-run-result" }),
    ).resolves.toMatchObject({
      valid: false,
      errors: expect.arrayContaining([expect.stringContaining("run result artifact")]),
    })

    await writeCase("commented-and-top-level-mark", {
      script: [
        "export const steps = []",
        '// ctx.mark_point("login accepts valid user")',
        'const text = "ctx.mark_point(\\"renders home\\")"',
        'ctx.mark_point("renders home")',
        "",
      ].join("\n"),
      context: contextContract,
      acceptance: '{"status":"accepted"}\n',
      result: '{"status":"passed"}\n',
    })
    const commented = await engine.validateOpenTestCase({
      contract,
      projectDirectory: tmp.path,
      testDirectory: "commented-and-top-level-mark",
    })
    expect(commented.valid).toBe(false)
    expect(commented.mark_points).toEqual([])
    expect(commented.errors).toEqual(
      expect.arrayContaining([
        'testPoints "login accepts valid user" has no matching ctx.mark_point',
        'testPoints "renders home" has no matching ctx.mark_point',
      ]),
    )

    await writeCase("active-script-edited", {
      script: validScript,
      context: contextContract,
      acceptance: '{"status":"accepted"}\n',
      result: '{"status":"passed"}\n',
    })
    const activeCaseRoot = path.join(tmp.path, "active-script-edited")
    const oldDate = new Date(Date.now() - 30_000)
    const midDate = new Date(Date.now() - 20_000)
    const newDate = new Date(Date.now() - 10_000)
    await fs.utimes(path.join(activeCaseRoot, "TEST.md"), oldDate, oldDate)
    await fs.utimes(path.join(activeCaseRoot, ".opentest", "acceptance.json"), midDate, midDate)
    await fs.utimes(path.join(activeCaseRoot, "script.ts"), newDate, newDate)
    await fs.utimes(path.join(activeCaseRoot, ".opentest", "runs", "nested", "result.json"), newDate, newDate)
    const activeEdited = await engine.validateOpenTestCase({
      contract,
      projectDirectory: tmp.path,
      testDirectory: "active-script-edited",
    })
    expect(activeEdited.valid).toBe(true)
    expect(activeEdited.lifecycle.declared_status).toBe("active")
    expect(activeEdited.lifecycle.effective_status).toBe("draft")
    expect(activeEdited.lifecycle.active_downgraded_to_draft).toBe(true)

    await writeCase("draft-updated-acceptance", {
      testMarkdown: [
        "---",
        "testName: Login regression",
        "status: draft",
        "testPoints:",
        "  - name: login accepts valid user",
        "  - name: renders home",
        "---",
        "# Login regression",
        "",
      ].join("\n"),
      script: validScript,
      context: contextContract,
      acceptance: '{"status":"accepted-after-draft-run"}\n',
      result: '{"status":"passed"}\n',
    })
    const draftCaseRoot = path.join(tmp.path, "draft-updated-acceptance")
    await fs.utimes(path.join(draftCaseRoot, ".opentest", "runs", "nested", "result.json"), midDate, midDate)
    await fs.utimes(path.join(draftCaseRoot, ".opentest", "acceptance.json"), newDate, newDate)
    await expect(
      engine.validateOpenTestCase({ contract, projectDirectory: tmp.path, testDirectory: "draft-updated-acceptance" }),
    ).resolves.toMatchObject({
      valid: false,
      lifecycle: expect.objectContaining({ draft_run_updates_acceptance: true }),
      errors: expect.arrayContaining(["model draft run must not update .opentest/acceptance.json"]),
    })

    expect(() =>
      engine.parseProtocolContract(
        JSON.stringify({
          ...contract,
          artifacts: {
            ...contract.artifacts,
            acceptance: "",
          },
        }),
      ),
    ).toThrow(/OpenTest protocol contract invalid: artifacts\.acceptance/)
  })

  test("rejects blank README because it is Orchestrator prompt content", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "README.md", " \n")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/readme: referenced file is blank/)
  })

  test("discovers selector metadata without parsing inactive package MCP definitions", async () => {
    await using tmp = await tmpdir()
    await writeValidPackage(tmp.path)
    const inactiveRoot = path.join(tmp.path, ".opencorvus", "expert-squads", "backend-debug")
    await writeFile(inactiveRoot, "README.md", "# Backend Debug\n")
    await writeFile(inactiveRoot, "agents/general/system.md", "general overlay")
    await writeFile(inactiveRoot, "mcp/broken.jsonc", "{")
    await writeFile(
      inactiveRoot,
      ExpertSquadRegistry.MANIFEST,
      JSON.stringify(
        manifest({
          id: "backend-debug",
          label: "Backend Debug",
          description: "Debug backend tasks",
          capability_projection: {
            scheduler: {
              role_base: true,
              built_in_tool_ids: ["select_expert_squad", "skill"],
            },
            agents: {},
          },
          agents: {
            general: {
              prompt: "agents/general/system.md",
            },
          },
        }),
        null,
        2,
      ),
    )
    await writeFile(inactiveRoot, "selector.md", "# Backend Debug Selector\n")

    const loaded = await ExpertSquadRegistry.discover(tmp.path)

    expect(loaded.map((item) => item.id)).toEqual(["backend-debug", "frontend-replica"])
    expect(loaded.find((item) => item.id === "backend-debug")?.selector?.ref).toBe("selector/backend-debug")
  })

  test("rejects id and folder mismatch", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, { id: "frontend-replica-v2" })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/must match folder/)
  })

  test("validates source packages without using source folder name as identity", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {}, "uploaded-folder")

    const loaded = await ExpertSquadRegistry.loadSourcePackage(packageRoot)

    expect(loaded.id).toBe("frontend-replica")
    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/must match folder/)
  })

  test("rejects manifest-declared paths with parent-directory segments", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      agents: {
        ...manifest().agents,
        general: {
          prompt: "../system.md",
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/unsafe relative path/)
  })

  test("rejects contained parent-directory path segments instead of normalizing them", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      agents: {
        ...manifest().agents,
        build: {
          ...manifest().agents.build,
          prompt: "agents/build/../build/system.md",
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/unsafe relative path/)
  })

  test("rejects manifest paths that cross an intermediate symlink", async () => {
    await using tmp = await tmpdir()
    const outside = path.join(tmp.path, "outside")
    await writeFile(outside, "system.md", "outside prompt")
    const packageRoot = await writeValidPackage(tmp.path, {
      agents: {
        ...manifest().agents,
        general: {
          prompt: "agents/general-link/system.md",
        },
      },
    })
    await fs.symlink(outside, path.join(packageRoot, "agents", "general-link"), process.platform === "win32" ? "junction" : "dir")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/symbolic links are not allowed/)
  })

  test("rejects unknown top-level package entries", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "notes.txt", "not part of the package contract")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/unknown top-level entry "notes.txt"/)
  })

  test("rejects runtime-internal package entries", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "r/session.json", "{}")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/runtime-internal entry "r"/)
  })

  test("rejects nested runtime-internal entries during package traversal", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "skills/research/runtime/session.json", "{}")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/runtime-internal entry "runtime"/)
  })

  test("rejects runtime-internal entries outside capability traversal paths", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "agents/build/runtime/session.json", "{}")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/runtime-internal entry "runtime"/)
  })

  test("discovers recursive skill folders by SKILL.md location", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "agents/build/skills/planning/deep/SKILL.md", "---\nname: deep\n---\n")
    await writeFile(packageRoot, "skills/research/deep/SKILL.md", "---\nname: shared-deep\n---\n")

    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)

    expect(loaded.packageSkillRefs.has("frontend-replica/build/planning/deep")).toBe(true)
    expect(loaded.packageSkillRefs.has("frontend-replica/shared/research/deep")).toBe(true)
  })

  test("rejects package-defined custom agents in phase 1", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      agents: {
        "custom-build": { prompt: "agents/build/system.md" },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/unknown agent role/)
  })

  test("accepts a virtual agent declared on a base role without a role overlay prompt", async () => {
    await using tmp = await tmpdir()
    const base = manifest()
    const agents = { general: base.agents.general, orchestrator: base.agents.orchestrator }
    const packageRoot = await writeValidPackage(tmp.path, {
      agents,
      virtual_agents: {
        build: {
          id: "frontend-replica-builder",
          label: "Frontend Replica Builder",
          description: "Package-owned expert identity on the build base role.",
          prompt: "virtual-agents/build/system.md",
        },
      },
    })
    await fs.rm(path.join(packageRoot, "agents", "build", "system.md"))
    await writeFile(packageRoot, "virtual-agents/build/system.md", "virtual build prompt")

    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)

    expect(loaded.promptProfile.agents.build).toBeUndefined()
    expect(loaded.promptProfile.virtualAgents.build).toMatchObject({
      id: "frontend-replica-builder",
      label: "Frontend Replica Builder",
      promptContent: "virtual build prompt",
    })
  })

  test("rejects a virtual agent that keeps the old role overlay prompt source", async () => {
    await using tmp = await tmpdir()
    const base = manifest()
    const agents = { general: base.agents.general, orchestrator: base.agents.orchestrator }
    const packageRoot = await writeValidPackage(tmp.path, {
      agents,
      virtual_agents: {
        build: {
          id: "frontend-replica-builder",
          label: "Frontend Replica Builder",
          prompt: "virtual-agents/build/system.md",
        },
      },
    })
    await writeFile(packageRoot, "virtual-agents/build/system.md", "virtual build prompt")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(
      /agents\/build\/system\.md must be absent/,
    )
  })

  test("rejects duplicate prompt binding between agents and virtual_agents", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      virtual_agents: {
        build: {
          id: "frontend-replica-builder",
          label: "Frontend Replica Builder",
          prompt: "virtual-agents/build/system.md",
        },
      },
    })
    await writeFile(packageRoot, "virtual-agents/build/system.md", "virtual build prompt")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(
      /agents\.build must be absent when a virtual agent is declared/,
    )
  })

  test("loadCatalogPackage rejects invalid virtual-agent package declarations", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      virtual_agents: {
        build: {
          id: "frontend-replica-builder",
          label: "Frontend Replica Builder",
          prompt: "virtual-agents/build/system.md",
        },
      },
    })
    await writeFile(packageRoot, "virtual-agents/build/system.md", "virtual build prompt")

    await expect(ExpertSquadRegistry.loadCatalogPackage(packageRoot)).rejects.toThrow(
      /agents\.build must be absent when a virtual agent is declared/,
    )
  })

  test("rejects virtual agent prompts outside the canonical virtual-agents role path", async () => {
    await using tmp = await tmpdir()
    const base = manifest()
    const agents = { general: base.agents.general, orchestrator: base.agents.orchestrator }
    const packageRoot = await writeValidPackage(tmp.path, {
      agents,
      virtual_agents: {
        build: {
          id: "frontend-replica-builder",
          label: "Frontend Replica Builder",
          prompt: "agents/build/system.md",
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(
      /virtual_agents\.build\.prompt must be virtual-agents\/build\/system\.md/,
    )
  })

  test("rejects unknown nested manifest fields", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          selector_refs: ["selector/frontend-replica"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/Unrecognized key/)
  })

  test("rejects selector disable fields instead of treating them as fallback", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, { selector: { enabled: false } })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow()
  })

  test("rejects selector metadata without selector.md instructions instead of synthesizing a skill body", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      selector: {
        summary: "Use for replica tasks.",
        selection_guidance: "Call select_expert_squad with profile_id frontend-replica.",
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow()
  })

  test("omitted selector does not generate selector metadata", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, { selector: undefined })

    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)

    expect(loaded.selector).toBeUndefined()
  })

  test("allows manifest-declared selector instructions only as top-level selector.md", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      selector: {
        ...manifest().selector,
        instructions: "selector.md",
      },
    })
    await writeFile(packageRoot, "selector.md", "# Selector Instructions\n")

    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)

    expect(loaded.selector?.ref).toBe("selector/frontend-replica")
  })

  test("rejects README as selector instructions because README is Orchestrator prompt content", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      selector: {
        ...manifest().selector,
        instructions: "README.md",
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(
      "selector instructions must be top-level selector.md",
    )
  })

  test("rejects missing manifest-declared selector instructions", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      selector: {
        ...manifest().selector,
        instructions: "selector.md",
      },
    })
    await fs.rm(path.join(packageRoot, "selector.md"))

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/selector\.instructions/)
  })

  test("rejects blank manifest-declared selector instructions", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      selector: {
        ...manifest().selector,
        instructions: "selector.md",
      },
    })
    await writeFile(packageRoot, "selector.md", "\n")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/selector\.instructions/)
  })

  test("selector metadata is manifest-derived and does not expose package skill content", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "skills/selector/SKILL.md", "inactive production skill content")

    const [metadata] = await ExpertSquadRegistry.discover(tmp.path)
    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)

    expect(metadata.selector?.summary).toBe("Use for replica tasks.")
    expect(JSON.stringify(metadata.selector)).not.toContain("inactive production skill content")
    expect("root" in metadata).toBe(false)
    expect("manifestPath" in metadata).toBe(false)
    expect("readmePath" in metadata).toBe(false)
    expect("packageSkillRefs" in metadata).toBe(false)
    expect(loaded.packageSkillRefs.has("selector/frontend-replica")).toBe(false)
  })

  test("rejects unknown built-in tools", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          built_in_tool_ids: ["select_expert_squad", "not_a_tool"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/unknown built-in tool/)
  })

  test("requires worker projections for workflow dispatch tools", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        agents: {},
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(
      /requires capability_projection\.agents\.build/,
    )
  })

  test("validates workflow dispatch tool owners from the active scheduler workflow list", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    const workflowBindings = WorkflowRegistry.schedulerAgentWorkflowBindingsForEngineConfig(
      EngineConfig.fromAssistantConfig({
        workflows: [
          {
            id: "custom-owner-map",
            name: "Custom owner map",
            description: "Test workflow that binds build tool ownership to integrity.",
            steps: [
              {
                id: "integrity-owned-build",
                tool: "build",
                agentRole: "integrity",
                label: "Integrity-owned build",
                hint: "Test only.",
                scope: "goal",
                skippable: false,
                after: [],
              },
            ],
            goalLoopStepIDs: ["integrity-owned-build"],
          },
        ],
      }),
    )

    await expect(ExpertSquadRegistry.loadPackage(packageRoot, { workflowBindings })).rejects.toThrow(
      /requires capability_projection\.agents\.integrity/,
    )
  })

  test("rejects package refs that are not declared in package files", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          package_skill_refs: ["frontend-replica/orchestrator/missing"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/is not declared in this package/)
  })

  test("rejects projection refs that bypass agent ownership declarations", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      agents: {
        ...manifest().agents,
        build: {
          prompt: "agents/build/system.md",
          tool_refs: ["frontend-replica/build/build-evidence"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/not declared in agents\.build/)
  })

  test("rejects agent ownership declarations for another agent-local ref", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      agents: {
        ...manifest().agents,
        build: {
          ...manifest().agents.build,
          skill_refs: ["frontend-replica/orchestrator/scheduler"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/owned by agents\.build/)
  })

  test("rejects worker projection refs owned by another agent", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        agents: {
          build: {
            ...manifest().capability_projection.agents.build,
            package_tool_refs: ["frontend-replica/orchestrator/source-evidence"],
          },
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/owned by agents\.build/)
  })

  test("rejects default refs outside the default namespace", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          default_skill_refs: ["frontend-replica/orchestrator/scheduler"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/must match default\/skill\/<name>/)
  })

  test("rejects typed default MCP refs in the server-ref list", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          default_mcp_server_refs: ["default/mcp/browser/tool/snapshot"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/must match default\/mcp\/<name>/)
  })

  test("rejects typed MCP refs not statically declared by the package MCP definition", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          package_mcp_tool_refs: ["frontend-replica/orchestrator/browser/tool/missing"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/is not declared in this package/)
  })

  test("rejects package MCP capabilities declared by both server ref and typed refs", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          package_mcp_tool_refs: ["frontend-replica/orchestrator/browser/tool/snapshot"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/already mounted by package_mcp_server_refs/)
  })

  test("rejects typed package MCP prompt refs not statically declared by the package MCP definition", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          package_mcp_prompt_refs: ["frontend-replica/orchestrator/browser/prompt/missing"],
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/is not declared in this package/)
  })

  test("rejects typed package MCP resource refs owned by another agent", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        agents: {
          build: {
            ...manifest().capability_projection.agents.build,
            package_mcp_resource_refs: ["frontend-replica/orchestrator/browser/resource/dom"],
          },
        },
      },
    })

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/owned by agents\.build/)
  })

  test("rejects malformed default MCP prompt and resource refs", async () => {
    await using tmp = await tmpdir()
    const promptPackageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          default_mcp_prompt_refs: ["default/mcp/browser"],
        },
      },
    })
    await expect(ExpertSquadRegistry.loadPackage(promptPackageRoot)).rejects.toThrow(/invalid default MCP prompt ref/)

    await using second = await tmpdir()
    const resourcePackageRoot = await writeValidPackage(second.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          default_mcp_resource_refs: ["default/mcp/browser/tool/snapshot"],
        },
      },
    })
    await expect(ExpertSquadRegistry.loadPackage(resourcePackageRoot)).rejects.toThrow(/invalid default MCP resource ref/)
  })

  test("rejects MCP capability names that cannot form canonical refs", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(
      packageRoot,
      "agents/orchestrator/mcp/browser.jsonc",
      JSON.stringify({ type: "local", command: ["node", "browser.js"], capabilities: { tools: ["bad/name"] } }),
    )

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/canonical ref segments/)
  })

  test("rejects package MCP definitions outside the Config.Mcp schema", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(
      packageRoot,
      "agents/orchestrator/mcp/browser.jsonc",
      JSON.stringify({ command: "node", args: ["browser.js"], capabilities: { tools: ["snapshot"] } }),
    )

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow()
  })

  test("rejects tool files with empty canonical ref segments", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "agents/build/tools/.ts", "export default {}")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/invalid canonical ref segment/)
  })

  test("rejects MCP files with empty canonical ref segments", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path)
    await writeFile(packageRoot, "agents/orchestrator/mcp/.jsonc", "{}")

    await expect(ExpertSquadRegistry.loadPackage(packageRoot)).rejects.toThrow(/invalid canonical ref segment/)
  })

  test("keeps agent-local and shared MCP refs distinct", async () => {
    await using tmp = await tmpdir()
    const packageRoot = await writeValidPackage(tmp.path, {
      capability_projection: {
        ...manifest().capability_projection,
        scheduler: {
          ...manifest().capability_projection.scheduler,
          package_mcp_server_refs: [
            "frontend-replica/orchestrator/browser",
            "frontend-replica/shared/browser",
          ],
        },
      },
    })
    await writeFile(
      packageRoot,
      "mcp/browser.jsonc",
      JSON.stringify({ type: "local", command: ["node", "browser.js"], capabilities: { tools: ["snapshot"] } }),
    )

    const loaded = await ExpertSquadRegistry.loadPackage(packageRoot)

    expect(loaded.packageMcpServerRefs.has("frontend-replica/orchestrator/browser")).toBe(true)
    expect(loaded.packageMcpServerRefs.has("frontend-replica/shared/browser")).toBe(true)
    expect(loaded.packageMcpToolRefs.has("frontend-replica/orchestrator/browser/tool/snapshot")).toBe(true)
    expect(loaded.packageMcpToolRefs.has("frontend-replica/shared/browser/tool/snapshot")).toBe(true)
  })
})
