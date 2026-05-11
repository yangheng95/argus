import { test, expect } from "bun:test";
import { createComputed, createRoot } from "solid-js";
import { setBoardStore } from "../src/store/board";
import { applyEvent, resetWriter } from "../src/services/tree-writer";
import { cardTreeStore } from "../src/store/card-tree";
import { visibleChildIDsForCard } from "../src/utils/card-tree";

const TASK_ID = "tsk_race_repro";
const SESSION_ID = "ses_1eb3e1362ffemlqUCMe8PQJfwh";
const INTERACTION_ID = "int_e14c6009b0011AcpBE7W2ZagTw";
const T0 = 1_776_000_000_000;

function stampedInfo(channel: string, info: Record<string, any>) {
  return {
    ...info,
    resolvedRole: info.resolvedRole ?? channel,
    agent: info.agent ?? channel,
    channel,
  };
}

function setBoardWithInteraction(status: "pending" | "answered"): void {
  const interaction =
    status === "pending"
      ? {
          id: INTERACTION_ID,
          type: "question",
          status: "pending",
          sessionID: SESSION_ID,
          time: { created: T0 + 2_000 },
          prompt: "ok?",
        }
      : {
          id: INTERACTION_ID,
          type: "question",
          status: "answered",
          sessionID: SESSION_ID,
          time: { created: T0 + 2_000, resolved: T0 + 3_000 },
          prompt: "ok?",
          response: "yes",
        };
  setBoardStore("board", "interactions", [interaction]);
  applyEvent({
    type: status === "pending" ? "interaction.created" : "interaction.resolved",
    properties: { taskID: TASK_ID, interaction },
  });
}

// Contract: a pending interaction-card claimed by an orchestrator session
// must be GC'd AND removed from the parent's childIDs together when the
// interaction transitions to answered. The original loadBoard failure
// surfaced as a parent card whose childIDs still pointed at a just-deleted
// interaction-card — visibleChildIDsForCard threw "card-tree: card X
// references missing child Y". The fix wraps rebuildCardHierarchy /
// rebuildBoardDerivedCards in solid-js batch() so the GC and the parent
// childIDs rewrite are visible as a single atomic update.
test("orchestrator session card stays consistent across pending → answered transition", () => {
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "race repro",
      sessionID: SESSION_ID,
      time: { created: T0 },
      attachments: [],
    },
    goalWorkflows: [],
    interactions: [],
  });
  setBoardStore("selectedTaskID", TASK_ID);
  resetWriter();

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: stampedInfo("orchestrator", {
        id: "msg_orch_1",
        sessionID: SESSION_ID,
        role: "assistant",
        time: { created: T0 + 1_000 },
      }),
    },
  });

  const sessionCardID = `orchestrator:session:${SESSION_ID}`;
  const pendingCardID = `interaction-card:ctx:interaction:${INTERACTION_ID}`;

  setBoardWithInteraction("pending");
  expect(cardTreeStore.cards[sessionCardID]).toBeDefined();
  expect(cardTreeStore.cards[sessionCardID]!.childIDs).toContain(pendingCardID);
  expect(cardTreeStore.cards[pendingCardID]).toBeDefined();
  // visibleChildIDsForCard must succeed at every observable point during
  // the rebuild — no missing-child throw.
  expect(() => visibleChildIDsForCard(cardTreeStore.cards[sessionCardID]!)).not.toThrow();

  // Subscribe a reactive observer that mirrors Card.tsx's
  // visibleChildIDsForCard memo. After the transition, the observer must
  // still see a consistent state on its final run.
  const observedErrors: string[] = [];
  let dispose: (() => void) | undefined;
  createRoot((d) => {
    dispose = d;
    createComputed(() => {
      const card = cardTreeStore.cards[sessionCardID];
      if (!card) return;
      try {
        visibleChildIDsForCard(card);
      } catch (e: any) {
        observedErrors.push(String(e?.message || e));
      }
    });
  });

  setBoardWithInteraction("answered");

  // Final state contract: pending card is GC'd, parent no longer references
  // it, and the reactive observer never saw a dangling reference.
  expect(cardTreeStore.cards[pendingCardID]).toBeUndefined();
  expect(cardTreeStore.cards[sessionCardID]?.childIDs ?? []).not.toContain(pendingCardID);
  expect(() => visibleChildIDsForCard(cardTreeStore.cards[sessionCardID]!)).not.toThrow();
  expect(observedErrors).toEqual([]);

  dispose?.();
});
