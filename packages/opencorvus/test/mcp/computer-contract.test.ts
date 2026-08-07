import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PNG } from "pngjs"
import { PassThrough } from "node:stream"
import { ComputerMCPBuiltin } from "../../src/mcp/computer/builtin"
import {
  JsonLineComputerBackend,
  type ComputerBackend,
  type ComputerBackendAction,
  type ComputerBackendObservation,
} from "../../src/mcp/computer/backend"
import { ComputerController } from "../../src/mcp/computer/controller"
import { COMPUTER_MCP_PERMISSION_BASELINE, computerMcpPermissionPlan } from "../../src/mcp/computer/permission-plan"
import {
  provisionComputerRuntimeBundle,
  verifyComputerRuntimeBundle,
  verifyProvisionedComputerRuntimeBundle,
} from "../../src/mcp/computer/runtime-bundle"
import { ConversationCapability } from "../../src/conversation/capability"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { memoryProject } from "../fixture/memory"
import { materializeMcpToolResult } from "../../src/mcp/materialize"
import { ExpertSquadConversationAuthoring } from "../../src/expert-squad/conversation-authoring"
import { PromptProfileResolver } from "../../src/expert-squad/prompt-profile-resolver"
import { buildExpertSquadAuthorDefinition } from "../../src/tool/expert-squad-author"
import { MCP } from "../../src/mcp"
import { computerMcpPermissionKeyOf } from "../../src/mcp/computer/permission-plan"
import { resolveComputerViewer } from "../../src/mcp/computer/viewer"
import { computerRuntimeScopeIdentity, computerRuntimeWorkspace } from "../../src/mcp/computer/runtime-scope"
import { CapabilityCatalog, searchCapabilityCatalog } from "../../src/capability/catalog"
import { PermissionNext } from "../../src/permission/next"
import { ComputerHostRuntimeAuthority } from "../../src/mcp/computer/host-runtime"
import { HostComputerBackend } from "../../src/mcp/computer/host-client"
import { EngineService } from "../../src/task-api"
import { configureTaskLoopRunner } from "../../src/engine/queue"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })))
})

function pngBase64(width: number, height: number) {
  const image = new PNG({ width, height })
  image.data.fill(255)
  return PNG.sync.write(image).toString("base64")
}

class RecordingBackend implements ComputerBackend {
  readonly actions: ComputerBackendAction[] = []
  observations: ComputerBackendObservation[] = [
    { computerId: "computer-1", displayId: "display-1", pngBase64: pngBase64(8, 6) },
    { computerId: "computer-1", displayId: "display-1", pngBase64: pngBase64(10, 7) },
  ]
  destroyCalls: string[] = []

  async create() {
    return {
      computerId: "computer-1",
      displayId: "display-1",
      bundleId: "bundle-1",
    }
  }

  async observe() {
    return this.observations.shift()!
  }

  async act(action: ComputerBackendAction) {
    this.actions.push(action)
    return { accepted: true as const, backendActionId: `action-${this.actions.length}` }
  }

  async destroy(input: { computerId: string }) {
    this.destroyCalls.push(input.computerId)
    return { destroyed: true as const }
  }

  async close() {}
}

class LifecycleBackend implements ComputerBackend {
  readonly events: string[] = []
  private readonly screens = [pngBase64(8, 6), pngBase64(10, 7)]

  async create() {
    this.events.push("guest:create")
    return { computerId: "computer-lifecycle", displayId: "display-lifecycle", bundleId: "bundle-lifecycle" }
  }

  async observe(input: { computerId: string; displayId: string }) {
    this.events.push(`guest:observe:${input.computerId}:${input.displayId}`)
    return { computerId: input.computerId, displayId: input.displayId, pngBase64: this.screens.shift()! }
  }

  async act() {
    this.events.push("guest:act")
    return { accepted: true as const, backendActionId: "lifecycle-action" }
  }

  async destroy(input: { computerId: string }) {
    this.events.push(`guest:destroy:${input.computerId}`)
    return { destroyed: true as const }
  }

  async close() {
    this.events.push("runtime:close")
  }
}

