import { test, expect } from "bun:test";

(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test";

const { applyEvent, resetWriter } = await import("../src/services/tree-writer");
const { cardTreeStore } = await import("../src/store/card-tree");
const { replay } = await import("./fixtures/replay");

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

test("review.stream.started creates a top-level running delivery review card", () => {
  resetWriter();

  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_review",
      reviewID: "delivery:tsk_review:0",
      phase: "delivery",
    },
  });

  const card = cardTreeStore.cards["review:delivery:tsk_review:0"];
  expect(card).toBeDefined();
  expect(card?.kind).toBe("review");
  expect(card?.status).toBe("running");
  expect(cardTreeStore.order).toContain("review:delivery:tsk_review:0");
});

test("review.stream.progress mutates the same delivery review card", () => {
  resetWriter();
  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000000,
    properties: { taskID: "tsk_review", reviewID: "delivery:tsk_review:1", phase: "delivery" },
  });
  applyEvent({
    type: "review.stream.progress",
    emittedAt: 1700000000100,
    properties: {
      taskID: "tsk_review",
      reviewID: "delivery:tsk_review:1",
      phase: "delivery",
      currentStep: "runtime",
      attempt: 1,
      elapsedMs: 100,
      summary: "Runtime probe",
    },
  });

  const card = cardTreeStore.cards["review:delivery:tsk_review:1"];
  expect(card?.reviewStream).toMatchObject({
    phase: "delivery",
    currentStep: "runtime",
    summary: "Runtime probe",
  });
  expect(Object.keys(cardTreeStore.cards).filter((id) => id === "review:delivery:tsk_review:1")).toHaveLength(1);
});

test("delivery.review.completed writes DeliveryReviewBody payload and ignores late chunks", () => {
  resetWriter();
  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000000,
    properties: { taskID: "tsk_review", reviewID: "delivery:tsk_review:2", phase: "delivery" },
  });
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
  });
  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1700000000300,
    properties: {
      taskID: "tsk_review",
      reviewID: "delivery:tsk_review:2",
      phase: "delivery",
      kind: "reasoning",
      attempt: 1,
      delta: "late",
    },
  });

  const card = cardTreeStore.cards["review:delivery:tsk_review:2"];
  expect(card?.status).toBe("error");
  expect(card?.deliveryReview).toMatchObject({
    verdict: "rejected",
    source: "host_gate",
    summary: "Host gate rejected",
  });
  expect(card?.parts).toEqual([]);
});

test("integrity review stream still builds the integrity session card", () => {
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

test("unknown review stream event name throws", () => {
  resetWriter();
  expect(() =>
    applyEvent({
      type: "review.stream.unknown",
      properties: { taskID: "tsk_review" },
    }),
  ).toThrow(/unhandled event type/);
});

test("replay fixture shows delivery live card before final host-gate rejection", async () => {
  const initialBoard = {
    task: {
      id: "tsk_replay_delivery",
      title: "Delivery replay",
      status: "running",
      sessionID: "ses_root",
      time: { created: 1700000000000, updated: 1700000000000 },
    },
    run: { executor: "opencorvus", phase: "delivery" },
    overview: { headline: "Delivery replay", summary: "", controls: {} },
    interactions: [],
  };
  const started = {
    type: "review.stream.started",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_replay_delivery",
      reviewID: "delivery:tsk_replay_delivery:0",
      phase: "delivery",
    },
  };
  const progress = {
    type: "review.stream.progress",
    emittedAt: 1700000001000,
    properties: {
      taskID: "tsk_replay_delivery",
      reviewID: "delivery:tsk_replay_delivery:0",
      phase: "delivery",
      currentStep: "runtime",
      attempt: 1,
      elapsedMs: 1000,
      summary: "Runtime evidence still running",
    },
  };

  const live = await replay([started, progress] as any, initialBoard);
  expect(live.order).toContain("review:delivery:tsk_replay_delivery:0");
  expect(live.nodes["review:delivery:tsk_replay_delivery:0"]).toMatchObject({
    kind: "review",
    status: "running",
  });
  expect(cardTreeStore.cards["review:delivery:tsk_replay_delivery:0"]?.reviewStream).toMatchObject({
    currentStep: "runtime",
    summary: "Runtime evidence still running",
  });

  await replay([
    started,
    progress,
    {
      type: "delivery.review.completed",
      emittedAt: 1700000002000,
      properties: {
        taskID: "tsk_replay_delivery",
        reviewID: "delivery:tsk_replay_delivery:0",
        verdict: "rejected",
        source: "host_gate",
        summary: "Host gate rejected delivery",
        hostGatePassed: false,
        failureKinds: ["runtime"],
        rejectionCount: 1,
        deferredCount: 0,
        details: ["Runtime render produced no visible app shell"],
      },
    },
  ] as any, initialBoard);

  expect(cardTreeStore.cards["review:delivery:tsk_replay_delivery:0"]).toMatchObject({
    kind: "review",
    status: "error",
    deliveryReview: {
      verdict: "rejected",
      source: "host_gate",
      summary: "Host gate rejected delivery",
    },
  });
});
