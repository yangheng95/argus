/**
 * Garbage-collection regression suite for AttachmentStore.sweep.
 *
 * Attachment-store single-source contract.
 *
 * The store is content-addressed and write-only — every part / session /
 * task that ever referenced a file leaves its bytes behind on disk
 * forever. Now that visual tools persist through the store instead of
 * inlining base64 into part.data, an unswept store
 * just moves the unbounded growth from DB to FS. These tests pin the
 * sweep contract:
 *
 *   - orphan files (not referenced by any persisted part) are deleted,
 *   - referenced files survive,
 *   - files younger than GC_MIN_AGE_MS are spared so a sweep racing a
 *     concurrent write does not delete a fresh attachment before its
 *     part row lands.
 */
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Database } from "../../src/storage/db"
import {
  EngineArtifactTable,
  EngineChannelBindingTable,
  EngineInteractionRequestTable,
  EngineProgressSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { DecisionLogTable } from "../../src/decision-log/schema"

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function differentBytes(suffix: number): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.from([suffix])])
}

async function ageFile(absPath: string, ageMs: number) {
  // Backdate mtime so the sweep's GC_MIN_AGE_MS gate considers the file
  // old enough to delete. Using fs.utimes keeps the contents intact.
  const past = new Date(Date.now() - ageMs - 1_000)
  await fs.utimes(absPath, past, past)
}

/** Resolve the on-disk path for a written attachment so we can backdate it. */
function attachmentAbs(projectID: string, url: string): string {
  const located = AttachmentStore.nameFromUrl(url)!
  return AttachmentStore.resolveAbsolute(projectID, located.name)!
}

/** Direct engine_task insert — sidesteps the full createTask pipeline so the
 *  retain test only exercises the JSON columns under inspection. */
