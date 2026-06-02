import { expect, test } from "bun:test";
import { setBoardStore } from "../src/store/board";
import { cardTreeStore } from "../src/store/card-tree";
import { hydrateConversationView, resetWriter } from "../src/services/tree-writer";

test("hydrateConversationView routes goal-phase transcript messages into the phase card", () => {
  resetWriter();
  setBoardStore("selectedTaskID", "tsk_hydrate_view");
  setBoardStore("board", {
    task: {
      id: "tsk_hydrate_view",
      status: "active",
      request: "restore view",
      sessionID: "ses_root",
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          phases: [
            { id: "plan", label: "Plan", sessionKind: "planner" },
            { id: "build", label: "Build", sessionKind: "build" },
          ],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_1",
        goalRunID: "gr_1",
        goalTitle: "Restore build",
        goalStatus: "running",
        orderIndex: 0,
        steps: [
          {
            stepID: "build",
            label: "Executor",
            status: "running",
            startedAt: 1_776_000_000_100,
            summary: "restore",
            phases: {
              build: { status: "running", startedAt: 1_776_000_000_200 },
            },
          },
        ],
      },
    ],
    interactions: [],
  });

  const transcript = [
    {
      info: {
        id: "msg_build",
        sessionID: "ses_build",
        role: "assistant",
        resolvedRole: "build",
        channel: "build",
        goalID: "goal_1",
        parentSessionID: "ses_executor",
        time: { created: 1_776_000_000_300 },
      },
      parts: [
        {
          id: "part_build_text",
          messageID: "msg_build",
          sessionID: "ses_build",
          type: "text",
          text: "Recovered build output.",
        },
      ],
    },
  ];

  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: "ses_build",
          stage: "build",
          goalID: "goal_1",
          parentSessionID: "ses_executor",
          messageIDs: ["msg_build"],
          firstMessageTime: 1_776_000_000_300,
        },
      ],
    },
    transcript,
  );

  const phaseCardID = "step:goal_1:build:phase:build";
  expect(cardTreeStore.cards["build:session:ses_build"]).toBeUndefined();
  expect(cardTreeStore.cards[phaseCardID]).toBeDefined();
  expect(
    cardTreeStore.cards[phaseCardID]?.parts.some(
      (part) => part.type === "text" && String(part.text || "").includes("Recovered build output."),
    ),
  ).toBe(true);
});

test("hydrateConversationView uses transcript message identity for persisted goal-phase parts", () => {
  resetWriter();
  setBoardStore("selectedTaskID", "tsk_hydrate_persisted_parts");
  setBoardStore("board", {
    task: {
      id: "tsk_hydrate_persisted_parts",
      status: "active",
      request: "restore persisted build parts",
      sessionID: "ses_root",
      time: { created: 1_776_000_010_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "build",
          phases: [
            { id: "build", label: "Build", sessionKind: "build" },
          ],
        },
      ],
    },
    goalWorkflows: [
      {
        goalID: "goal_persisted_parts",
        goalRunID: "gr_persisted_parts",
        goalTitle: "Persisted build",
        goalStatus: "running",
        orderIndex: 0,
        steps: [
          {
            stepID: "build",
            label: "Build",
            status: "running",
            startedAt: 1_776_000_010_100,
            phases: {
              build: { status: "running", startedAt: 1_776_000_010_200 },
            },
          },
        ],
      },
    ],
    interactions: [],
  });

  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: "ses_build_persisted",
          stage: "build",
          goalID: "goal_persisted_parts",
          parentSessionID: "ses_executor",
          messageIDs: ["msg_build_persisted_1", "msg_build_persisted_2"],
          firstMessageTime: 1_776_000_010_300,
          lastMessageTime: 1_776_000_010_400,
          placement: "goal_phase",
          phase: { stepID: "build", phaseID: "build" },
        },
      ],
    },
    [
      {
        info: {
          id: "msg_build_persisted_1",
          sessionID: "ses_build_persisted",
          role: "assistant",
          resolvedRole: "build",
          channel: "build",
          time: { created: 1_776_000_010_300 },
        },
        parts: [
          {
            id: "part_build_persisted_1",
            type: "text",
            text: "First persisted build body.",
          },
        ],
      },
      {
        info: {
          id: "msg_build_persisted_2",
          sessionID: "ses_build_persisted",
          role: "assistant",
          resolvedRole: "build",
          channel: "build",
          time: { created: 1_776_000_010_400 },
        },
        parts: [
          {
            id: "part_build_persisted_2",
            messageID: "msg_stale_part_message",
            sessionID: "ses_stale_part_session",
            channel: "filtered",
            type: "text",
            text: "Second persisted build body.",
          },
        ],
      },
    ],
  );

  const phaseCardID = "step:goal_persisted_parts:build:phase:build";
  const phaseParts = cardTreeStore.cards[phaseCardID]?.parts ?? [];
  expect(cardTreeStore.cards["build:session:ses_build_persisted"]).toBeUndefined();
  expect(cardTreeStore.cards["filtered:session:ses_stale_part_session:message:msg_stale_part_message"]).toBeUndefined();
  expect(
    phaseParts.some(
      (part) =>
        part.id === "part_build_persisted_1" &&
        part.messageID === "msg_build_persisted_1" &&
        part.sessionID === "ses_build_persisted" &&
        String(part.text || "").includes("First persisted build body."),
    ),
  ).toBe(true);
  expect(
    phaseParts.some(
      (part) =>
        part.id === "part_build_persisted_2" &&
        part.messageID === "msg_build_persisted_2" &&
        part.sessionID === "ses_build_persisted" &&
        String(part.text || "").includes("Second persisted build body."),
    ),
  ).toBe(true);
});

