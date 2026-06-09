import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { Vcs } from "../../project/vcs"
import { Worktree } from "../../worktree"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

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
        await Worktree.remove(body)
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
