import { Hono } from "hono"
import path from "node:path"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { Vcs } from "../../project/vcs"
import { Worktree } from "../../worktree"
import { Ownership } from "../../engine/ownership"
import { WorktreeGC } from "../../worktree/gc"
import { deleteCurrentProject, ProjectDeleteResult } from "../../project/delete"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const OwnershipMarker = z.object({
  taskID: z.string(),
  sessionID: z.string(),
  cwd: z.string(),
  ownerPid: z.number(),
  goalID: z.string().optional(),
  runID: z.string().optional(),
  createdAt: z.number(),
  kind: z.enum(["worktree", "process"]),
})

const OwnershipCandidate = z.object({
  marker: OwnershipMarker,
  markerPath: z.string(),
  reason: z.string(),
  worktreeDir: z.string().optional(),
})

const WorktreeGCCandidate = z.object({
  projectID: z.string(),
  primaryDir: z.string(),
  directory: z.string(),
})

const CleanupCandidates = z.object({
  worktreeOrphans: OwnershipCandidate.array(),
  processOrphans: OwnershipCandidate.array(),
  worktreeGCCandidates: WorktreeGCCandidate.array(),
})

export const ProjectRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all projects",
        description: "Get a list of projects that have been opened with OpenCorvus.",
        operationId: "project.list",
        responses: {
          200: {
            description: "List of projects",
            content: {
              "application/json": {
                schema: resolver(Project.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const projects = await Project.list()
        return c.json(projects)
      },
    )
    .get(
      "/current",
      describeRoute({
        summary: "Get current project",
        description: "Retrieve the currently active project that OpenCorvus is working with.",
        operationId: "project.current",
        responses: {
          200: {
            description: "Current project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Instance.project)
      },
    )
    .delete(
      "/current",
      describeRoute({
        summary: "Delete current project",
        description:
          "Delete the current project's OpenCorvus state, task history, and project-local runtime directory. Source files in the workspace are not deleted.",
        operationId: "project.current.delete",
        responses: {
          200: {
            description: "Project deleted",
            content: {
              "application/json": {
                schema: resolver(ProjectDeleteResult),
              },
            },
          },
          ...errors(400, 404, 409),
        },
      }),
      async (c) => {
        return c.json(await deleteCurrentProject())
      },
    )
    .post(
      "/current/init-git",
      describeRoute({
        summary: "Initialize git in current directory",
        description: "Run git init in the current working directory and refresh the active project context.",
        operationId: "project.current.initGit",
        responses: {
          200: {
            description: "Git initialized",
            content: {
              "application/json": {
                schema: resolver(Project.InitGitResult),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const result = await Project.initGit(Instance.directory)
        if (result.created) {
          const { hasActiveSessions } = await import("@/engine/runtime")
          if (hasActiveSessions()) {
            // Active sessions prevent a full dispose.  Refresh the cached
            // project in-place so downstream reads see the new worktree/sandboxes,
            // then discard the stale VCS state so the next GET /vcs re-initialises
            // the branch tracker against the newly-created repo.
            // (Project.isGitRepo probes disk directly — no cache to invalidate.)
            await Instance.refresh()
            Vcs.resetState()
          } else {
            await Instance.dispose()
          }
        }
        return c.json(result)
      },
    )
    .get(
      "/current/worktrees",
      describeRoute({
        summary: "List current project worktrees",
        description: "List git worktrees registered for the current project and their live goal binding, if any.",
        operationId: "project.current.worktrees",
        responses: {
          200: {
            description: "Project worktrees",
            content: {
              "application/json": {
                schema: resolver(Worktree.ProjectWorktreeInfo.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        return c.json(await Worktree.listProjectWorktrees(Instance.project.id))
      },
    )
    .get(
      "/current/cleanup-candidates",
      describeRoute({
        summary: "Inspect current project cleanup candidates",
        description:
          "Read-only inspection of orphan ownership markers and worktree GC candidates. This route does not delete files, kill processes, or mutate markers.",
        operationId: "project.current.cleanupCandidates",
        responses: {
          200: {
            description: "Cleanup candidates",
            content: {
              "application/json": {
                schema: resolver(CleanupCandidates),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const [worktreeOrphans, processOrphans, gcPlan] = await Promise.all([
          Ownership.Worktree.orphans({ primaryWorktreeDir: Instance.directory }),
          Ownership.Process.orphans({ primaryWorktreeDir: Instance.directory }),
          WorktreeGC.inspect(),
        ])
        const current = path.resolve(Instance.directory)
        return c.json({
          worktreeOrphans,
          processOrphans,
          worktreeGCCandidates: gcPlan.candidates.filter((candidate) => path.resolve(candidate.primaryDir) === current),
        })
      },
    )
    .delete(
      "/current/worktrees",
      describeRoute({
        summary: "Delete a current project worktree",
        description: "Remove a git worktree registered for the current project.",
        operationId: "project.current.worktrees.delete",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("json", Worktree.RemoveInput),
      async (c) => {
        const body = c.req.valid("json")
        const removed = await Worktree.removeProjectWorktree(body)
        await Project.removeSandbox(Instance.project.id, removed.directory)
        return c.json({ ok: true })
      },
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      validator("json", Project.update.schema.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    ),
)
