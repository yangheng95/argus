import { expect, test } from "bun:test"
import { assertTaskResumeSession, sessionKindForSubagent, taskToolSessionMetadata } from "../../src/tool/task"
import type { Session } from "../../src/session"

test("task tool creates explore subagents in the explore session lane", () => {
  expect(sessionKindForSubagent("explore")).toBe("explore")
  expect(sessionKindForSubagent("general")).toBe("assistant")
})

function session(input: Partial<Session.Info> & Pick<Session.Info, "id">): Session.Info {
  return {
    id: input.id,
    slug: input.slug ?? input.id,
    projectID: input.projectID ?? "project_test",
    directory: input.directory ?? "/workspace",
    parentID: input.parentID,
    title: input.title ?? input.id,
    version: input.version ?? "test",
    kind: input.kind ?? "assistant",
    metadata: input.metadata,
    time: input.time ?? {
      created: 1,
      updated: 1,
    },
  } as Session.Info
}

test("task_id resume accepts only the original child subagent session", () => {
  const callerSession = session({ id: "ses_parent", directory: "/workspace", kind: "orchestrator" })
  const resumeSession = session({
    id: "ses_child",
    parentID: callerSession.id,
    directory: callerSession.directory,
    kind: "assistant",
    metadata: taskToolSessionMetadata("general"),
  })

  expect(() =>
    assertTaskResumeSession({
      resumeSession,
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).not.toThrow()
})

test("task_id resume rejects sessions outside the caller boundary", () => {
  const callerSession = session({ id: "ses_parent", directory: "/workspace", kind: "orchestrator" })
  const legal = session({
    id: "ses_child",
    parentID: callerSession.id,
    directory: callerSession.directory,
    kind: "assistant",
    metadata: taskToolSessionMetadata("general"),
  })

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, parentID: "ses_other_parent" }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("not a child session")

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, kind: "explore" }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("expected assistant")

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, directory: "/other-workspace" }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("belongs to /other-workspace")

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, metadata: taskToolSessionMetadata("explore") }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("belongs to subagent explore")

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, metadata: undefined }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("belongs to subagent undefined")
})