function seedTaskWithFileRefs(input: {
  projectID: string
  taskID: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number }>
  systemArtifacts?: Array<{ sha: string; url: string; mime: string; size: number }>
}) {
  const now = Date.now()
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        source: "test",
        title: "Sweep retain fixture",
        request: "retain-fixture",
        kind: "workflow",
        attachments: input.attachments ?? [],
        system_artifacts: input.systemArtifacts ?? [],
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function seedDurableOwnerRefs(input: {
  taskID: string
  decisionUrl: string
  artifactUrl: string
  interactionUrl: string
  progressUrl: string
  channelUrl: string
}) {
  const now = Date.now()
  Database.use((db) => {
    db.insert(DecisionLogTable)
      .values({
        id: Identifier.ascending("decision"),
        task_id: input.taskID,
        phase: "eval",
        key: "visual_qa_annotation",
        value: `annotated_evidence_refs=${input.decisionUrl}`,
        reason: "sweep retain regression",
        time_created: now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        kind: "design_resource_manifest",
        label: "manifest",
        payload: { references: [input.artifactUrl] },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineInteractionRequestTable)
      .values({
        id: Identifier.ascending("interaction"),
        task_id: input.taskID,
        external_id: Identifier.ascending("external"),
        request_type: "question",
        status: "pending",
        title: "Interaction attachment retain",
        body: input.interactionUrl,
        payload: { attachmentUrl: input.interactionUrl },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: input.taskID,
        status: "active",
        summary: input.progressUrl,
        payload: { attachmentUrl: input.progressUrl },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineChannelBindingTable)
      .values({
        id: Identifier.ascending("channel"),
        task_id: input.taskID,
        platform: `test-${now}`,
        channel: Identifier.ascending("channel"),
        thread: Identifier.ascending("thread"),
        payload: { attachmentUrl: input.channelUrl },
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

async function seedPartFileRef(input: { url: string; filename: string }) {
  const session = await Session.create({ kind: "orchestrator" })
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
  } as any)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: message.id,
    sessionID: session.id,
    type: "file",
    mime: "image/png",
    filename: input.filename,
    url: input.url,
  } as any)
}

describe("AttachmentStore.sweep", () => {
  test("deletes unreferenced files older than the min-age gate", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const orphanA = await AttachmentStore.write(projectID, differentBytes(1), "image/png", "a.png")
        const orphanB = await AttachmentStore.write(projectID, differentBytes(2), "image/png", "b.png")
        const orphanAAbs = AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(orphanA.url)!.name)!
        const orphanAMetadata = `${orphanAAbs}.metadata.json`

        // Backdate both files past the 60s skip-young gate so sweep
        // considers them deletable.
        await ageFile(orphanAAbs, 120_000)
        await ageFile(
          AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(orphanB.url)!.name)!,
          120_000,
        )

        const before = await AttachmentStore.listOnDisk(projectID)
        expect(before).toHaveLength(2)
        await expect(fs.stat(orphanAMetadata)).resolves.toBeTruthy()

        const result = await AttachmentStore.sweep(projectID)
        expect(result.deleted).toBe(2)
        expect(result.kept).toBe(0)
        expect(result.skippedYoung).toBe(0)
        expect(result.bytesFreed).toBeGreaterThan(0)

        const after = await AttachmentStore.listOnDisk(projectID)
        expect(after).toHaveLength(0)
        await expect(fs.stat(orphanAMetadata)).rejects.toThrow()
      },
    })
  })

  test("keeps files referenced by any part.data row", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const kept = await AttachmentStore.write(projectID, differentBytes(3), "image/png", "kept.png")
        const orphan = await AttachmentStore.write(projectID, differentBytes(4), "image/png", "orphan.png")

        // Persist a part whose state.attachments references `kept` —
        // collectReferencedShas pulls every `/attachment/<id>/<sha>.<ext>`
        // url out of `part.data`. We do not need full message lineage; a
        // tool part written directly via Session.updatePart is enough.
        await seedPartFileRef({ filename: "kept.png", url: kept.url })

        // Backdate both attachments past the min-age gate.
        await ageFile(AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(kept.url)!.name)!, 120_000)
        await ageFile(
          AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(orphan.url)!.name)!,
          120_000,
        )

        const result = await AttachmentStore.sweep(projectID)
        expect(result.kept).toBe(1)
        expect(result.deleted).toBe(1)

        const remaining = await AttachmentStore.listOnDisk(projectID)
        expect(remaining.map((f) => f.sha).sort()).toEqual([kept.sha].sort())
      },
    })
  })

  test("skips files younger than GC_MIN_AGE_MS to avoid racing a fresh write", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        await AttachmentStore.write(projectID, differentBytes(5), "image/png", "fresh.png")
        // Do NOT backdate — the file is younger than 60s.
        const result = await AttachmentStore.sweep(projectID)
        expect(result.skippedYoung).toBe(1)
        expect(result.deleted).toBe(0)
        const remaining = await AttachmentStore.listOnDisk(projectID)
        expect(remaining).toHaveLength(1)
      },
    })
  })

  test("refreshes an existing content-addressed blob before the caller persists its part row", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const bytes = differentBytes(50)
        const first = await AttachmentStore.write(projectID, bytes, "image/png", "first.png")
        const firstAbs = attachmentAbs(projectID, first.url)
        await ageFile(firstAbs, 120_000)

        const aged = await fs.stat(firstAbs)
        expect(Date.now() - aged.mtimeMs).toBeGreaterThan(60_000)

        const second = await AttachmentStore.write(projectID, bytes, "image/png", "second.png")
        expect(second.url).toBe(first.url)

        const result = await AttachmentStore.sweep(projectID)
        expect(result.deleted).toBe(0)
        expect(result.skippedYoung).toBe(1)
        await expect(fs.readFile(firstAbs)).resolves.toEqual(bytes)
      },
    })
  })

  test("idempotent — running twice deletes 0 the second time", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const orphan = await AttachmentStore.write(projectID, differentBytes(6), "image/png", "o.png")
        await ageFile(
          AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(orphan.url)!.name)!,
          120_000,
        )
        const first = await AttachmentStore.sweep(projectID)
        expect(first.deleted).toBe(1)
        const second = await AttachmentStore.sweep(projectID)
        expect(second.deleted).toBe(0)
      },
    })
  })

  // ── Retain-surface coverage ─────────────────────────────────────────
  //
  // The live set is the union of all durable attachment-owner sources, not
  // just `part.data`:
  //   • session part.data           (conversation parts)
  //   • engine_task.attachments     (USER-CONTRACT files — figma-mcp frames,
  //                                   user uploads)
  //   • engine_task.system_artifacts (SYSTEM-GENERATED evidence — URL
  //                                   screenshots, rendered.png)
  //   • decision_log value/reason   (Visual QA annotated evidence refs)
  //   • engine artifact/progress/interaction/channel payloads
  //
  // Before the fix, collectReferencedShas only walked part.data. Any sha
  // registered via appendTaskAttachment / appendTaskSystemArtifact looked
  // orphan to sweep() between registration and the first session part that
  // referenced it — so visual references older than GC_MIN_AGE_MS got
  // unlinked and the build agent ENOENTed on stageToWorktree() copy. These
  // tests pin the union as the retain invariant so future refactors cannot
  // silently drop one surface and regress to that failure mode.

  test("keeps files registered in engine_task.attachments", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const kept = await AttachmentStore.write(projectID, differentBytes(10), "image/png", "figma-frame.png")
        seedTaskWithFileRefs({
          projectID,
          taskID: Identifier.ascending("task"),
          attachments: [{ sha: kept.sha, url: kept.url, mime: "image/png", size: kept.size }],
        })

        await ageFile(attachmentAbs(projectID, kept.url), 120_000)

        const result = await AttachmentStore.sweep(projectID)
        expect(result.kept).toBe(1)
        expect(result.deleted).toBe(0)
        const remaining = await AttachmentStore.listOnDisk(projectID)
        expect(remaining.map((f) => f.sha)).toEqual([kept.sha])
      },
    })
  })

  test("keeps files registered in engine_task.system_artifacts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const kept = await AttachmentStore.write(projectID, differentBytes(11), "image/png", "url-screenshot.png")
        seedTaskWithFileRefs({
          projectID,
          taskID: Identifier.ascending("task"),
          systemArtifacts: [{ sha: kept.sha, url: kept.url, mime: "image/png", size: kept.size }],
        })

        await ageFile(attachmentAbs(projectID, kept.url), 120_000)

        const result = await AttachmentStore.sweep(projectID)
        expect(result.kept).toBe(1)
        expect(result.deleted).toBe(0)
        const remaining = await AttachmentStore.listOnDisk(projectID)
        expect(remaining.map((f) => f.sha)).toEqual([kept.sha])
      },
    })
  })

  test("retain set includes session, task, decision-log, and engine durable owner refs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const taskID = Identifier.ascending("task")
        // A: referenced from a session part.data
        const partRef = await AttachmentStore.write(projectID, differentBytes(20), "image/png", "a.png")
        // B: referenced from engine_task.attachments
        const userAttachment = await AttachmentStore.write(projectID, differentBytes(21), "image/png", "b.png")
        // C: referenced from engine_task.system_artifacts
        const systemArtifact = await AttachmentStore.write(projectID, differentBytes(22), "image/png", "c.png")
        // D-H: referenced from additional durable task-scoped owner rows
        const decisionRef = await AttachmentStore.write(projectID, differentBytes(23), "image/png", "decision.png")
        const artifactRef = await AttachmentStore.write(projectID, differentBytes(24), "image/png", "artifact.png")
        const interactionRef = await AttachmentStore.write(projectID, differentBytes(25), "image/png", "interaction.png")
        const progressRef = await AttachmentStore.write(projectID, differentBytes(26), "image/png", "progress.png")
        const channelRef = await AttachmentStore.write(projectID, differentBytes(27), "image/png", "channel.png")
        // I: orphan — not referenced anywhere
        const orphan = await AttachmentStore.write(projectID, differentBytes(28), "image/png", "orphan.png")

        await seedPartFileRef({ filename: "a.png", url: partRef.url })

        seedTaskWithFileRefs({
          projectID,
          taskID,
          attachments: [
            { sha: userAttachment.sha, url: userAttachment.url, mime: "image/png", size: userAttachment.size },
          ],
          systemArtifacts: [
            { sha: systemArtifact.sha, url: systemArtifact.url, mime: "image/png", size: systemArtifact.size },
          ],
        })
        seedDurableOwnerRefs({
          taskID,
          decisionUrl: decisionRef.url,
          artifactUrl: artifactRef.url,
          interactionUrl: interactionRef.url,
          progressUrl: progressRef.url,
          channelUrl: channelRef.url,
        })

        // Sanity: the helper actually returns the union we expect, not just
        // a permissive superset. Pinning this directly so a refactor that
        // drops one source still fails fast even if sweep() somehow still
        // passes.
        const retain = AttachmentStore.collectReferencedShas().get(projectID) ?? new Set<string>()
        const keptRefs = [
          partRef,
          userAttachment,
          systemArtifact,
          decisionRef,
          artifactRef,
          interactionRef,
          progressRef,
          channelRef,
        ]
        expect([...retain].sort()).toEqual(keptRefs.map((ref) => ref.sha).sort())

        for (const ref of [...keptRefs, orphan]) {
          await ageFile(attachmentAbs(projectID, ref.url), 120_000)
        }

        const result = await AttachmentStore.sweep(projectID)
        expect(result.deleted).toBe(1)
        expect(result.kept).toBe(keptRefs.length)

        const remaining = (await AttachmentStore.listOnDisk(projectID)).map((f) => f.sha).sort()
        expect(remaining).toEqual(keptRefs.map((ref) => ref.sha).sort())
      },
    })
  })

  test("retains blobs referenced only by build session contract input evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const taskID = Identifier.ascending("task")
        const kept = await AttachmentStore.write(projectID, differentBytes(29), "image/png", "contract-held.png")
        const orphan = await AttachmentStore.write(projectID, differentBytes(30), "image/png", "orphan.png")

        seedTaskWithFileRefs({ projectID, taskID })
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              kind: "build_session_contract",
              label: "build-session-contract",
              payload: {
                session_id: "ses_contract_held",
                task_id: taskID,
                goal_id: "gol_contract_held",
                goal_run_id: "gr_contract_held",
                input_evidence: {
                  version: 1,
                  project_id: projectID,
                  task_id: taskID,
                  goal_id: "gol_contract_held",
                  goal_run_id: "gr_contract_held",
                  session_id: "ses_contract_held",
                  entries: [
                    {
                      role: "target_reference",
                      project_id: projectID,
                      sha: kept.sha,
                      mime: kept.mime,
                      size: kept.size,
                      filename: kept.filename,
                      source_task_id: taskID,
                      legacy_attachment_url: kept.url,
                      sha_verified_at: 123,
                    },
                  ],
                },
              },
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run(),
        )

        const retain = AttachmentStore.collectReferencedShas(projectID).get(projectID) ?? new Set<string>()
        expect([...retain]).toEqual([kept.sha])

        await ageFile(attachmentAbs(projectID, kept.url), 120_000)
        await ageFile(attachmentAbs(projectID, orphan.url), 120_000)

        const result = await AttachmentStore.sweep(projectID)
        expect(result.deleted).toBe(1)
        expect(result.kept).toBe(1)
        const remaining = (await AttachmentStore.listOnDisk(projectID)).map((file) => file.sha)
        expect(remaining).toEqual([kept.sha])
      },
    })
  })

  test("project-scoped retain scan ignores foreign project rows", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })

    let projectA = ""
    let projectB = ""
    let partA = ""
    let taskA = ""
    let partB = ""
    let taskB = ""

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        projectA = Instance.project.id
        const partRef = await AttachmentStore.write(projectA, differentBytes(40), "image/png", "a-part.png")
        const taskRef = await AttachmentStore.write(projectA, differentBytes(41), "image/png", "a-task.png")
        partA = partRef.sha
        taskA = taskRef.sha
        await seedPartFileRef({ filename: "a-part.png", url: partRef.url })
        seedTaskWithFileRefs({
          projectID: projectA,
          taskID: Identifier.ascending("task"),
          attachments: [{ sha: taskRef.sha, url: taskRef.url, mime: "image/png", size: taskRef.size }],
        })
      },
    })

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        projectB = Instance.project.id
        const partRef = await AttachmentStore.write(projectB, differentBytes(42), "image/png", "b-part.png")
        const taskRef = await AttachmentStore.write(projectB, differentBytes(43), "image/png", "b-task.png")
        partB = partRef.sha
        taskB = taskRef.sha
        await seedPartFileRef({ filename: "b-part.png", url: partRef.url })
        seedTaskWithFileRefs({
          projectID: projectB,
          taskID: Identifier.ascending("task"),
          systemArtifacts: [{ sha: taskRef.sha, url: taskRef.url, mime: "image/png", size: taskRef.size }],
        })
      },
    })

    const scopedA = AttachmentStore.collectReferencedShas(projectA)
    expect([...scopedA.keys()]).toEqual([projectA])
    expect([...(scopedA.get(projectA) ?? [])].sort()).toEqual([partA, taskA].sort())

    const scopedB = AttachmentStore.collectReferencedShas(projectB)
    expect([...scopedB.keys()]).toEqual([projectB])
    expect([...(scopedB.get(projectB) ?? [])].sort()).toEqual([partB, taskB].sort())

    const unscoped = AttachmentStore.collectReferencedShas()
    expect([...(unscoped.get(projectA) ?? [])].sort()).toEqual([partA, taskA].sort())
    expect([...(unscoped.get(projectB) ?? [])].sort()).toEqual([partB, taskB].sort())
  })

  test("still deletes a sha that is absent from all durable retain surfaces", async () => {
    // Negative control — confirms the wider retain set did not accidentally
    // disable the GC: a task that has its OWN attachments registered, but
    // doesn't reference some unrelated orphan, must still let that orphan be
    // swept.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const kept = await AttachmentStore.write(projectID, differentBytes(30), "image/png", "live.png")
        const orphan = await AttachmentStore.write(projectID, differentBytes(31), "image/png", "orphan.png")

        seedTaskWithFileRefs({
          projectID,
          taskID: Identifier.ascending("task"),
          attachments: [{ sha: kept.sha, url: kept.url, mime: "image/png", size: kept.size }],
        })

        await ageFile(attachmentAbs(projectID, kept.url), 120_000)
        await ageFile(attachmentAbs(projectID, orphan.url), 120_000)

        const result = await AttachmentStore.sweep(projectID)
        expect(result.deleted).toBe(1)
        expect(result.kept).toBe(1)
        const remaining = await AttachmentStore.listOnDisk(projectID)
        expect(remaining.map((f) => f.sha)).toEqual([kept.sha])
      },
    })
  })

  test("returns 0 deletions for projects that never wrote any attachment", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const result = await AttachmentStore.sweep(projectID)
        expect(result).toEqual({ deleted: 0, bytesFreed: 0, skippedYoung: 0, kept: 0 })
      },
    })
  })
})
