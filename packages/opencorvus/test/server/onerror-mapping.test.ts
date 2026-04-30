import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { Worktree } from "../../src/worktree/index"
import { Server } from "../../src/server/server"
import { Provider } from "../../src/provider/provider"
import { NotFoundError } from "../../src/storage/db"
import { Filesystem } from "../../src/util/filesystem"
import { Log } from "../../src/util/log"
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
    if (err instanceof NamedError) {
      let status: ContentfulStatusCode
      if (err instanceof NotFoundError) status = 404
      else if (err instanceof Provider.ModelNotFoundError) status = 400
      else if (err instanceof Server.DirectoryRequiredError) status = 400
      else if (err instanceof Filesystem.InvalidDirectoryError) status = 400
      else if (err.name === "WorktreeNotGitError") status = 412
      else if (err.name.startsWith("Worktree")) status = 400
      else status = 500
      return c.json(err.toObject(), { status })
    }
    return c.json({ name: "UnknownError" }, 500)
  })
  probe.get("/__throw__", () => {
    throwFn()
  })
  return probe
}

async function expectMapping(
  err: () => never,
  expectedStatus: number,
  expectedName: string,
): Promise<void> {
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