test("hydrateConversationView restores task-scope agent cards with reasoning parts", () => {
  resetWriter();
  setBoardStore("selectedTaskID", "tsk_task_scope_hydrate");
  setBoardStore("board", {
    task: {
      id: "tsk_task_scope_hydrate",
      status: "active",
      request: "restore task-scope transcript",
      sessionID: "ses_root",
      time: { created: 1_776_000_100_000 },
      attachments: [],
    },
    workflow: {
      steps: [
        {
          id: "requirements",
          status: "completed",
          completedAt: 1_776_000_101_000,
        },
        {
          id: "architect",
          status: "running",
          startedAt: 1_776_000_102_000,
        },
      ],
    },
    goalWorkflows: [],
    interactions: [],
  });

  const transcript = [
    {
      info: {
        id: "msg_requirements",
        sessionID: "ses_requirements",
        role: "assistant",
        resolvedRole: "requirements",
        channel: "requirements",
        time: { created: 1_776_000_101_100 },
      },
      parts: [
        {
          id: "part_requirements_reasoning",
          messageID: "msg_requirements",
          sessionID: "ses_requirements",
          type: "reasoning",
          text: "Reading the user request and extracting requirements.",
        },
        {
          id: "part_requirements_text",
          messageID: "msg_requirements",
          sessionID: "ses_requirements",
          type: "text",
          text: "Requirements registered.",
        },
      ],
    },
    {
      info: {
        id: "msg_architect",
        sessionID: "ses_architect",
        role: "assistant",
        resolvedRole: "architect",
        channel: "architect",
        time: { created: 1_776_000_102_100 },
      },
      parts: [
        {
          id: "part_architect_reasoning",
          messageID: "msg_architect",
          sessionID: "ses_architect",
          type: "reasoning",
          text: "Designing goals and contracts.",
        },
        {
          id: "part_architect_text",
          messageID: "msg_architect",
          sessionID: "ses_architect",
          type: "text",
          text: "Architect is preparing contracts.",
        },
      ],
    },
  ];

  hydrateConversationView(
    {
      sessions: [
        {
          sessionID: "ses_requirements",
          stage: "requirements",
          messageIDs: ["msg_requirements"],
          firstMessageTime: 1_776_000_101_100,
          placement: "top_level",
        },
        {
          sessionID: "ses_architect",
          stage: "architect",
          messageIDs: ["msg_architect"],
          firstMessageTime: 1_776_000_102_100,
          placement: "top_level",
        },
      ],
    },
    transcript,
  );

  const requirementsCardID = "requirements:session:ses_requirements:message:msg_requirements";
  const architectCardID = "architect:session:ses_architect:message:msg_architect";
  expect(cardTreeStore.order).toContain(requirementsCardID);
  expect(cardTreeStore.order).toContain(architectCardID);
  expect(
    cardTreeStore.cards[requirementsCardID]?.parts.some(
      (part) => part.type === "reasoning" && String(part.text || "").includes("extracting requirements"),
    ),
  ).toBe(true);
  expect(
    cardTreeStore.cards[architectCardID]?.parts.some(
      (part) => part.type === "reasoning" && String(part.text || "").includes("Designing goals"),
    ),
  ).toBe(true);
});
