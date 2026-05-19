import { test, expect } from "bun:test";

(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test";

const { applyEvent, resetWriter } = await import("../src/services/tree-writer");
const { cardTreeStore } = await import("../src/store/card-tree");

test("retired legacy gate event is not accepted by the tree writer", () => {
  resetWriter();

  expect(() =>
    applyEvent({
      type: "delivery.gate.rejected",
      emittedAt: 1700000000000,
      properties: {
        taskID: "tsk_abc",
        iteration: 0,
        summary: "Runtime-evidence gate rejected delivery.",
        violations: [{ kind: "empty_root_shell", detail: "empty root" }],
      },
    }),
  ).toThrow(/unhandled event type/);
});

test("legacy delivery evidence remains pass-through and does not materialize a card", () => {
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
      summary: "Legacy evidence failed 1 required check.",
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

test("retired delivery review completion event is not accepted by the tree writer", () => {
  resetWriter();

  expect(() =>
    applyEvent({
      type: "delivery.review.completed",
      emittedAt: 1700000000200,
      properties: {
        taskID: "tsk_review",
        reviewID: "delivery:tsk_review:2",
        verdict: "rejected",
        source: "host_gate",
        summary: "Host gate rejected",
        hostGatePassed: false,
        failureKinds: ["runtime"],
        rejectionCount: 1,
        deferredCount: 0,
        details: ["Runtime render failed"],
      },
    }),
  ).toThrow(/unhandled event type/);
});

test("integrity review stream builds the integrity session card", () => {
  resetWriter();

  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_integrity",
      reviewID: "integrity:ses_integrity",
      phase: "integrity",
      sessionID: "ses_integrity",
    },
  });
  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1700000000100,
    properties: {
      taskID: "tsk_integrity",
      reviewID: "integrity:ses_integrity",
      phase: "integrity",
      kind: "reasoning",
      attempt: 1,
      delta: "reason",
    },
  });

  const card = cardTreeStore.cards["integrity:session:ses_integrity"];
  expect(card).toBeDefined();
  expect(card?.stage).toBe("integrity");
  expect(card?.parts[0]).toMatchObject({
    partID: "review:integrity:ses_integrity:reasoning:1",
    text: "reason",
  });
});

test("review stream rejects retired delivery phase", () => {
  resetWriter();

  expect(() =>
    applyEvent({
      type: "review.stream.started",
      emittedAt: 1700000000000,
      properties: {
        taskID: "tsk_review",
        reviewID: "delivery:tsk_review:0",
        phase: "delivery",
      },
    }),
  ).toThrow(/review\.stream phase unsupported: delivery/);
});