describe("Computer Use exact control contract", () => {
  test("publishes the complete narrow MCP tool reference set", () => {
    expect(ComputerMCPBuiltin.ImportableToolRefs).toEqual([
      "default/mcp/computer/tool/session_create",
      "default/mcp/computer/tool/observe",
      "default/mcp/computer/tool/click",
      "default/mcp/computer/tool/type_text",
      "default/mcp/computer/tool/keypress",
      "default/mcp/computer/tool/scroll",
      "default/mcp/computer/tool/drag",
      "default/mcp/computer/tool/session_destroy",
    ])
  })

  test("derives the exact host runtime owner identities for every supported execution surface", () => {
    expect(computerRuntimeScopeIdentity({ ownerKind: "conversation", sessionID: "session-1" })).toBe(
      "conversation:session-1:computer",
    )
    expect(computerRuntimeScopeIdentity({ ownerKind: "orchestrator", taskID: "task-1", sessionID: "session-2" })).toBe(
      "orchestrator:task-1:session-2",
    )
    expect(computerRuntimeScopeIdentity({ ownerKind: "worker", taskID: "task-1", sessionID: "session-3" })).toBe(
      "worker:task-1:session-3",
    )
  })

  test("preserves one host-owned guest across takeover and returns with a fresh adapter run", async () => {
    const runtime = new LifecycleBackend()
    const authority = new ComputerHostRuntimeAuthority({ entries: new Map(), authorizations: new Map() }, () => runtime)
    const firstAdapter = authority.adapter({
      runtimeScope: "conversation:session-lifecycle:computer",
      manifestPath: "provisioned/computer-runtime.json",
    })
    const firstController = new ComputerController(
      new HostComputerBackend(
        firstAdapter.endpoint,
        firstAdapter.authorization,
        firstAdapter.runtimeScope,
        (input, init) => authority.fetch(new Request(input, init)),
      ),
    )
    const created = await firstController.create()
    const firstObservation = await firstController.observe({
      computerId: created.computerId,
      displayId: created.displayId,
    })
    expect(firstObservation).toMatchObject({ width: 8, height: 6 })
    expect(
      authority.takeover({
        runtimeScope: firstAdapter.runtimeScope,
        computerId: created.computerId,
        displayId: created.displayId,
      }),
    ).toEqual({
      ownership: "human",
      computerId: "computer-lifecycle",
      displayId: "display-lifecycle",
      runtimeBundleId: "bundle-lifecycle",
      guestPreserved: true,
    })
    await firstController.close()

    expect(
      authority.returnControl({
        runtimeScope: firstAdapter.runtimeScope,
        computerId: created.computerId,
        displayId: created.displayId,
      }),
    ).toEqual({
      ownership: "agent",
      computerId: "computer-lifecycle",
      displayId: "display-lifecycle",
      runtimeBundleId: "bundle-lifecycle",
      freshObservationRequired: true,
    })
    const secondAdapter = authority.adapter({
      runtimeScope: firstAdapter.runtimeScope,
      manifestPath: "provisioned/computer-runtime.json",
    })
    expect(new Set([firstAdapter.authorization, secondAdapter.authorization]).size).toBe(2)
    const secondController = new ComputerController(
      new HostComputerBackend(
        secondAdapter.endpoint,
        secondAdapter.authorization,
        secondAdapter.runtimeScope,
        (input, init) => authority.fetch(new Request(input, init)),
      ),
    )
    expect(await secondController.create()).toEqual(created)
    expect(
      await secondController.observe({ computerId: created.computerId, displayId: created.displayId }),
    ).toMatchObject({ width: 10, height: 7 })
    expect(await secondController.destroy({ computerId: created.computerId })).toEqual({
      computerId: "computer-lifecycle",
      destroyed: true,
    })
    await secondController.close()
    await authority.close()
    expect(runtime.events).toEqual([
      "guest:create",
      "guest:observe:computer-lifecycle:display-lifecycle",
      "guest:observe:computer-lifecycle:display-lifecycle",
      "guest:destroy:computer-lifecycle",
      "runtime:close",
    ])
  })

  test("maps an observation-bound click to one exact backend action", async () => {
    const backend = new RecordingBackend()
    const controller = new ComputerController(backend)
    const created = await controller.create()
    const observed = await controller.observe({ computerId: created.computerId, displayId: created.displayId })
    const result = await controller.act(
      {
        computerId: observed.computerId,
        displayId: observed.displayId,
        observationId: observed.observationId,
        observationDigest: observed.observationDigest,
      },
      { kind: "click", x: 3, y: 4, button: "left" },
    )

    expect(observed).toMatchObject({ width: 8, height: 6 })
    expect(observed.observationDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(backend.actions).toEqual([
      {
        kind: "click",
        computerId: "computer-1",
        displayId: "display-1",
        x: 3,
        y: 4,
        button: "left",
      },
    ])
    expect(result).toEqual({
      computerId: "computer-1",
      displayId: "display-1",
      observationId: observed.observationId,
      observationDigest: observed.observationDigest,
      accepted: true,
      backendActionId: "action-1",
    })
  })

  test("returns the typed stale-observation contract after a newer screen becomes authoritative", async () => {
    const backend = new RecordingBackend()
    const controller = new ComputerController(backend)
    const created = await controller.create()
    const first = await controller.observe({ computerId: created.computerId, displayId: created.displayId })
    const second = await controller.observe({ computerId: created.computerId, displayId: created.displayId })

    expect(second).toMatchObject({ width: 10, height: 7 })
    await expect(
      controller.act(
        {
          computerId: first.computerId,
          displayId: first.displayId,
          observationId: first.observationId,
          observationDigest: first.observationDigest,
        },
        { kind: "type_text", text: "hello" },
      ),
    ).rejects.toMatchObject({ code: "STALE_OBSERVATION" })
  })

  test("consumes one observation after exactly one accepted backend action", async () => {
    const backend = new RecordingBackend()
    const controller = new ComputerController(backend)
    const created = await controller.create()
    const observed = await controller.observe({ computerId: created.computerId, displayId: created.displayId })
    const binding = {
      computerId: observed.computerId,
      displayId: observed.displayId,
      observationId: observed.observationId,
      observationDigest: observed.observationDigest,
    }

    expect(await controller.act(binding, { kind: "keypress", keys: ["ENTER"] })).toMatchObject({
      accepted: true,
      backendActionId: "action-1",
    })
    await expect(controller.act(binding, { kind: "keypress", keys: ["ENTER"] })).rejects.toMatchObject({
      code: "STALE_OBSERVATION",
    })
    expect(backend.actions).toEqual([
      {
        kind: "keypress",
        computerId: "computer-1",
        displayId: "display-1",
        keys: ["ENTER"],
      },
    ])
  })

  test("maps Computer tools onto the canonical permission identities", () => {
    expect(computerMcpPermissionPlan("computer_session_create", {})).toMatchObject({
      permission: "computer.session.create",
      patterns: ["vm-only"],
    })
    expect(computerMcpPermissionPlan("computer_observe", { computer_id: "computer-1" })).toMatchObject({
      permission: "computer.observe",
      patterns: ["computer-1"],
    })
    expect(computerMcpPermissionPlan("computer_drag", { computer_id: "computer-1" })).toMatchObject({
      permission: "computer.input",
      patterns: ["computer-1"],
    })
    expect(computerMcpPermissionPlan("computer_session_destroy", { computer_id: "computer-1" })).toMatchObject({
      permission: "computer.session.destroy",
      patterns: ["computer-1"],
    })
    expect(
      PermissionNext.evaluate("computer.input", "computer-1", COMPUTER_MCP_PERMISSION_BASELINE, [
        { permission: "computer.input", pattern: "computer-1", action: "ask" },
      ]),
    ).toEqual({ permission: "computer.input", pattern: "computer-1", action: "ask" })
    expect(
      PermissionNext.evaluate("computer.session.destroy", "computer-1", COMPUTER_MCP_PERMISSION_BASELINE, [
        { permission: "computer.session.destroy", pattern: "computer-1", action: "deny" },
      ]),
    ).toEqual({ permission: "computer.session.destroy", pattern: "computer-1", action: "deny" })
  })

  test(
    "projects the exact Computer tool set into an assigned direct Work conversation",
    { timeout: 30_000 },
    async () => {
      await using project = await memoryProject()
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          const settings = await ConversationCapability.update("work", {
            kind: "mcp_server",
            ref: ComputerMCPBuiltin.ServerName,
            assigned: true,
          })
          expect(settings.mcp).toMatchObject({
            assigned_server_refs: [ComputerMCPBuiltin.ServerName],
          })
          expect(settings.mcp.configured_server_refs).toContain(ComputerMCPBuiltin.ServerName)

          const config = await Config.get()
          const tools = await ConversationCapability.runtimeMcpTools(
            config,
            "work",
            "session-computer-catalog-contract",
          )
          expect(Object.keys(tools).sort()).toEqual(
            ComputerMCPBuiltin.ImportableToolNames.map((name) => `computer_${name}`).sort(),
          )

          const executionMcpToolIDs = Object.keys(tools)
          const harnessProjection = await ConversationCapability.harnessProjection("work", {
            config,
            executionToolIDs: executionMcpToolIDs,
            executionMcpToolIDs,
          })
          const { caller, snapshot } = await CapabilityCatalog.runtimeSnapshot({
            config,
            sessionID: "session-computer-catalog-contract",
            agentID: "work",
            executionToolIDs: executionMcpToolIDs,
            harnessProjection,
          })
          const mcpEntries = snapshot.entries.filter((entry) => entry.ref.owner_ref === "mcp-config")
          expect(mcpEntries.map((entry) => [entry.ref.kind, entry.ref.local_ref, entry.availability])).toEqual([
            ["mcp_server", "browser", "installed_unbound"],
            ["mcp_server", "computer", "visible"],
            ...executionMcpToolIDs.sort().map((toolID) => ["mcp_tool", toolID, "visible"]),
          ])
          expect(
            searchCapabilityCatalog(snapshot, caller, { next_owner_kinds: ["call_tool"] }).map(
              (entry) => entry.ref.local_ref,
            ),
          ).toEqual(executionMcpToolIDs)
          expect(ConversationCapability.runtimeMcpOwnerIdentity("session-computer-catalog-contract")).toBe(
            "conversation:session-computer-catalog-contract:computer",
          )
          expect(ConversationCapability.runtimeMcpOwnerIdentity("session-computer-independent-contract")).toBe(
            "conversation:session-computer-independent-contract:computer",
          )
          await ConversationCapability.disposeRuntimeMcp("session-computer-catalog-contract")
        },
      })
    },
  )

  test("materializes an observation with Computer identity and its persisted image attachment", async () => {
    await using project = await memoryProject()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const observationDigest = "a".repeat(64)
        const result = await materializeMcpToolResult({
          projectID: Instance.project.id,
          result: {
            content: [{ type: "image", data: pngBase64(8, 6), mimeType: "image/png" }],
            structuredContent: {
              ok: true,
              computer_id: "computer-1",
              display_id: "display-1",
              observation_id: "observation-1",
              observation_digest: observationDigest,
              width: 8,
              height: 6,
              mime_type: "image/png",
            },
          },
        })

        expect(result.attachments).toHaveLength(1)
        expect(result.metadata).toEqual({
          computer: {
            computerId: "computer-1",
            displayId: "display-1",
            observationId: "observation-1",
            observationDigest,
            screenshot: {
              mimeType: "image/png",
              width: 8,
              height: 6,
              attachmentUrl: result.attachments[0]!.url,
              sha: result.attachments[0]!.sha,
            },
          },
          mcp_tool_result: { is_error: false },
        })

        expect(
          await materializeMcpToolResult({
            projectID: Instance.project.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    computer_id: "computer-1",
                    display_id: "display-1",
                    runtime_bundle_id: "bundle-1",
                  }),
                },
              ],
              structuredContent: {
                ok: true,
                computer_id: "computer-1",
                display_id: "display-1",
                runtime_bundle_id: "bundle-1",
              },
            },
          }),
        ).toMatchObject({
          attachments: [],
          metadata: {
            computer: {
              computerId: "computer-1",
              displayId: "display-1",
              runtimeBundleId: "bundle-1",
            },
            mcp_tool_result: { is_error: false },
          },
        })
      },
    })
  })

  test(
    "projects explicitly declared Computer tools through an Expert Squad harness with canonical permissions",
    { timeout: 30_000 },
    async () => {
      await using project = await memoryProject()
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          const profileID = "computer-harness-contract"
          await ExpertSquadConversationAuthoring.author({
            projectDirectory: project.path,
            installationScope: "project",
            replace: false,
            definition: buildExpertSquadAuthorDefinition({
              schema_version: 1,
              namespace: "test",
              id: profileID,
              name: "Computer Harness Contract",
              label: "Computer Harness Contract",
              description: "Projects the exact Computer capability through an Expert Squad harness.",
              version: "2026.08.07.1",
              product_pillars: ["work"],
              readme: "# Computer Harness Contract\n\nExercises exact Computer projection.\n",
              selector: {
                summary: "Exercise exact Computer projection.",
                selection_guidance: "Select for the Computer harness contract.",
                instructions: "# Selection\n\nSelect for the Computer harness contract.\n",
              },
              scheduler: {
                prompt: "Coordinate the exact Computer harness contract.",
                default_mcp_tool_refs: [...ComputerMCPBuiltin.ImportableToolRefs],
              },
              agents: {
                "computer-contract-worker": {
                  label: "Computer Contract Worker",
                  description: "Executes the exact projected Computer contract.",
                  base_role: "build",
                  prompt: "Execute the exact projected Computer contract.",
                },
              },
              virtual_workflows: {},
            }),
          })
          const config = Config.Info.parse({
            prompt_profile: { active: profileID },
            mcp: { [ComputerMCPBuiltin.ServerName]: { enabled: false } },
          })
          const capability = await PromptProfileResolver.resolveSchedulerCapability({
            projectDirectory: project.path,
            config,
          })
          expect(capability.defaultMcpTools.map((entry) => entry.ref)).toEqual([
            ...ComputerMCPBuiltin.ImportableToolRefs,
          ])

          configureTaskLoopRunner(async () => {})
          const taskID = await EngineService.createTask(
            {
              requestID: "computer-harness-contract-task",
              request: "Project the exact Computer tools through the Expert Squad harness",
              productPillar: "work",
              model: "firmware/gpt-5",
              promptProfile: profileID,
              expectedPackageDigest: capability.packageRevision.packageDigest,
              queue: true,
            },
            { actor: "user" },
          )

          const harness = PromptProfileResolver.schedulerHarnessProjection({
            taskID,
            capability,
          })
          expect(harness.mcp_tool_refs).toEqual(
            capability.defaultMcpTools
              .map((entry) => ({
                kind: "mcp_tool" as const,
                source: "project" as const,
                owner_ref: "default-mcp-registry",
                local_ref: entry.providerName,
              }))
              .sort((left, right) => left.local_ref.localeCompare(right.local_ref)),
          )

          const owner = MCP.createScopedConnectionOwner("test:computer-harness-contract")
          try {
            const projected = await PromptProfileResolver.projectOrchestratorTools(
              Object.fromEntries(capability.builtInToolIDs.map((toolID) => [toolID, {}])),
              capability,
              {
                taskID,
                projectDirectory: project.path,
                connectionOwner: owner,
              },
            )
            expect(Object.keys(projected).sort()).toEqual(
              [...capability.builtInToolIDs, ...capability.defaultMcpTools.map((entry) => entry.providerName)].sort(),
            )
            for (const entry of capability.defaultMcpTools) {
              const toolName = entry.ref.split("/").at(-1)!
              expect(computerMcpPermissionKeyOf(projected[entry.providerName] as object)).toBe(`computer_${toolName}`)
            }
          } finally {
            await owner.close()
          }
        },
      })
    },
  )
})

