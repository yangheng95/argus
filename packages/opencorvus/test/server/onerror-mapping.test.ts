import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { Worktree } from "../../src/worktree/index"
import { Server } from "../../src/server/server"
import { Provider } from "../../src/provider/provider"
import { Pty } from "../../src/pty"
import { NotFoundError } from "../../src/storage/db"
import { Filesystem } from "../../src/util/filesystem"
import { Log } from "../../src/util/log"
import { Session } from "../../src/session"
import { TaskCancellationIncompleteError } from "../../src/engine/cancellation-error"
import type { ContentfulStatusCode } from "hono/utils/http-status"

Log.init({ print: false })

/**
 * 2026-04-30 darwin cascade audit (W2-V31). The server.ts onError
 * handler must map each NamedError class to a stable status code so
 * the overlay can act on the failure structurally:
 *   - DirectoryRequiredError    → 400  (user must supply a directory)
 *   - InvalidDirectoryError     → 400  (cross-platform / unparseable)
 *   - WorktreeNotGitError       → 412  (precondition: directory exists,
 *                                       but is not a git repo — overlay
 *                                       offers `init-git` recovery)
 *   - other Worktree* errors    → 400
 *   - Provider.ModelNotFoundError → 400
 *   - NotFoundError             → 404
 *   - everything else (NamedError) → 500
 *
 * The previous handler folded WorktreeNotGitError into the generic
 * `name.startsWith("Worktree")` 400 bucket, which made
 * "directory is bad" indistinguishable from "directory is not a git
 * repo" on the wire. The overlay UX needs the distinction.
 */

/**
 * Mirror server.ts:49-73 onError logic on a fresh Hono so we can
 * assert per-error mapping without booting the entire app graph.
 * KEEP IN SYNC with server.ts. Drift is what this test exists to
 * catch.
 */
function buildOnErrorProbe(throwFn: () => never): Hono {
  const probe = new Hono()
  probe.onError((err, c) => {
    if (
      err instanceof NamedError ||
      (err &&
        typeof err === "object" &&
        typeof (err as any).name === "string" &&
        typeof (err as any).toObject === "function")
    ) {
      let status: ContentfulStatusCode
      if (err.name === "NotFoundError") status = 404
      else if (err.name === "ProviderModelNotFoundError") status = 400
      else if (err.name === "DirectoryRequiredError") status = 400
      else if (err.name === "InvalidDirectoryError") status = 400
      else if (err.name === "ChildSessionConfigError") status = 400
      else if (err.name === "WorktreeNotGitError") status = 412
      else if (err.name.startsWith("Worktree")) status = 400
      else if (err.name === "TaskEmptyMessageError") status = 400
      else if (err.name === "TaskGlobalProjectBindingError") status = 409
      else if (err.name === "TaskChannelBindingProjectConflictError") status = 409
      else if (err.name === "TaskCancellationIncompleteError") status = 409
      else if (err.name === "PtyCreateFailedError") status = 400
      else if (err.name === "FileUploadConflictError") status = 409
      else if (err.name.startsWith("FileUpload")) status = 400
      else status = 500
      return c.json((err as NamedError & { toObject(): { name: string; data: unknown } }).toObject(), { status })
    }
    return c.json({ name: "UnknownError" }, 500)
  })
  probe.get("/__throw__", () => {
    throwFn()
  })
  return probe
}

async function expectMapping(err: () => never, expectedStatus: number, expectedName: string): Promise<void> {
  const probe = buildOnErrorProbe(err)
  const r = await probe.request("/__throw__", { method: "GET" })
  expect(r.status).toBe(expectedStatus)
  const body = (await r.json()) as { name: string }
  expect(body.name).toBe(expectedName)
}

