import { test, expect } from "bun:test";
import { applyEvent, resetWriter } from "../src/services/tree-writer";
import { cardTreeStore } from "../src/store/card-tree";

test("delivery.gate.rejected does not materialize a separate agent card", () => {
  resetWriter();

  applyEvent({
    type: "delivery.gate.rejected",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_abc",
      iteration: 0,
      summary: "Runtime-evidence gate rejected delivery: 1 violation(s).",
      violations: [
        {
          kind: "empty_root_shell",
          detail: "rendered DOM 只有空 <div id=\"root\">",
        },
      ],
    },
  });

  expect(cardTreeStore.cards["delivery-gate:tsk_abc:0"]).toBeUndefined();
  expect(cardTreeStore.order.includes("delivery-gate:tsk_abc:0")).toBe(false);
});

test("delivery.gate.rejected remains pass-through on repeated emissions", () => {
  resetWriter();

  const base = {
    type: "delivery.gate.rejected",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_xyz",
      iteration: 1,
      summary: "first",
      violations: [{ kind: "no_build_artifact", detail: "missing dist/" }],
    },
  };
  applyEvent(base);
  applyEvent({
    ...base,
    emittedAt: 1700000005000,
    properties: { ...base.properties, summary: "second", violations: [{ kind: "render_failed", detail: "404 chunk" }] },
  });

  const cards = Object.keys(cardTreeStore.cards).filter((id) => id.startsWith("delivery-gate:tsk_xyz:"));
  expect(cards).toEqual([]);
});

test("delivery.evidence.updated does not materialize a separate agent card", () => {
  resetWriter();

  applyEvent({
    type: "delivery.evidence.updated",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_manifest",
      runID: "run_manifest",
      deliveryID: "dlv_manifest",
      manifestID: "artifact_manifest",
      iteration: 2,
      status: "failed",
      summary: "Delivery evidence gate failed 1 required check(s).",
      failedCheckCount: 1,
      failedRuntimeFlowCount: 0,
      failedReviewCount: 1,
      failureDetails: [
        {
          kind: "check",
          id: "check:build",
          name: "Build",
          status: "failed",
          command: "bun run build",
          exitCode: 1,
          evidence: "tsc exited with code 1",
        },
      ],
    },
  });

  expect(cardTreeStore.cards["delivery-evidence:tsk_manifest:2"]).toBeUndefined();
  expect(cardTreeStore.order.includes("delivery-evidence:tsk_manifest:2")).toBe(false);
});