describe("Computer runtime bundle integrity contract", () => {
  test("classifies a lost post-dispatch create response as an unknown effect outcome", async () => {
    const workspace = computerRuntimeWorkspace("fault-injection:create-response-loss")
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let resolveExit!: (code: number) => void
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve
    })
    stdin.once("data", () => resolveExit(71))
    const closeStreams = async () => {
      stdin.destroy()
      stdout.destroy()
      stderr.destroy()
      resolveExit(0)
    }
    const backend = new JsonLineComputerBackend({
      manifestPath: "provisioned/computer-runtime.json",
      workspace,
      verifyRuntime: async () =>
        ({
          manifestPath: "provisioned/computer-runtime.json",
          directory: "provisioned",
          launcherPath: "provisioned/runtime.exe",
          viewerPath: "provisioned/viewer.exe",
          contentID: "f".repeat(64),
          manifest: {
            request_timeout_ms: 20_000,
            protocol_version: 1,
            bundle_id: "fault-injection-bundle",
            launcher: { args: [] },
          },
        }) as never,
      spawnRuntime: async () => ({
        pid: 71,
        stdin,
        stdout,
        stderr,
        exited,
        terminate: closeStreams,
        dispose: closeStreams,
        unref() {},
      }),
    })
    try {
      await expect(backend.create()).rejects.toMatchObject({
        code: "COMPUTER_OUTCOME_UNKNOWN",
        details: { operation: "session_create" },
      })
    } finally {
      await backend.close()
    }
  })

  test("verifies the exhaustive self-contained bundle and resolves its absolute launcher", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-computer-bundle-"))
    temporaryDirectories.push(directory)
    const files = [
      "runtime.exe",
      "adapter.js",
      "python.exe",
      "wheels.lock",
      "qemu.exe",
      "firmware.fd",
      "guest.img",
      "viewer.exe",
      "sbom.spdx.json",
      "licenses.json",
      "provenance.json",
      "attestation.json",
    ]
    const inventory = []
    for (const [index, relativePath] of files.entries()) {
      const content = Buffer.from(`computer-runtime-${index}`)
      await fs.writeFile(path.join(directory, relativePath), content)
      inventory.push({
        path: relativePath,
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: content.byteLength,
      })
    }
    const byPath = new Map(inventory.map((item) => [item.path, item]))
    const manifestPath = path.join(directory, "computer-runtime.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        schema_version: 1,
        protocol_version: 1,
        request_timeout_ms: 20_000,
        bundle_id: "cua-windows-1",
        bundle_version: "2026.08.06",
        platform: { os: "win32", arch: "x64" },
        upstream: {
          repository: "https://github.com/trycua/cua",
          commit: "bb8efbfe6caadbccba54221096d959607ed9f574",
          computer_server_version: "0.3.42",
        },
        launcher: { path: "runtime.exe", sha256: byPath.get("runtime.exe")!.sha256, args: [] },
        adapter: { path: "adapter.js", sha256: byPath.get("adapter.js")!.sha256, protocol: "jsonl-v1" },
        python: { path: "python.exe", sha256: byPath.get("python.exe")!.sha256, version: "3.13.5" },
        wheel_lock: { path: "wheels.lock", sha256: byPath.get("wheels.lock")!.sha256 },
        hypervisor: {
          path: "qemu.exe",
          sha256: byPath.get("qemu.exe")!.sha256,
          kind: "qemu",
          version: "10.0.2",
        },
        firmware: { path: "firmware.fd", sha256: byPath.get("firmware.fd")!.sha256 },
        guest_image: {
          path: "guest.img",
          sha256: byPath.get("guest.img")!.sha256,
          identity: "windows-evaluation-image",
        },
        viewer: {
          path: "viewer.exe",
          sha256: byPath.get("viewer.exe")!.sha256,
          protocol: "workspace-descriptor-v1",
          descriptor: "viewer.json",
        },
        network: { control: "host-only", business: "guest-managed" },
        sbom: { path: "sbom.spdx.json", sha256: byPath.get("sbom.spdx.json")!.sha256 },
        licenses: { path: "licenses.json", sha256: byPath.get("licenses.json")!.sha256 },
        provenance: { path: "provenance.json", sha256: byPath.get("provenance.json")!.sha256 },
        attestation: { path: "attestation.json", sha256: byPath.get("attestation.json")!.sha256 },
        files: inventory,
      }),
    )

    const verified = await verifyComputerRuntimeBundle({ manifestPath, platform: "win32", arch: "x64" })
    expect(verified.contentID).toMatch(/^[a-f0-9]{64}$/)
    expect(verified).toMatchObject({
      manifestPath,
      directory,
      launcherPath: path.join(directory, "runtime.exe"),
      manifest: { schema_version: 1, bundle_id: "cua-windows-1", protocol_version: 1 },
    })

    const provisionRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-computer-provisioned-"))
    temporaryDirectories.push(provisionRoot)
    const installed = await provisionComputerRuntimeBundle({
      manifestPath,
      destinationRoot: provisionRoot,
      platform: "win32",
      arch: "x64",
    })
    expect(installed).toMatchObject({
      contentID: verified.contentID,
      manifestPath: path.join(provisionRoot, verified.contentID, "computer-runtime.json"),
      manifest: { bundle_id: "cua-windows-1", schema_version: 1 },
    })
    expect(
      await verifyProvisionedComputerRuntimeBundle({
        manifestPath: installed.manifestPath,
        platform: "win32",
        arch: "x64",
      }),
    ).toMatchObject({ contentID: verified.contentID, manifestPath: installed.manifestPath })

    const firstConfig = ComputerMCPBuiltin.localConfig({
      runtimeBundleManifest: installed.manifestPath,
      runtimeScope: "conversation:session-one:computer",
    })
    const secondConfig = ComputerMCPBuiltin.localConfig({
      runtimeBundleManifest: installed.manifestPath,
      runtimeScope: "conversation:session-two:computer",
    })
    expect(firstConfig.environment).toMatchObject({
      OPENCORVUS_COMPUTER_RUNTIME_MANIFEST: installed.manifestPath,
    })
    expect(firstConfig.environment!.OPENCORVUS_COMPUTER_WORKSPACE).toBe(
      computerRuntimeWorkspace("conversation:session-one:computer"),
    )
    expect(secondConfig.environment!.OPENCORVUS_COMPUTER_WORKSPACE).toBe(
      computerRuntimeWorkspace("conversation:session-two:computer"),
    )
    const adapterConfig = ComputerMCPBuiltin.withRuntimeScope(firstConfig, "conversation:session-one:computer", {
      endpoint: "http://127.0.0.1:43123/computer/runtime",
      authorization: "host-capability",
      runtimeScope: "conversation:session-one:computer",
    })
    expect(adapterConfig.environment).toEqual({
      OPENCORVUS_COMPUTER_HOST_ENDPOINT: "http://127.0.0.1:43123/computer/runtime",
      OPENCORVUS_COMPUTER_HOST_AUTHORIZATION: "host-capability",
      OPENCORVUS_COMPUTER_RUNTIME_SCOPE: "conversation:session-one:computer",
    })

    const workspaceDirectory = firstConfig.environment!.OPENCORVUS_COMPUTER_WORKSPACE
    temporaryDirectories.push(workspaceDirectory)
    await fs.mkdir(workspaceDirectory, { recursive: true })
    await fs.writeFile(
      path.join(workspaceDirectory, "viewer.json"),
      JSON.stringify({
        schema_version: 1,
        computer_id: "computer-1",
        display_id: "display-1",
        args: ["--connect", "host-only-endpoint"],
      }),
    )
    const viewer = await resolveComputerViewer({
      manifestPath: installed.manifestPath,
      runtimeScope: "conversation:session-one:computer",
      computerId: "computer-1",
      displayId: "display-1",
    })
    expect(viewer).toMatchObject({
      workspaceDirectory,
      descriptor: {
        schema_version: 1,
        computer_id: "computer-1",
        display_id: "display-1",
        args: ["--connect", "host-only-endpoint"],
      },
      runtime: { viewerPath: path.join(installed.directory, "viewer.exe") },
    })
  })

  test("returns the typed required-runtime contract for an unconfigured deployment", async () => {
    await expect(verifyComputerRuntimeBundle({})).rejects.toMatchObject({
      code: "COMPUTER_RUNTIME_REQUIRED",
    })
  })
})