describe("server onError NamedError → status code mapping (W2-V31)", () => {
  test("DirectoryRequiredError maps to 400", async () => {
    await expectMapping(
      () => {
        throw new Server.DirectoryRequiredError({ message: "no directory" })
      },
      400,
      "DirectoryRequiredError",
    )
  })

  test("Filesystem.InvalidDirectoryError maps to 400", async () => {
    await expectMapping(
      () => {
        throw new Filesystem.InvalidDirectoryError({
          value: "C:\\Users\\foo",
          reason: "windows-path-on-posix",
          message: "windows path on posix",
        })
      },
      400,
      "InvalidDirectoryError",
    )
  })

  test("WorktreeNotGitError maps to 412 (precondition: repo not initialized)", async () => {
    await expectMapping(
      () => {
        throw new Worktree.NotGitError({ message: "no .git" })
      },
      412,
      "WorktreeNotGitError",
    )
  })

  test("WorktreeCreateFailedError keeps the 400 prefix mapping", async () => {
    await expectMapping(
      () => {
        throw new Worktree.CreateFailedError({ message: "branch exists" })
      },
      400,
      "WorktreeCreateFailedError",
    )
  })

  test("Provider.ModelNotFoundError maps to 400", async () => {
    await expectMapping(
      () => {
        throw new Provider.ModelNotFoundError({
          providerID: "missing",
          modelID: "missing",
        })
      },
      400,
      "ProviderModelNotFoundError",
    )
  })

  test("NotFoundError maps to 404", async () => {
    await expectMapping(
      () => {
        throw new NotFoundError({ message: "row missing" })
      },
      404,
      "NotFoundError",
    )
  })

  test("NotFoundError-shaped errors map to 404 without prototype identity", async () => {
    await expectMapping(
      () => {
        const err = new Error("row missing") as Error & { name: string; toObject(): { name: string; data: unknown } }
        err.name = "NotFoundError"
        err.toObject = () => ({ name: "NotFoundError", data: { message: "row missing" } })
        throw err
      },
      404,
      "NotFoundError",
    )
  })

  test("ChildSessionConfigError maps to 400", async () => {
    await expectMapping(
      () => {
        throw new Session.ChildSessionConfigError({
          sessionID: "ses_child",
          parentID: "ses_root",
          message: "child session cannot own config",
        })
      },
      400,
      "ChildSessionConfigError",
    )
  })

  test("PtyCreateFailedError maps to 400", async () => {
    await expectMapping(
      () => {
        throw new Pty.CreateFailedError({
          message: "spawn failed",
          cwd: "C:\\project",
          command: "missing-opencorvus",
          args: [],
        })
      },
      400,
      "PtyCreateFailedError",
    )
  })

  test("TaskEmptyMessageError maps to 400", async () => {
    const TaskEmptyMessageError = NamedError.create(
      "TaskEmptyMessageError",
      z.object({ message: z.string(), taskID: z.string() }),
    )
    await expectMapping(
      () => {
        throw new TaskEmptyMessageError({ message: "empty", taskID: "task_empty" })
      },
      400,
      "TaskEmptyMessageError",
    )
  })

  test("TaskGlobalProjectBindingError maps to 409", async () => {
    const TaskGlobalProjectBindingError = NamedError.create(
      "TaskGlobalProjectBindingError",
      z.object({ message: z.string(), taskID: z.string().optional(), projectID: z.string() }),
    )
    await expectMapping(
      () => {
        throw new TaskGlobalProjectBindingError({
          message: "global task",
          taskID: "task_global",
          projectID: "global",
        })
      },
      409,
      "TaskGlobalProjectBindingError",
    )
  })

  test("TaskChannelBindingProjectConflictError maps to 409", async () => {
    const TaskChannelBindingProjectConflictError = NamedError.create(
      "TaskChannelBindingProjectConflictError",
      z.object({
        message: z.string(),
        platform: z.string(),
        channel: z.string(),
        thread: z.string(),
        taskID: z.string(),
        projectID: z.string(),
        activeProjectID: z.string(),
      }),
    )
    await expectMapping(
      () => {
        throw new TaskChannelBindingProjectConflictError({
          message: "channel binding belongs to another project",
          platform: "slack",
          channel: "C",
          thread: "T",
          taskID: "task_a",
          projectID: "project_a",
          activeProjectID: "project_b",
        })
      },
      409,
      "TaskChannelBindingProjectConflictError",
    )
  })

  test("TaskCancellationIncompleteError maps to 409", async () => {
    await expectMapping(
      () => {
        throw new TaskCancellationIncompleteError({
          message: "cancellation incomplete",
          taskID: "task_cancel",
          handle: "executor.abort run",
          cause: "timeout",
        })
      },
      409,
      "TaskCancellationIncompleteError",
    )
  })

  test("FileUploadInvalidNameError maps to 400", async () => {
    const FileUploadInvalidNameError = NamedError.create(
      "FileUploadInvalidNameError",
      z.object({ name: z.string(), message: z.string() }),
    )
    await expectMapping(
      () => {
        throw new FileUploadInvalidNameError({
          name: "../escape.txt",
          message: "Uploaded file name must be a basename",
        })
      },
      400,
      "FileUploadInvalidNameError",
    )
  })

  test("FileUploadConflictError maps to 409", async () => {
    const FileUploadConflictError = NamedError.create(
      "FileUploadConflictError",
      z.object({ path: z.string(), message: z.string() }),
    )
    await expectMapping(
      () => {
        throw new FileUploadConflictError({
          path: "README.md",
          message: "Upload destination already exists",
        })
      },
      409,
      "FileUploadConflictError",
    )
  })

  test("an unrecognized NamedError falls through to 500", async () => {
    const Custom = NamedError.create("CustomTestError", z.object({ message: z.string() }))
    await expectMapping(
      () => {
        throw new Custom({ message: "some other thing" })
      },
      500,
      "CustomTestError",
    )
  })
})
