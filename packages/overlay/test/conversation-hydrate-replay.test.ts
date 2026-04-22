import { expect, test } from "bun:test";
import { setBoardStore } from "../src/store/board";
import { cardTreeStore } from "../src/store/card-tree";
import { replayTaskEventToTree } from "../src/services/events";
import { resetWriter } from "../src/services/tree-writer";

test("hydration replay projects persisted executor output into the card tree", () => {
  resetWriter();
  setBoardStore("board", {
    task: {
      id: "tsk_hydrate",
      status: "active",
      request: "restore conversation",
      sessionID: "ses_root",
      time: { created: 1_776_000_000_000 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  });
  setBoardStore("selectedTaskID", "tsk_hydrate");

  replayTaskEventToTree({
    event_id: "pev_1",
    task_id: "tsk_hydrate",
    type: "run.output",
    timestamp: 1_776_000_001_000,
    sequence: 12,
    summary: "Hydrated executor output",
    payload: {
      runID: "run_1",
      sessionID: "ses_executor",
      type: "text_delta",
      text: "Recovered streamed output.",
    },
  });

  const cardID = "executor:session:ses_executor";
  expect(cardTreeStore.cards[cardID]).toBeDefined();
  expect(
    cardTreeStore.cards[cardID]?.parts.some(
      (part) => part.type === "text" && String(part.text || "").includes("Recovered streamed output."),
    ),
  ).toBe(true);
});
