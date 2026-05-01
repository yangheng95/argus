import { test, expect } from "bun:test";
import { applyEvent, resetWriter } from "../src/services/tree-writer";
import { cardTreeStore } from "../src/store/card-tree";

test("delivery.gate.rejected materializes a top-level card with violations", () => {
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

  const cardID = "delivery-gate:tsk_abc:0";
  const card = cardTreeStore.cards[cardID];
  expect(card).toBeDefined();
  expect(card?.kind).toBe("agent");
  expect(card?.stage).toBe("delivery");
  expect(card?.status).toBe("error");
  expect(card?.subtitle).toContain("Runtime-evidence gate rejected");
  expect(cardTreeStore.order.includes(cardID)).toBe(true);

  const text = (card?.parts ?? []).find((p: any) => p?.type === "text") as any;
  expect(text?.text).toContain("empty_root_shell");
  expect(text?.text).toContain("rendered DOM 只有空");
});

test("delivery.gate.rejected upserts the same card on a second emission for the same iteration", () => {
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

  const cardID = "delivery-gate:tsk_xyz:1";
  const cards = Object.keys(cardTreeStore.cards).filter((id) => id.startsWith("delivery-gate:tsk_xyz:"));
  expect(cards).toEqual([cardID]);

  const card = cardTreeStore.cards[cardID];
  expect(card?.subtitle).toBe("second");
  const text = (card?.parts ?? []).find((p: any) => p?.type === "text") as any;
  expect(text?.text).toContain("render_failed");
  expect(text?.text).not.toContain("no_build_artifact");
});

test("delivery.evidence.updated materializes the manifest stage card", () => {
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
    },
  });

  const cardID = "delivery-evidence:tsk_manifest:2";
  const card = cardTreeStore.cards[cardID];
  expect(card).toBeDefined();
  expect(card?.stage).toBe("delivery");
  expect(card?.status).toBe("error");
  expect(cardTreeStore.order.includes(cardID)).toBe(true);

  const text = (card?.parts ?? []).find((p: any) => p?.type === "text") as any;
  expect(text?.text).toContain("checks_failed=1");
  expect(text?.text).toContain("reviews_failed=1");
  expect(text?.text).toContain("manifest=artifact_manifest");
});
